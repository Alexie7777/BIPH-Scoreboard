# syntax=docker/dockerfile:1

# =============================================================================
# BIPH 场地管理台 —— 本地自托管篮球记分牌
# 多阶段构建:前端 → 后端 → 运行时
# 运行时零原生依赖(SQLite 用 Node 内置 node:sqlite),镜像不需要编译工具链。
# =============================================================================

# ------------------------------ 1. 构建前端 ------------------------------
FROM node:24-alpine AS client-build
WORKDIR /app
ENV CI=true
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY shared/ shared/
COPY client/ client/
RUN npm run build:shared && npm run build:client

# ------------------------------ 2. 构建后端 ------------------------------
FROM node:24-alpine AS server-build
WORKDIR /app
ENV CI=true
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY shared/ shared/
COPY server/ server/
RUN npm run build:shared && npm run build:server

# ------------------------------ 3. 运行时 ------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    HOST=0.0.0.0 \
    TZ=Asia/Shanghai

# 生产依赖在运行时阶段【单独装一次】,不要靠上一阶段的 `npm prune --omit=dev`。
#
# 为什么:这是个 npm workspaces 工程。有些包的版本和根目录冲突时,
# npm 会把它们【嵌套】安装到工作区自己的 node_modules 下 ——
# 例如 @fastify/static 装在 server/node_modules/@fastify/static,
# 根目录的 node_modules 里根本没有它(锁文件里写死了这个位置)。
#
# 如果只把 /app/node_modules 复制进镜像,容器里就找不到 @fastify/static,
# 启动直接崩:
#     Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@fastify/static'
#
# 在这里自己跑一次 `npm ci --omit=dev`,npm 会按同一份锁文件把嵌套的那份
# 也装到同样的位置,布局天然和构建阶段一致 —— 不用猜包被放在哪。
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=server-build /app/shared/dist ./shared/dist
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=client-build /app/client/dist ./client/dist

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080

# 健康检查:直接打 /api/health,不依赖 curl(warm 镜像里没有)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
