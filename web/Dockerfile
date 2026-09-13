FROM node:20-bookworm AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# 用 127.0.0.1 而非 localhost：busybox wget 会优先解析到 IPv6 ::1，
# 而仅监听 IPv4 时连接被拒，会导致容器一直被判为不健康。
HEALTHCHECK --interval=10s --timeout=3s --retries=10 \
  CMD wget -qO- http://127.0.0.1/health || exit 1
