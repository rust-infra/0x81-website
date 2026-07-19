ARG NODE_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:20-alpine
ARG CADDY_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/caddy:2-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY package.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm config set replace-registry-host always \
    && npm install
COPY . .
RUN npx astro build

FROM ${CADDY_IMAGE}
COPY --from=build /app/dist /usr/share/caddy/html
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 4320
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

