ARG NODE_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:20-alpine
ARG CADDY_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/caddy:2-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Docker 走 npm ci + package-lock.json（同一提交装出同一份依赖）；
# bun.lockb 只服务本机 `bun run server.ts` 的开发流程。
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm config set replace-registry-host always \
    && npm ci
COPY . .
RUN npx astro build

FROM ${CADDY_IMAGE}
COPY --from=build /app/dist /usr/share/caddy/html
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 4322
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
