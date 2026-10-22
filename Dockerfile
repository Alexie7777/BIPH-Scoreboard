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
# 裁掉 devDependencies,减小运行时镜像
RUN npm prune --omit=dev

# ------------------------------ 3. 运行时 ------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    HOST=0.0.0.0 \
    TZ=Asia/Shanghai

COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/package.json ./package.json
COPY --from=server-build /app/shared/package.json ./shared/package.json
COPY --from=server-build /app/shared/dist ./shared/dist
COPY --from=server-build /app/server/package.json ./server/package.json
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=client-build /app/client/dist ./client/dist

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080

# 健康检查:直接打 /api/health,不依赖 curl(warm 镜像里没有)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
