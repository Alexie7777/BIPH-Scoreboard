#!/usr/bin/env bash
# =============================================================================
# 服务器端一键更新:拉最新代码 → 重建镜像 → 重启容器
#
# 用法(在服务器上):
#   ./scripts/deploy.sh              # 拉最新 + 重建 + 重启
#   ./scripts/deploy.sh --no-build   # 只拉代码 + 重启(不重建镜像,适用于没改代码)
#   ./scripts/deploy.sh --rollback v0.1.0   # 回滚到某个 tag
#
# 数据在 Docker 卷里,重建镜像不会丢比赛数据。
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

DO_BUILD=1
ROLLBACK=""
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --rollback) shift; ROLLBACK="${1:-}" ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "不认识的参数: $arg" >&2; exit 1 ;;
  esac
done

echo "──────────────────────────────────────────────"
echo " 部署更新  $REPO_DIR"

if [ -n "$ROLLBACK" ]; then
  echo " → 回滚到 $ROLLBACK"
  git fetch --tags --quiet
  git checkout "$ROLLBACK"
else
  echo " → 拉取最新代码"
  git pull --ff-only
fi

if [ "$DO_BUILD" = "1" ]; then
  echo " → 重建镜像(第一次会装依赖,要几分钟)"
  docker compose build
fi

echo " → 重启容器"
docker compose up -d

echo " → 当前状态"
docker compose ps

echo ""
echo " 最近 20 行日志:"
docker compose logs --tail=20 scoreboard
echo "──────────────────────────────────────────────"
echo " 部署完成。健康检查: curl -k https://127.0.0.1:8080/api/health"
