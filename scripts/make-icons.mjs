/**
 * 从源 PNG 生成 PWA / favicon 需要的各尺寸图标。
 *
 * 为什么自己写:本机没有 ImageMagick / sharp / Playwright,
 * 而 Node 自带 zlib —— PNG 就是 zlib 包一层 chunk,解码/编码都不难。
 *
 * 用法:
 *   node scripts/make-icons.mjs <源PNG> <输出目录> <宽> [宽...]
 * 例:
 *   node scripts/make-icons.mjs logo.png client/public 180 192 512
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ----------------------------- PNG 解码 ----------------------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 解析 PNG → { width, height, rgba: Uint8Array } */
function decodePng(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('不是 PNG');

  let pos = 8;
  let ihdr = null;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  if (!ihdr) throw new Error('缺少 IHDR');
  if (ihdr.interlace !== 0) throw new Error('不支持隔行扫描的 PNG');
  if (ihdr.bitDepth !== 8) throw new Error(`不支持的位深 ${ihdr.bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
  if (!channels) throw new Error(`不支持的颜色类型 ${ihdr.colorType}`);

  const { width, height } = ihdr;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);

  // 逐行反滤波
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 0xff;
          break;
        }
        default: throw new Error(`未知的行滤波 ${filter}`);
      }
      cur[x] = v;
    }
    out.set(cur, y * stride);
    prev = cur;
  }

  // 统一成 RGBA
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * channels;
    const d = i * 4;
    if (channels === 4) {
      rgba[d] = out[s];
      rgba[d + 1] = out[s + 1];
      rgba[d + 2] = out[s + 2];
      rgba[d + 3] = out[s + 3];
    } else if (channels === 3) {
      rgba[d] = out[s];
      rgba[d + 1] = out[s + 1];
      rgba[d + 2] = out[s + 2];
      rgba[d + 3] = 255;
    } else if (channels === 2) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s];
      rgba[d + 3] = out[s + 1];
    } else {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s];
      rgba[d + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/* ----------------------------- PNG 编码 ----------------------------- */

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA 像素 → PNG Buffer */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ----------------------------- 缩放 ----------------------------- */

/**
 * 面积平均(盒式)放大。
 * 源图是纯色块为主,面积平均能把边缘混得比较干净,不会像最近邻那样出现锯齿。
 */
function resize(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = (y * sh) / dh;
    const y1 = ((y + 1) * sh) / dh;
    for (let x = 0; x < dw; x++) {
      const x0 = (x * sw) / dw;
      const x1 = ((x + 1) * sw) / dw;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1) && sy < sh; sy++) {
        for (let sx = Math.floor(x0); sx < Math.ceil(x1) && sx < sw; sx++) {
          const s = (sy * sw + sx) * 4;
          const alpha = src[s + 3] / 255;
          r += src[s] * alpha;
          g += src[s + 1] * alpha;
          b += src[s + 2] * alpha;
          a += src[s + 3];
          n++;
        }
      }
      const d = (y * dw + x) * 4;
      const aAvg = a / n;
      if (aAvg <= 0.5) {
        out[d] = out[d + 1] = out[d + 2] = out[d + 3] = 0;
      } else {
        out[d] = Math.round(r / n / (aAvg / 255));
        out[d + 1] = Math.round(g / n / (aAvg / 255));
        out[d + 2] = Math.round(b / n / (aAvg / 255));
        out[d + 3] = Math.round(aAvg);
      }
    }
  }
  return out;
}

/* ----------------------------- 主流程 ----------------------------- */

const [srcPath, outDir, ...sizes] = process.argv.slice(2);
if (!srcPath || !outDir || sizes.length === 0) {
  console.error('用法:node make-icons.mjs <源PNG> <输出目录> <宽> [宽...]');
  process.exit(1);
}

const img = decodePng(fs.readFileSync(srcPath));
console.log(`源图 ${img.width}×${img.height}`);

/** 把 RGBA 合成到不透明底色上(iOS 会把透明 apple-touch-icon 渲染成纯黑,不好看) */
function flatten(rgba, w, h, hex) {
  const bg = [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * 4;
    const a = rgba[s + 3] / 255;
    out[s] = Math.round(rgba[s] * a + bg[0] * (1 - a));
    out[s + 1] = Math.round(rgba[s + 1] * a + bg[1] * (1 - a));
    out[s + 2] = Math.round(rgba[s + 2] * a + bg[2] * (1 - a));
    out[s + 3] = 255;
  }
  return out;
}

/**
 * 合成底色:与应用的深色主题一致(manifest 的 background_color / theme_color)。
 * 想换底色:node scripts/make-icons.mjs <源PNG> <输出目录> 180 192 512 --bg=ffffff
 */
const APP_BG = '0b0e14';

fs.mkdirSync(outDir, { recursive: true });
for (const s of sizes) {
  const size = Number(s);
  const rgba = size === img.width ? img.rgba : resize(img.rgba, img.width, img.height, size, size);
  const flat = flatten(rgba, size, size, APP_BG);
  const png = encodePng(size, size, flat);
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`  ${path.basename(file)}  ${size}×${size}  ${png.length} bytes`);
}

