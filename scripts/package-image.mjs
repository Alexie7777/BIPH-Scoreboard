#!/usr/bin/env node
/**
 * 打包 Docker 镜像 —— 产出可以直接拷到另一台服务器上的 bundle。
 *
 * 为什么需要这个:
 *   校园网服务器常常没有外网,而 `docker build` 需要联网拉 npm 依赖和基础镜像。
 *   所以正确做法是:**在有网的机器上把镜像构建好、导出成 tar,拷过去 load**,
 *   服务器上不碰源码、不联网也能跑起来。
 *
 * 用法:
 *   node scripts/package-image.mjs                    # 默认 linux/amd64
 *   node scripts/package-image.mjs --platform linux/arm64
 *   node scripts/package-image.mjs --with-source      # 额外打一份干净源码包
 *   node scripts/package-image.mjs --no-build          # 不重新构建,只导出现有镜像
 *   node scripts/package-image.mjs --load              # 打包后在本机 load 回来(自测)
 *
 * 产出(默认在 dist/):
 *   biph-<版本>-<平台>.tar        镜像 tar(docker load 直接吃)
 *   biph-<版本>-<平台>.tar.sha256 校验和
 *   docker-compose.yml            镜像部署用的 compose(已去掉 build 段)
 *   部署说明.md                   拷过去照着做的步骤
 *   biph-<版本>-source.tar.gz     源码包(仅 --with-source)
 *
 * 零依赖:只用 Node 内置模块 + 调用 docker CLI。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- 参数解析

function parseArgs(argv) {
  const opt = {
    version: null,
    platform: 'linux/amd64',
    out: 'dist',
    image: 'biph',
    build: true,
    withSource: false,
    load: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`参数 ${a} 后面缺值`);
      return v;
    };
    switch (a) {
      case '--version': opt.version = next(); break;
      case '--platform': opt.platform = next(); break;
      case '--out': opt.out = next(); break;
      case '--image': opt.image = next(); break;
      case '--no-build': opt.build = false; break;
      case '--with-source': opt.withSource = true; break;
      case '--load': opt.load = true; break;
      case '--dry-run': opt.dryRun = true; opt.build = false; break;
      case '-h':
      case '--help':
        console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
        process.exit(0);
        break;
      default:
        fail(`不认识的参数: ${a}(用 --help 看用法)`);
    }
  }
  if (!opt.version) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    opt.version = pkg.version ?? '0.1.0';
  }
  return opt;
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- docker

function docker(args, opts = {}) {
  const r = spawnSync('docker', args, { cwd: ROOT, stdio: 'inherit', shell: false, ...opts });
  if (r.error && r.error.code === 'ENOENT') {
    fail('找不到 docker 命令。请先安装 Docker Desktop / Docker Engine 并确保它在 PATH 里。');
  }
  if (r.status !== 0) {
    fail(`docker ${args.join(' ')} 失败(退出码 ${r.status})`);
  }
  return r;
}

function dockerOut(args) {
  const r = spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', shell: false });
  if (r.error && r.error.code === 'ENOENT') {
    fail('找不到 docker 命令。请先安装 Docker Desktop / Docker Engine 并确保它在 PATH 里。');
  }
  if (r.status !== 0) {
    fail(`docker ${args.join(' ')} 失败:\n${r.stderr || ''}`);
  }
  return (r.stdout ?? '').trim();
}

// ---------------------------------------------------------------- compose 变体

/**
 * 从仓库里的 docker-compose.yml 生成"镜像部署版"。
 *
 * 做法:去掉 build 段、把 image 指向打包出来的镜像,其余(端口/环境变量/数据卷/
 * 健康检查)原样保留 —— 只发一份 compose,免得两处各写一遍慢慢走样。
 *
 * 找不到预期的行就直接报错退出,而不是悄悄产出一份坏文件。
 */
function buildImageCompose(imageRef) {
  const src = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  let sawBuild = false;
  let sawImage = false;
  const out = src
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*build:\s*\.\s*$/.test(line)) {
        sawBuild = true;
        return null;
      }
      if (/^\s*image:\s*\S+\s*$/.test(line)) {
        sawImage = true;
        return line.replace(/image:\s*\S+/, `image: ${imageRef}`);
      }
      return line;
    })
    .filter((l) => l !== null)
    .join('\n');

  if (!sawBuild || !sawImage) {
    fail(
      'docker-compose.yml 的结构变了,生成不了"镜像部署版"。\n' +
        '  脚本需要能找到形如 `build: .` 与 `image: xxx` 的行。\n' +
        '  请看一眼 docker-compose.yml,必要时改脚本里的这两个正则。',
    );
  }
  return out;
}

// ---------------------------------------------------------------- 工具

function sha256File(file) {
  const h = createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function humanSize(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.copyFileSync(from, to);
  return true;
}

// ---------------------------------------------------------------- 主流程

const opt = parseArgs(process.argv.slice(2));
const platTag = opt.platform.replace(/[^a-z0-9]+/gi, '-');
const imageRef = `${opt.image}:${opt.version}`;
const outDir = path.resolve(ROOT, opt.out);
const tarName = `${opt.image}-${opt.version}-${platTag}.tar`;
const tarPath = path.join(outDir, tarName);

console.log('');
console.log('  BIPH 场地管理台 —— Docker 打包');
console.log('  ────────────────────────────────────────────');
console.log(`  镜像      ${imageRef}`);
console.log(`  目标平台  ${opt.platform}`);
console.log(`  输出目录  ${outDir}`);
console.log('');

// 1. docker 在不在
if (opt.dryRun) {
  console.log('  ! --dry-run:跳过 docker 检查与构建,只生成 compose 与部署说明');
} else {
  const serverVersion = dockerOut(['version', '--format', '{{.Server.Version}}']);
  console.log(`  ✓ Docker 服务端 ${serverVersion}`);
}

// 2. 构建
if (opt.build) {
  console.log('');
  console.log('  → 构建镜像(第一次会拉基础镜像和 npm 依赖,要几分钟)...');
  docker(['build', '--platform', opt.platform, '-t', imageRef, '.']);
} else if (!opt.dryRun) {
  console.log('');
  console.log('  → 跳过构建,使用已有镜像');
}
if (!opt.dryRun) {
  const imageId = dockerOut(['image', 'inspect', imageRef, '--format', '{{.Id}}']);
  console.log(`  ✓ 镜像就绪 ${imageId.slice(7, 19)}`);
}

// 3. 导出
fs.mkdirSync(outDir, { recursive: true });
if (opt.dryRun) {
  console.log('  ! --dry-run:跳过镜像导出与校验和');
} else {
  if (fs.existsSync(tarPath)) fs.rmSync(tarPath);
  console.log('');
  console.log('  → 导出镜像 tar...');
  docker(['save', '-o', tarPath, imageRef]);
  const tarSize = fs.statSync(tarPath).size;
  console.log(`  ✓ ${tarName} (${humanSize(tarSize)})`);

  // 4. 校验和
  const sum = sha256File(tarPath);
  fs.writeFileSync(`${tarPath}.sha256`, `${sum}  ${tarName}\n`, 'utf8');
  console.log(`  ✓ sha256 ${sum.slice(0, 16)}...`);
}

// 5. compose 变体 + 说明
fs.writeFileSync(path.join(outDir, 'docker-compose.yml'), buildImageCompose(imageRef), 'utf8');
copyIfExists(path.join(ROOT, 'README.md'), path.join(outDir, 'README.md'));
console.log('  ✓ docker-compose.yml(镜像部署版,已去掉 build 段)');

fs.writeFileSync(path.join(outDir, '部署说明.md'), deployDoc({ imageRef, tarName, platTag, opt }), 'utf8');
console.log('  ✓ 部署说明.md');

// 6. 源码包(可选)
if (opt.withSource && !opt.dryRun) {
  const srcTar = path.join(outDir, `${opt.image}-${opt.version}-source.tar.gz`);
  if (fs.existsSync(srcTar)) fs.rmSync(srcTar);
  console.log('');
  console.log('  → 打源码包(供"服务器有外网"时直接构建)...');
  const tar = spawnSync(
    'tar',
    [
      '--exclude=node_modules',
      '--exclude=*/node_modules',
      '--exclude=dist',
      '--exclude=*/dist',
      '--exclude=.git',
      '--exclude=server/.smoke',
      '--exclude=data',
      '-czf', srcTar, '-C', ROOT, '.',
    ],
    { stdio: 'inherit', shell: false },
  );
  if (tar.error && tar.error.code === 'ENOENT') {
    console.warn('  ! 找不到 tar 命令,跳过源码包(Windows 10+ 自带 tar,一般都在)');
  } else if (tar.status !== 0) {
    console.warn('  ! 源码包打包失败,跳过');
  } else {
    console.log(`  ✓ ${path.basename(srcTar)} (${humanSize(fs.statSync(srcTar).size)})`);
  }
}

// 7. 可选:load 回本机自测
if (opt.load && !opt.dryRun) {
  console.log('');
  console.log('  → docker load 回本机(自测)...');
  docker(['load', '-i', tarPath]);
}

console.log('');
console.log('  ✓ 打包完成');
console.log(`    ${outDir}`);
console.log('');
if (opt.dryRun) {
  console.log('  (dry-run:没有真的导出镜像 tar)');
  console.log('');
} else {
  console.log('  拷到目标服务器后:');
  console.log(`    docker load -i ${tarName}`);
  console.log('    docker compose up -d');
  console.log('');
}

// ---------------------------------------------------------------- 部署说明
// ---------------------------------------------------------------- 部署说明

/**
 * 部署说明走独立的 markdown 模板文件(而不是塞在 JS 模板字符串里):
 * 模板里的 ``` 围栏会和 JS 的反引号打架,而且改文案不用碰代码。
 */
function deployDoc({ imageRef, tarName, opt }) {
  const tpl = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy-doc.template.md'), 'utf8');
  return tpl
    .replaceAll('{{IMAGE_REF}}', imageRef)
    .replaceAll('{{TAR_NAME}}', tarName)
    .replaceAll('{{PLATFORM}}', opt.platform);
}

