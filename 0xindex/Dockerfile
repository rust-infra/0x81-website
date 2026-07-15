ARG BASE_IMAGE=docker.m.daocloud.io/oven/bun:1-alpine

FROM ${BASE_IMAGE} AS build
WORKDIR /app

RUN sed -i 's#https\?://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --registry=https://registry.npmmirror.com
COPY . .
RUN bun run build

FROM ${BASE_IMAGE}
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY server.ts ./

ENV PORT=4320
EXPOSE 4320
CMD ["bun", "run", "server.ts"]
