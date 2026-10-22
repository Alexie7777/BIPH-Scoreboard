# BIPH 场地管理台 —— 打包与部署手册

> 面向:要在**另一台服务器**上跑起来。
> 主推路径:**GitHub 仓库放源码,服务器 clone 下来现场构建**;目标服务器没有外网时改走离线部署包。

---

## 0. 先选一条路

| 你的情况 | 走哪条 | 代价 |
|---|---|---|
| 目标服务器**能上外网** | **路径 A:GitHub 仓库** | 服务器上 `git clone` + `docker compose up -d --build`,几分钟 |
| 目标服务器**没有外网**(校园网内网常见) | **路径 B:离线部署包** | 在你自己的机器上先 build 好,拷一个 tar 过去 |
| 目标服务器**没装 Docker** | 先装 Docker,再走 A 或 B | 见 §6 |

> 「没有外网」不只是拉不动 npm:基础镜像 `node:24-alpine` 也得从 Docker Hub 拉。
> 所以离线服务器的正解是**在有网的机器上把镜像导出成 tar**,别指望在服务器上现场构建。

### 为什么是 Git 仓库而不是镜像仓库

| | Docker Hub | GitHub 仓库 |
|---|---|---|
| 国内拉取速度 | 官方仓库是国内最慢的,常超时,得配加速器 | clone 用 `--depth 1` 就够快,也能换 Gitee |
| 服务器上要多存什么 | 私有镜像必须 `docker login`,会留下 PAT 凭据 | **公开仓库什么都不用存**;私有仓库才需要 deploy key |
| 限流 | 匿名拉 10 次/小时/IP(登录后 100/小时),学校 NAT 共享出口 IP 容易撞线 | 无 |
| 升级 | 改完代码要重新 build + push + pull 镜像 | `git pull` + 重建,同一个流程 |
| 回滚 | 换镜像 tag | `git checkout <tag>` 再重建 |

> 如果你确实不想让服务器现场构建,又想要一个远程镜像仓库,用 **GHCR**(GitHub Container Registry)
> 比 Docker Hub 省心:和 GitHub 账号一体、私有包免费、公开镜像匿名拉不限流。

---

## 1. 路径 A:GitHub 仓库(主推)

### 1.1 在开发机上建仓并推送

```bash
cd BIPH-Scoreboard
git init                      # 已经 init 过就跳过
git add -A
git commit -m "BIPH 场地管理台 v0.1.0"
git tag v0.1.0                 # 给每个可部署版本打个 tag,回滚要用
git remote add origin https://github.com/Alexie7777/BIPH-Scoreboard.git
git push -u origin main
git push origin v0.1.0
```

仓库地址:<https://github.com/Alexie7777/BIPH-Scoreboard>

> 仓库是**公开**的,所以服务器上 `git clone` 不需要任何凭据,也不需要在服务器上存 token。

> 仓库里**不含**任何真实数据:`server/.smoke/`(SQLite 比赛库、私钥、上传的队徽)与
> `docs/screenshots/`(含真实赛事名与队名的界面截图)都已在 `.gitignore` 里。
> 推送前可以自己核一遍:`git ls-files | grep -E "smoke|screenshots|\\.db"`(应该没有输出)。

### 1.2 在服务器上 clone 并启动

```bash
sudo git clone https://github.com/Alexie7777/BIPH-Scoreboard.git /opt/BIPH-Scoreboard
cd /opt/BIPH-Scoreboard
docker compose up -d --build
docker compose logs -f scoreboard
```

> **如果以后把仓库改回私有**,服务器 clone 就需要凭据了。推荐用 **deploy key** ——
> 一把只读的 SSH 密钥,只对这个仓库有效,可以在 GitHub 上一键吊销:
>
> ```bash
> # 在服务器上
> ssh-keygen -t ed25519 -C "biph-server" -f ~/.ssh/biph_deploy -N ""
> cat ~/.ssh/biph_deploy.pub   # 贴到 Settings → Deploy keys,不要勾 "Allow write access"
>
> # 告诉 git 这个仓库用哪把钥匙
> cat >> ~/.ssh/config <<'EOF'
> Host github-biph
>     HostName github.com
>     User git
>     IdentityFile ~/.ssh/biph_deploy
>     IdentitiesOnly yes
> EOF
> chmod 600 ~/.ssh/config ~/.ssh/biph_deploy
>
> # 然后用 SSH 地址 clone
> sudo git clone git@github-biph:Alexie7777/BIPH-Scoreboard.git /opt/BIPH-Scoreboard
> ```

### 1.4 ⚠️ 必做:告诉证书你的宿主机 IP(`CERT_NAMES`)

**这一步不做,控制台一定连不上。**

自签证书的 SAN 来自 `os.networkInterfaces()`。在 Docker 里,它只能看到**容器自己的网卡**
(172.x),看不到宿主机的 IP。于是:

- 浏览器打开 `https://<宿主机IP>:18080/` → 报**证书名称不匹配** → 点「继续前往」还能看页面
- 控制台连 `wss://<宿主机IP>:18080/ws/...` → 同样的证书错误,**WebSocket 没有「继续前往」可点**
  → 连接被浏览器直接拦死,控制台永远显示「连接中断」
- 大屏其实也连不上,只是它有 REST 兜底,比分照样显示,所以不容易发现

**做法**:

```yaml
# docker-compose.yml
environment:
  CERT_NAMES: "10.37.2.208"        # 换成你的宿主机 IP(可逗号分隔写多个)
```

```bash
# 旧证书缓存在数据卷里,不会自动重签 —— 删掉再重启
docker compose exec scoreboard sh -c 'rm -f /data/cert/server.crt /data/cert/server.key'
docker compose up -d
```

**验证 SAN 已经包含这个 IP**:

```bash
echo | openssl s_client -connect 10.37.2.208:18080 2>/dev/null \
  | openssl x509 -noout -text | grep -A1 "Subject Alternative Name"
```

要看到的是 **`IP Address:10.37.2.208`**。

> ⚠️ **必须是 `IP Address:`,不能是 `DNS:10.37.2.208`。**
> 证书的 SAN 分两种条目:`DNS:` 只能匹配主机名,`IP Address:` 才能匹配 IP 地址。
> 按 RFC 6125,浏览器拿 IP 访问时**只认 `IP Address:` 条目** —— 写成 `DNS:` 等于没写,
> 浏览器照样报"证书名称不匹配",WebSocket 照样被拦死。
> (旧版本的 `CERT_NAMES` 正是这个毛病:填进去的 IP 一律被当成域名。现已修好。)

> **iPad 还要多一步**:SAN 对上只是"名字对了",iOS 还要求证书**被信任**,否则 WebSocket 照样被拦。
> Safari 访问一次 `https://<IP>:18080/` 下载证书 → 设置 → 通用 → VPN与设备管理 → 安装 →
> 设置 → 通用 → 关于本机 → **证书信任设置** → 打开「完全信任」(这步不能漏)。

### 1.5 以后更新

```bash
cd /opt/BIPH-Scoreboard
./scripts/deploy.sh              # 拉代码 → 重建镜像 → 重启 → 打印状态和日志
```

回滚到某个版本:

```bash
./scripts/deploy.sh --rollback v0.1.0
```

> 数据在 Docker 卷 `biph-data` 里,**重建镜像不会丢比赛数据**。
>
> ⚠️ 改过 `CERT_NAMES` 或换过宿主机 IP 之后,记得**再删一次旧证书**:
> `docker compose exec scoreboard sh -c 'rm -f /data/cert/server.*' && docker compose up -d`

### 1.6 部署后自检(照着抄一遍就知道有没有问题)

**第一层:服务活着吗**

```bash
curl -k https://127.0.0.1:8080/api/health
# 期望: {"ok":true,...,"dbWritable":true,...}

curl -k -o /dev/null -w '首页 HTTP %{http_code}\n' https://127.0.0.1:8080/
# 期望: 首页 HTTP 200
```

> 命令里的 `-k` 不能省:服务默认是 HTTPS(自签证书),不加 `-k` 会报证书错误,
> 看起来像"服务挂了",其实是证书没被信任。

**第二层:容器状态对吗**

```bash
docker compose ps
# STATUS 列期望: Up ... (healthy)
```

> 探针走 HTTPS(自签证书校验已在探针内关闭),但也兼容你把 `HTTPS: "false"` 的情况 ——
> 两种模式都判得对。
> `start_period` 设的是 60 秒:小内存机器上 Node 冷启动可能要几十秒,
> 这段时间状态是 `health: starting`,属正常,别急着判失败。

**第三层:控制台真的连得上吗(关键)**

浏览器能打开页面 ≠ 控制台能连上。控制台连的是 WebSocket,证书不对会被浏览器直接拦死。

```bash
# 拿一个已有比赛的控制令牌
MID=$(curl -k -s https://127.0.0.1:8080/api/matches | jq -r '.matches[0].id')
TOKEN=$(curl -k -s "https://127.0.0.1:8080/api/matches/$MID/qr?role=control" \
        | grep -o 't=[^"&]*' | cut -d= -f2)

# 握手
curl -k -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://127.0.0.1:8080/ws/$MID?role=control&t=$TOKEN" | head -1
# 期望: HTTP/1.1 101 Switching Protocols
```

**必须看到 101。** 看到 200 或直接连不上,回 §1.4 查证书 SAN ——
十有八九是 `CERT_NAMES` 没填对,或者填了 IP 却没删旧证书。

---

## 2. 路径 B(给没有外网的校园网服务器):离线部署包

### 2.1 在你有网的机器上打包

```bash
cd BIPH-Scoreboard
npm run package:docker              # 等价于 node scripts/package-image.mjs
```

产出在 `dist/`:

```
dist/
├── biph-0.1.0-linux-amd64.tar        镜像本体(docker load 直接吃)
├── biph-0.1.0-linux-amd64.tar.sha256 校验和
├── docker-compose.yml                镜像部署版(已去掉 build 段)
├── 部署说明.md                        拷过去照着做
└── README.md
```

常用参数:

| 参数 | 作用 |
|---|---|
| `--platform linux/arm64` | 目标服务器是 ARM(飞腾 / 鲲鹏 / 树莓派)时用 |
| `--with-source` | 额外打一份干净源码包,供路径 A 使用 |
| `--no-build` | 不重新构建,只导出现有镜像 |
| `--load` | 打包后在本机 `docker load` 回来,顺手自测 |
| `--dry-run` | 不碰 Docker,只生成 compose 与部署说明(预览用) |
| `--out <目录>` | 换个输出目录 |

### 2.2 拷到服务器

```bash
scp -r dist user@server:/opt/biph/
```

### 2.3 在服务器上启动

```bash
cd /opt/biph
docker load -i biph-0.1.0-linux-amd64.tar
docker compose up -d
docker compose logs -f scoreboard
```

详细的验证、备份、迁移、故障排查见 **`dist/部署说明.md`**(打包时自动生成,跟着 tar 一起走)。

---

## 3. 不用任何托管服务:直接拷源码

不想建仓、也不想开公网仓库的话,直接拷目录:

```bash
scp -r BIPH-Scoreboard user@server:/opt/
cd /opt/BIPH-Scoreboard
docker compose up -d --build
```

也可以用打包脚本顺手产出的源码包:

```bash
npm run package:docker -- --with-source
# 得到 dist/biph-0.1.0-source.tar.gz
scp dist/biph-0.1.0-source.tar.gz user@server:/opt/
# 服务器上:
tar xzf biph-0.1.0-source.tar.gz -C /opt/BIPH-Scoreboard
cd /opt/BIPH-Scoreboard && docker compose up -d --build
```

代价:没有版本管理,更新要重新拷一遍。

---

## 4. 镜像本身是怎么做出来的

`Dockerfile` 是三段式:

| 阶段 | 做什么 |
|---|---|
| `client-build` | 装依赖 → 构建前端产物 |
| `server-build` | 装依赖 → 构建后端产物 |
| `runtime` | **自己再装一次生产依赖**(`npm ci --omit=dev`)→ 只拷编译产物,不带源码、不带工具链 |

运行时镜像里没有编译工具链 —— SQLite 用的是 Node 内置的 `node:sqlite`,
自签证书用 `node-forge` 在 JS 里生成(不调 openssl),所以 `node:24-alpine` 就够了。

> **为什么 runtime 阶段要自己再装一次依赖?**
> 这是个 **npm workspaces** 工程。某些包版本和根目录冲突时,npm 会把它们**嵌套**装到
> 工作区自己的 `node_modules` 下 —— 比如 `@fastify/static` 装在
> `server/node_modules/@fastify/static`,根目录的 `node_modules` 里根本没有它
> (锁文件里写死了这个位置)。
>
> 如果只把 `/app/node_modules` 复制进镜像,容器里就找不到它,启动直接崩:
>
> ```
> Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@fastify/static'
> imported from /app/server/dist/index.js
> ```
>
> 在 runtime 阶段自己跑一次 `npm ci --omit=dev`,npm 会按同一份锁文件把嵌套的那份
> 也装到同样的位置,布局天然和构建阶段一致 —— 不用猜包被放在哪。

### `.dockerignore` 里必须排掉的东西

运行期数据**绝对不能进构建上下文**。`.gitignore` 排了,`.dockerignore` 也得排 ——
两边漏一处,真实比赛数据(还有自签证书的**私钥**)就会被打进镜像里。

已排掉:`node_modules` / `dist` / `data` / `server/.smoke` / `*.db` / `.env` / `docs` / 测试文件。

---

## 5. 换服务器 / 备份 / 恢复

所有运行期数据都在 Docker 卷 `biph-data` 里:

```
scoreboard.db   SQLite(比赛、比分、规则、设置)
uploads/        上传的队徽
cert/           自签证书与私钥
```

**备份**:

```bash
docker run --rm -v biph-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/biph-backup-$(date +%F).tar.gz -C /data .
```

**换服务器迁移**:老机器备份 → 新机器 `docker load` + `docker compose up -d` → 解包覆盖进卷:

```bash
docker run --rm -v biph-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/biph-backup-2026-10-22.tar.gz -C /data
```

---

## 6. 服务器准备清单

| 项 | 要求 |
|---|---|
| Docker Engine | 20.10+ / 24+ 均可(`docker compose` v2 需要) |
| 架构 | 与镜像平台一致:x86_64 → `linux/amd64`,ARM → `linux/arm64` |
| 端口 | 默认 `8080`,`docker-compose.yml` 里可改 |
| 磁盘 | 镜像约 200~400MB,数据卷随比赛数增长(很小) |
| 权限 | 用户要在 `docker` 组,否则每次要 `sudo` |

Ubuntu/Debian 装 Docker:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER    # 重新登录生效
```

---

## 7. 常见问题

| 现象 | 原因与对策 |
|---|---|
| `exec format error` | 架构不对。`uname -m` 看目标机:`x86_64` → `--platform linux/amd64`,`aarch64` → `linux/arm64`,重新打包 |
| `docker compose` 报找不到命令 | Compose v2 没装,或 docker-compose v1(`docker-compose` 带连字符)与 v2(`docker compose` 空格)搞混了 |
| 构建时 `npm ci` 卡住/超时 | 构建机没外网 —— 换到有网的机器打包(路径 B) |
| 页面全 404 | 前端产物没进镜像。确认是 `docker compose up -d` 起的,不是手工 `docker run` |
| iPad 比赛中途锁屏 | Wake Lock 需要安全上下文,必须走 `https://`;用 IP 访问要在 iPad 上信任一次自签证书 |
| 手机访问不到服务器 | 校园网 AP 隔离。改 `network_mode: host`(Linux)或接独立热点 |
| 端口被占 | 改 `docker-compose.yml` 的 `ports`,如 `"8081:8080"` |
| 想改管理员密钥 | `docker-compose.yml` 加 `ADMIN_KEY: "你的密钥"`,再 `docker compose up -d` |
| 启动日志里端口/IP 不对 | `docker-compose.yml` 里 `HOST` 应为 `0.0.0.0` |
| `git clone` 报 `Permission denied (publickey)` | 只有仓库是私有时才会遇到。公开仓库直接 `git clone https://github.com/Alexie7777/BIPH-Scoreboard.git` 即可;私有仓库才需要配 deploy key(见 §1.2) |
| `git pull` 报 `Your local changes would be overwritten` | 服务器上有人改过文件。`git stash` 或 `git checkout -- .` 放弃服务器上的改动再 pull |
| `git pull` 报 `refusing to merge unrelated histories` | 远程换过仓库或重建过。`git pull --allow-unrelated-histories origin main` |
| 拉 GitHub 太慢/超时 | 用 `git clone --depth 1`;或把仓库搬到 Gitee / GitCode / 学校自建 GitLab(Git 格式完全一样,改个 remote 就行) |
| `docker compose build` 时拉基础镜像超时 | Docker Hub 在国内慢。给 Docker 配一个 registry mirror,或改走路径 B(离线包) |
| 启动报 `Cannot find package '@fastify/static'` | 镜像里缺了 npm workspaces **嵌套安装**的依赖(它装在 `server/node_modules` 下,不在根 `node_modules`)。已修:runtime 阶段改为自己跑 `npm ci --omit=dev`。你若在用旧镜像,拉最新代码重新 `docker compose up -d --build` |
| 页面能开,但**控制台一直连不上** | 证书的 SAN 里没有宿主机 IP(Docker 里只看得到容器自己的 172.x)。WebSocket 没有「继续前往」可点,被浏览器直接拦死。设 `CERT_NAMES: "<宿主机IP>"` + 删旧证书重启,详见 §1.4 |
| 浏览器报「证书名称不匹配」 | 同上,SAN 里缺这个 IP |
| 容器一直 `unhealthy`,但服务明明能用 | 老版本的 healthcheck 探针用 `http://` 去打只听 HTTPS 的服务,必然失败。现已改为自适应探针(https 优先、http 兜底),拉最新代码重建镜像即可。`docker inspect <容器> --format '{{range .State.Health.Log}}{{.Output}}{{end}}'` 能看到探针的实际输出 |
| 容器长时间 `health: starting` | `start_period` 是 60 秒,小内存机器上冷启动慢。`docker compose logs -f` 看日志,等出现「已启动」字样再判断 |

---

## 8. 实测记录,以及本机没有 Docker 时的说明

### 8.1 已完成的实机验证

在一台 Debian 12(Proxmox LXC,4 核 4GB,Docker 28.3.3 / Compose v2.39.1)上
从零跑通了完整链路:

| 环节 | 结果 |
|---|---|
| `git clone`(公开仓库,免凭据) | 成功,94 个文件 |
| `docker compose build` | 成功,864 秒,镜像 204MB |
| `docker compose up -d` | 容器正常启动,端口 `0.0.0.0:8080->8080` |
| `GET /api/health` | 200,`dbWritable: true` |
| 首页 | 200,1188 字节,`lang="zh-CN"` |
| 前端静态资源 | 200,JS 274KB / CSS 24KB |
| 证书 SAN | 含 `IP Address:<宿主机IP>`(修好了) |
| 控制台 WebSocket 握手 | **101 Switching Protocols**,收到锚点帧 |
| 大屏 WebSocket 握手 | **101** |
| 错误令牌握手 | **401**(鉴权确实生效) |
| 数据持久化 | 卷 `biph-data` 里 db / cert / uploads 都在 |
| `.dockerignore` | 构建上下文 73 个文件 / 0.62MB,无数据库、私钥、上传文件、`.env` |

### 8.2 仍未在真机验证的

- **iPad 真机**:Wake Lock、PWA 安装、「完全信任」证书的完整点击流程
- **真实浏览器访问自签证书的 WSS**:命令行握手已验证(101),
  但浏览器对自签证书不放行时的表现还要在 iPad/Chrome 上人工确认
- **物理拔网线**(大屏断网后计时器继续走)—— 只做过浏览器层面的模拟断网

### 8.3 本机没有 Docker 时

打包脚本依赖 `docker` 命令;本机没装 Docker 时:

- 可以用 `--dry-run` 预览 compose 与部署说明的生成(不碰 Docker);
- 真正的 `build` / `save` 需要在装了 Docker 的机器上跑(Windows 上装 Docker Desktop,
  Linux 上装 Docker Engine 即可);
- 镜像本身的构建与启动已在上面那台 Debian 12 上验证过,可以在服务器上直接 `docker compose build`。
