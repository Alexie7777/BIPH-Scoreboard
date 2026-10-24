#!/usr/bin/env bash
# =============================================================================
# BIPH 场地管理台 —— 服务器端一键部署
#
# 干的事:clone/更新代码 → 写 .env → (必要时)重签证书 → 重建镜像 → 起容器 → 自检
#
# 用法:
#   sudo bash scripts/deploy-on-server.sh --domain gt.biph.com
#   sudo bash scripts/deploy-on-server.sh --domain gt.biph.com --ip 10.37.2.208 --port 18080
#   sudo bash scripts/deploy-on-server.sh --domain gt.biph.com --no-build
#
# 参数:
#   --domain <域名>     证书 SAN 里要带的域名(必填)
#   --ip <IP>           证书 SAN 里要带的 IP(默认:自动探测本机内网 IP)
#   --port <端口>       宿主机端口(默认:沿用 .env / 原值 / 8080)
#   --admin-key <密钥>  管理员密钥(默认 1818)
#   --dir <目录>        部署目录(默认 /opt/BIPH-Scoreboard)
#   --no-build          不重建镜像(只改配置时用)
#   --rebuild           强制重建镜像(即使代码没变)
#
# 幂等:可以反复跑。数据在 Docker 卷里,重建镜像不会丢比赛。
# =============================================================================
set -uo pipefail

REPO_URL="https://github.com/Alexie7777/BIPH-Scoreboard.git"
DOMAIN=""
IP=""
PORT=""
ADMIN_KEY=""
DEPLOY_DIR=""
DO_BUILD=1
FORCE_BUILD=0
OLD_CERT=""
OLD_PORT=""

C_G=$'\033[32m'; C_R=$'\033[31m'; C_Y=$'\033[33m'; C_B=$'\033[36m'; C_0=$'\033[0m'
say()  { echo "${C_G}✓${C_0} $*"; }
warn() { echo "${C_Y}!${C_0} $*"; }
die()  { echo "${C_R}✗ $*${C_0}" >&2; exit 1; }
step() { echo; echo "${C_B}── $* ──${C_0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)    shift; DOMAIN="${1:-}" ;;
    --ip)        shift; IP="${1:-}" ;;
    --port)      shift; PORT="${1:-}" ;;
    --admin-key) shift; ADMIN_KEY="${1:-}" ;;
    --dir)       shift; DEPLOY_DIR="${1:-}" ;;
    --no-build)  DO_BUILD=0 ;;
    --rebuild)   FORCE_BUILD=1 ;;
    -h|--help)   sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "不认识的参数: $1" ;;
  esac
  shift
done

[ -n "$DOMAIN" ] || die "必须给 --domain,例如 --domain gt.biph.com"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/BIPH-Scoreboard}"

echo "══════════════════════════════════════════════"
echo " BIPH 场地管理台 · 服务器部署"
echo " 域名: $DOMAIN"
echo " 目录: $DEPLOY_DIR"
echo "══════════════════════════════════════════════"

# ─────────────────────────── 0. 环境检查 ───────────────────────────
step "0. 环境检查"
command -v docker >/dev/null 2>&1 || die "没装 docker"
docker info >/dev/null 2>&1 || die "docker 不可用(需要 root,或在 docker 组里)"
say "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"

if docker compose version >/dev/null 2>&1; then
  say "docker compose $(docker compose version --short 2>/dev/null)"
else
  die "没有 docker compose v2"
fi

command -v git >/dev/null 2>&1 || die "没装 git"
command -v curl >/dev/null 2>&1 || die "没装 curl"

# 探测本机内网 IP
if [ -z "$IP" ]; then
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  [ -n "$IP" ] || IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')
  [ -n "$IP" ] || warn "探测不到本机 IP,请用 --ip 手动指定"
fi

# 域名解析检查(只提示,不阻断)
DOMAIN_IP=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1; exit}')
if [ -n "$DOMAIN_IP" ]; then
  if [ -n "$IP" ] && [ "$DOMAIN_IP" != "$IP" ]; then
    warn "$DOMAIN 解析到 $DOMAIN_IP,和本机 $IP 不一致 —— 确认 DNS 配对了"
  else
    say "$DOMAIN → $DOMAIN_IP"
  fi
else
  warn "$DOMAIN 解析不出来(还没配 DNS?)部署照常进行,但别人暂时访问不了"
fi

# ─────────────────────────── 1. 取代码 ───────────────────────────
step "1. 取代码"
if [ -d "$DEPLOY_DIR/.git" ]; then
  cd "$DEPLOY_DIR" || die "进不去 $DEPLOY_DIR"
  # 抢救旧配置:用户以前可能手改过 compose(CERT_NAMES / 端口)
  OLD_CERT=$(grep -oE 'CERT_NAMES:[[:space:]]*"[^"]*"' docker-compose.yml 2>/dev/null | head -1 | sed 's/.*"\(.*\)"/\1/')
  OLD_PORT=$(grep -oE '"[0-9]+:8080"' docker-compose.yml 2>/dev/null | head -1 | tr -d '"' | cut -d: -f1)
  # 占位符不是真正的证书名,丢掉
  case "$OLD_CERT" in ''|'${CERT_NAMES:-}'|'${CERT_NAMES}') OLD_CERT="" ;; esac
  if ! git diff --quiet 2>/dev/null; then
    warn "docker-compose.yml 有本地改动,先备份再还原"
    git diff > "$DEPLOY_DIR/.compose-local.patch" 2>/dev/null
    say "备份到 $DEPLOY_DIR/.compose-local.patch"
    git checkout -- . 2>/dev/null
    say "已还原成仓库原样(你的配置改用 .env 表达,以后 pull 不再冲突)"
  fi
  [ -z "$PORT" ] && [ -n "$OLD_PORT" ] && PORT="$OLD_PORT"
  say "更新现有部署"
  if ! git pull --ff-only 2>&1 | tail -3; then
    die "git pull 失败(可能有未提交改动:git status 看一眼)"
  fi
else
  mkdir -p "$(dirname "$DEPLOY_DIR")"
  say "克隆到 $DEPLOY_DIR"
  git clone --depth 1 "$REPO_URL" "$DEPLOY_DIR" 2>&1 | tail -3 || die "clone 失败"
  cd "$DEPLOY_DIR" || die "进不去 $DEPLOY_DIR"
fi
say "当前提交: $(git log --oneline -1)"

# 沿用旧 CERT_NAMES 里的其它名字(不丢用户之前填的东西)
EXTRA_CERTS=""
if [ -n "${OLD_CERT:-}" ]; then
  for n in ${OLD_CERT//,/ }; do
    case "$n" in
      "$DOMAIN"|"$IP") continue ;;
      "") continue ;;
      *) EXTRA_CERTS="${EXTRA_CERTS:+$EXTRA_CERTS,}$n" ;;
    esac
  done
fi
CERT_LIST="$DOMAIN"
[ -n "$IP" ] && CERT_LIST="$CERT_LIST,$IP"
[ -n "$EXTRA_CERTS" ] && CERT_LIST="$CERT_LIST,$EXTRA_CERTS"

# ─────────────────────────── 2. 写 .env ───────────────────────────
step "2. 写 .env"
PORT="${PORT:-8080}"
ENV_FILE="$DEPLOY_DIR/.env"
{
  echo "# BIPH 部署配置 —— 由 deploy-on-server.sh 生成"
  echo "# 改这个文件,不要改 docker-compose.yml(改了以后 git pull 会冲突)"
  echo "HOST_PORT=$PORT"
  echo "CERT_NAMES=\"$CERT_LIST\""
  echo "ADMIN_KEY=\"${ADMIN_KEY:-1818}\""
} > "$ENV_FILE"
say "HOST_PORT=$PORT"
say "CERT_NAMES=\"$CERT_LIST\""
say "ADMIN_KEY=$( [ -n "$ADMIN_KEY" ] && echo '(已自定义)' || echo '1818 (默认)')"

# 端口是否被别人占着
if command -v ss >/dev/null 2>&1; then
  if ss -tln 2>/dev/null | grep -qE "[:.]$PORT[[:space:]]"; then
    if docker ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$PORT->"; then
      say "端口 $PORT 由本项目的容器占用(正常)"
    else
      warn "端口 $PORT 已被别的进程占用,先查清楚: ss -tlnp | grep ':$PORT'"
    fi
  fi
fi

# ─────────────────────────── 3. 证书要不要重签 ───────────────────────────
step "3. 证书"
RESIGN=1
if docker compose ps -q 2>/dev/null | grep -q .; then
  OLD_CERT_PEM=$(docker compose exec -T scoreboard sh -c 'cat /data/cert/server.crt 2>/dev/null' 2>/dev/null)
  if [ -n "$OLD_CERT_PEM" ]; then
    SAN=$(printf '%s' "$OLD_CERT_PEM" | openssl x509 -noout -text 2>/dev/null | grep -A1 "Subject Alternative Name" | tail -1)
    MISSING=""
    for n in ${CERT_LIST//,/ }; do
      if echo "$n" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then KEY="IP Address:$n"; else KEY="DNS:$n"; fi
      echo "$SAN" | grep -qF "$KEY" || MISSING="$MISSING $n"
    done
    if [ -z "$MISSING" ]; then
      RESIGN=0
      say "现有证书已包含全部 SAN,不用重签"
    else
      warn "现有证书缺少:$MISSING —— 需要重签"
    fi
  fi
fi
if [ "$RESIGN" = "1" ]; then
  if docker compose ps -q 2>/dev/null | grep -q .; then
    docker compose exec -T scoreboard sh -c 'rm -f /data/cert/server.crt /data/cert/server.key' >/dev/null 2>&1
    say "删掉旧证书,下次启动按新 SAN 重签"
  else
    say "首次部署,证书会在容器启动时自动生成"
  fi
fi

# ─────────────────────────── 4. 构建 + 启动 ───────────────────────────
step "4. 构建 + 启动"
if [ "$FORCE_BUILD" = "1" ] || [ "$DO_BUILD" = "1" ]; then
  say "构建镜像(第一次要几分钟)"
  if ! docker compose build; then
    echo "--- 构建日志尾部 ---"
    docker compose build 2>&1 | tail -30
    die "构建失败"
  fi
else
  say "跳过构建(--no-build)"
fi

docker compose up -d 2>&1 | tail -5
say "容器已启动"

# ─────────────────────────── 5. 等就绪 ───────────────────────────
step "5. 等待服务就绪(最多 180 秒)"
READY=0
for i in $(seq 1 18); do
  if curl -k -s -m 5 "https://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 \
  || curl -s -m 5 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    say "已就绪(约 $((i*10)) 秒内)"
    READY=1
    break
  fi
  sleep 10
done
if [ "$READY" != "1" ]; then
  echo "--- 启动日志 ---"
  docker compose logs --tail=40 scoreboard
  die "180 秒内没就绪,看上面的日志"
fi

# ─────────────────────────── 6. 自检 ───────────────────────────
step "6. 自检"
HEALTH=$(curl -k -s -m 10 "https://127.0.0.1:$PORT/api/health" 2>/dev/null)
if [ -z "$HEALTH" ]; then HEALTH=$(curl -s -m 10 "http://127.0.0.1:$PORT/api/health" 2>/dev/null); fi
echo "  健康检查: ${HEALTH:-无响应}"
case "$HEALTH" in *'"ok":true'*) say "健康检查通过" ;; *) warn "健康检查没返回 ok:true" ;; esac

CODE=$(curl -k -s -o /dev/null -w '%{http_code}' -m 10 "https://127.0.0.1:$PORT/" 2>/dev/null)
[ "$CODE" = "200" ] || CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://127.0.0.1:$PORT/" 2>/dev/null)
if [ "$CODE" = "200" ]; then say "首页返回 200"; else warn "首页返回 $CODE"; fi

SAN=$(echo | openssl s_client -connect 127.0.0.1:$PORT 2>/dev/null | openssl x509 -noout -text 2>/dev/null | grep -A1 "Subject Alternative Name" | tail -1)
echo "  证书 SAN: ${SAN:-(读不到)}"
for n in ${CERT_LIST//,/ }; do
  if echo "$n" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then KEY="IP Address:$n"; else KEY="DNS:$n"; fi
  if echo "$SAN" | grep -qF "$KEY"; then say "SAN 含 $KEY"; else warn "SAN 缺 $KEY —— 浏览器会报证书名称不匹配"; fi
done

# 控制台能不能连上(WebSocket 必须 101)
NEW=$(curl -k -s -m 20 -X POST -H 'Content-Type: application/json' \
  -d '{"home":{"name":"主队"},"away":{"name":"客队"}}' \
  "https://127.0.0.1:$PORT/api/matches" 2>/dev/null)
MID=$(printf '%s' "$NEW" | grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
TOKEN=$(printf '%s' "$NEW" | grep -oE '"operatorToken"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
if [ -n "$MID" ] && [ -n "$TOKEN" ]; then
  HS=$(curl -k -i -N -m 12 -H "Connection: Upgrade" -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    "https://127.0.0.1:$PORT/ws/$MID?role=control&t=$TOKEN" 2>/dev/null | head -1)
  echo "  控制台握手: $HS"
  case "$HS" in *101*) say "控制台 WebSocket 握手成功(101)" ;; *) warn "握手没成功: $HS" ;; esac
  DH=$(curl -k -i -N -m 12 -H "Connection: Upgrade" -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    "https://127.0.0.1:$PORT/ws/$MID?role=display" 2>/dev/null | head -1)
  case "$DH" in *101*) say "大屏 WebSocket 握手成功(101)" ;; *) warn "大屏握手没成功: $DH" ;; esac
  echo ""
  echo "  控制台: https://$DOMAIN:$PORT/m/$MID/control?t=$TOKEN"
  echo "  大屏:   https://$DOMAIN:$PORT/m/$MID/display"
else
  warn "没建出测试比赛,跳过 WebSocket 检查"
fi

# ─────────────────────────── 7. 收尾 ───────────────────────────
step "7. 收尾"
docker compose ps
echo ""
cat <<EOF
══════════════════════════════════════════════
 部署完成

 本机直接访问:  https://127.0.0.1:$PORT/
 局域网访问:    https://$IP:$PORT/
 走域名:        https://$DOMAIN:$PORT/     (DNS 解析好之后)

 自签证书浏览器会拦 —— 先开首页点「继续前往」,
 再开控制台,否则 WebSocket 没有「继续前往」可点,控制台连不上。

 想用标准 443(不带端口)就加反向代理,关键是这三条:
   proxy_set_header Host              \$host;
   proxy_set_header X-Forwarded-Proto \$scheme;   ← 少了二维码链接变 http://
   proxy_set_header Upgrade    \$http_upgrade;    ← 少了控制台连不上
   proxy_set_header Connection "upgrade";

 以后更新:
   cd $DEPLOY_DIR && git pull && docker compose up -d --build
══════════════════════════════════════════════
EOF
