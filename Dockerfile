# syntax=docker/dockerfile:1

ARG APP_DIR=website
ARG BASE_IMAGE=docker.m.daocloud.io/library/node:22-alpine

FROM ${BASE_IMAGE}
ARG APP_DIR
WORKDIR /app

RUN sed -i 's#https\?://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories \
  && npm config set registry https://registry.npmmirror.com

COPY ${APP_DIR}/package.json ${APP_DIR}/package-lock.json ./
RUN npm ci
COPY ${APP_DIR}/ .
RUN npm run build
EXPOSE 4321
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4321"]
