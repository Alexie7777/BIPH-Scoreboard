# BIPH 场地管理台 —— 部署说明

本目录是一个**离线部署包**:服务器不需要外网、不需要源码、不需要装 Node。

- 镜像:`{{IMAGE_REF}}`(平台 `{{PLATFORM}}`)
- 目标:一台装了 Docker 的服务器

---

## 一、拷过去

把**整个目录**拷到服务器(至少要有这两个文件):

| 文件 | 作用 |
|---|---|
| `{{TAR_NAME}}` | 镜像本体,`docker load` 直接吃 |
| `docker-compose.yml` | 启动参数(端口 / 环境变量 / 数据卷) |

```bash
scp {{TAR_NAME}} docker-compose.yml user@server:/opt/biph/
```

> **平台要对**:镜像是给 `{{PLATFORM}}` 构建的。
> 目标服务器是 x86_64 就用 `linux/amd64`,是 ARM(树莓派 / 飞腾 / 鲲鹏)就用 `linux/arm64`。
> 搞错了会报 `exec format error`。

## 二、启动

```bash
cd /opt/biph
docker load -i {{TAR_NAME}}          # 导入镜像,几十秒
docker compose up -d                # 后台启动
docker compose logs -f scoreboard   # 看启动日志
```

日志里会打印局域网访问地址:

```
BIPH 场地管理台 已启动  https://192.168.x.x:8080
```

## 三、验证

```bash
curl -k https://127.0.0.1:8080/api/health
# {"ok":true,...}
```

浏览器打开管理台(首页就是场地清单),新建一场比赛试试。

## 四、数据在哪 / 怎么备份

所有运行期数据都在 **Docker 卷 `biph-data`** 里:

- `scoreboard.db` —— SQLite(比赛、比分、规则、设置)
- `uploads/` —— 上传的队徽
- `cert/` —— 自签证书与私钥

**备份**:

```bash
docker run --rm -v biph-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/biph-backup-$(date +%F).tar.gz -C /data .
```

**恢复**:解压回同一个卷即可。

**换服务器迁移**:老服务器上执行上面的备份,新服务器 `docker load` + `docker compose up -d`
(卷是新建的,空的),再把备份包解开覆盖到卷里:

```bash
docker run --rm -v biph-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/biph-backup-2026-10-22.tar.gz -C /data
```

## 五、HTTPS 自签证书

容器默认开 HTTPS(iPad 的 PWA 与 Wake Lock 要求安全上下文)。
证书在首次启动时自动生成,存在卷里,换 IP 不会变。

用 IP 访问时,iPad 会提示「证书不受信任」,需要手动信任一次:

> 设置 → 通用 → 关于本机 → 证书信任设置 → 打开对应证书的完全信任开关

想用学校自己的域名证书,把 `server.key` / `server.crt` 放进卷的 `cert/` 目录即可复用
(文件名叫 `server.key` / `server.crt`),或用 `CERT_NAMES` 环境变量给自签证书补 SAN。

## 六、常用命令

```bash
docker compose ps          # 看状态
docker compose logs -f     # 看日志
docker compose restart     # 重启
docker compose down        # 停止(数据保留在卷里)
docker compose up -d --force-recreate   # 换镜像版本后重新起
```

## 七、出问题怎么办

| 现象 | 多半是 |
|---|---|
| `exec format error` | 平台不对(amd64 / arm64 搞反了),重新打包 |
| 页面全 404 | 前端产物没进镜像 —— 确认是用 `docker compose up -d` 起的,不是手工 `docker run` |
| iPad 锁屏 | Wake Lock 需要 HTTPS;确认走的是 `https://`,不是 `http://` |
| 手机访问不到 | 校园网 AP 隔离。改用 `network_mode: host`,或换独立热点 |
| 端口被占 | 改 `docker-compose.yml` 里的 `ports`,例如 `"8081:8080"` |
| 想改管理员密钥 | `docker-compose.yml` 里加 `ADMIN_KEY: "你的密钥"`,然后 `docker compose up -d` |
