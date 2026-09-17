# 墨言单词后端部署指南

## 方案选择

| 方案 | 难度 | 月费 | 适合 |
|------|------|------|------|
| **云服务器** | 低 | ¥20-40 | 长期使用 |
| **Docker Compose** | 中 | ¥20-40 | 熟悉 Docker |
| **云函数/Serverless** | 高 | ¥0-10 | 低频使用 |
| **Railway/Render** | 低 | ¥0 | 海外部署 |

推荐：**云服务器 + Docker Compose**， Rust 后端内存占用极低（5-10MB），最低配 1核512MB 就能跑。

---

## 推荐方案：云服务器 + Docker

### 1. 购买服务器

国内推荐（需要备案域名才能用 80/443 端口）：
- **阿里云** 轻量应用服务器：1核512MB + 20G SSD，约 ¥24/月
- **腾讯云** 轻量应用服务器：1核1GB + 25G SSD，约 ¥40/月
- **华为云** Flexus 应用服务器：1核1GB，约 ¥30/月

海外推荐：
- **Vultr** / **Linode** / **DigitalOcean**: 1核512MB + 10G SSD，约 $3.5/月
- **腾讯云轻量（海外版）**：约 ¥25/月

系统选 **Ubuntu 22.04 LTS**。

### 2. 连接服务器

```bash
ssh root@你的服务器IP
```

### 3. 安装 Docker

```bash
# 一键安装 Docker
curl -fsSL https://get.docker.com | sh

# 启动 Docker
systemctl enable docker
systemctl start docker

# 验证
docker --version
```

### 4. 上传后端代码

**方式 A：本地打包上传**

```bash
# 在本地，把后端代码打包
cd moyan-backend
tar czf backend.tar.gz .

# 上传到服务器
scp backend.tar.gz root@你的服务器IP:/root/

# SSH 到服务器解压
ssh root@你的服务器IP "mkdir -p /opt/moyan && cd /opt/moyan && tar xzf /root/backend.tar.gz"
```

**方式 B：直接从 Git 拉取**

```bash
# SSH 到服务器
ssh root@你的服务器IP

# 把代码放到 /opt/moyan
mkdir -p /opt/moyan
cd /opt/moyan
# 把你的代码传上来，或者用 git clone
```

### 5. 配置环境变量

```bash
cd /opt/moyan

cat > .env << 'EOF'
PORT=8080
DATABASE_URL=sqlite:/data/moyan.db
JWT_SECRET=改成一个随机字符串至少32位
GOOGLE_CLIENT_ID=你的Google Client ID
GOOGLE_CLIENT_SECRET=你的Google Client Secret
GOOGLE_REDIRECT_URL=https://你的域名/api/auth/google/callback
EOF
```

`JWT_SECRET` 生成方法：
```bash
# 生成一个随机密钥
openssl rand -base64 32
# 把输出复制到 JWT_SECRET
```

### 6. 启动服务

```bash
cd /opt/moyan

# 构建并启动（Rust 二进制随仓库提交，本地/CI 用 scripts/build-rust.sh 编好；
# 这里只构建 runtime 层，不跑 cargo。详见仓库根 README 的「Rust 服务的构建与部署」）
docker compose up -d

# 查看日志
docker compose logs -f

# 确认运行
curl http://localhost:8080/api/health
```

### 7. 配置 Nginx 反向代理（推荐）

如果你有自己的域名，用 Nginx 做反向代理 + HTTPS：

```bash
# 安装 Nginx
apt update && apt install -y nginx certbot python3-certbot-nginx

# 配置 Nginx
cat > /etc/nginx/sites-available/moyan << 'EOF'
server {
    listen 80;
    server_name 你的域名;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 支持 WebSocket
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

# 启用配置
ln -sf /etc/nginx/sites-available/moyan /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# 申请 HTTPS 证书（ certbot 会自动配置 ）
certbot --nginx -d 你的域名 --agree-tos --non-interactive --email 你的邮箱
```

### 8. 防火墙放行

```bash
# 开放 HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

---

## 前端连接后端

修改前端项目的 `.env` 文件：

```bash
# /mnt/agents/output/app/.env
VITE_API_URL=https://你的域名
```

重新构建前端：
```bash
cd /mnt/agents/output/app
npm run build
# 然后把 dist/ 部署到你的静态托管（Vercel / Netlify / 云存储）
```

---

## 没有域名怎么办？

### 直接用 IP + 端口（开发测试）

```bash
# .env 里的 GOOGLE_REDIRECT_URL 改成 IP
GOOGLE_REDIRECT_URL=http://你的服务器IP:8080/api/auth/google/callback

# 前端 .env
VITE_API_URL=http://你的服务器IP:8080
```

**注意**：Google OAuth 要求回调地址必须是 HTTPS（或 localhost），IP 地址的 HTTP 回调会被拒绝。建议至少用一个域名 + 免费 SSL。

### 免费域名方案

- **Cloudflare Pages** / **Vercel** / **Netlify**：部署前端
- **DuckDNS** / **No-IP**：免费动态域名指向你的服务器
- 配合 Cloudflare Tunnel（免费，不需要开放端口）

---

## Cloudflare Tunnel 方案（最简单，免费）

如果你的服务器没有固定 IP 或者不想配置防火墙：

```bash
# 1. 安装 cloudflared
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i cloudflared-linux-amd64.deb

# 2. 登录 Cloudflare
cloudflared tunnel login

# 3. 创建隧道
cloudflared tunnel create moyan-backend

# 4. 配置隧道
cat > ~/.cloudflared/config.yml << EOF
tunnel: $(cloudflared tunnel list | grep moyan-backend | awk '{print $1}')
credentials-file: ~/.cloudflared/$(cloudflared tunnel list | grep moyan-backend | awk '{print $1}').json

ingress:
  - hostname: moyan-api.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
EOF

# 5. 启动隧道
cloudflared tunnel route dns moyan-backend moyan-api.yourdomain.com
cloudflared tunnel run moyan-backend
```

这样你的后端就有了 `https://moyan-api.yourdomain.com`，不需要买服务器公网 IP，Cloudflare 自动处理。

---

## 服务器最低配置要求

| 资源 | 需求 | 说明 |
|------|------|------|
| CPU | 1 核 | Rust 单线程性能极强 |
| 内存 | 256MB | 运行时约 5-10MB |
| 磁盘 | 1GB | SQLite 数据库 + 二进制 |
| 带宽 | 1Mbps | 数据量很小 |

---

## 维护命令

```bash
# 查看运行状态
docker compose ps

# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 更新代码后：git pull 拉到新二进制 → 重启（服务端不编译）
git pull
docker compose up -d

# 备份数据库
cp /opt/moyan/data/moyan.db /opt/moyan/data/moyan.db.$(date +%Y%m%d)

# 查看数据库大小
du -sh /opt/moyan/data/moyan.db
```
