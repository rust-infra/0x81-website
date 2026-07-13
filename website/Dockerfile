# syntax=docker/dockerfile:1

ARG BASE_IMAGE=docker.m.daocloud.io/oven/bun:1-alpine

FROM ${BASE_IMAGE}
WORKDIR /app

RUN sed -i 's#https\?://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --registry=https://registry.npmmirror.com
COPY . .
RUN bun run build
EXPOSE 4321
CMD ["bun", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4321", "--allowed-hosts", "true"]
