# syntax=docker/dockerfile:1

ARG APP_DIR=website
ARG BASE_IMAGE=docker.m.daocloud.io/oven/bun:1-alpine

FROM ${BASE_IMAGE}
ARG APP_DIR
WORKDIR /app

RUN sed -i 's#https\?://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories

COPY ${APP_DIR}/package.json ${APP_DIR}/bun.lockb ./
RUN bun install --frozen-lockfile --registry=https://registry.npmmirror.com
COPY ${APP_DIR}/ .
RUN bun run build
EXPOSE 4321
CMD ["bun", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4321"]
