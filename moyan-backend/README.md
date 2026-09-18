# 墨言单词 Rust 后端

高性能 Rust 后端 API，为墨言单词应用提供用户认证和数据同步服务。

系统分层、模块边界和存储一致性设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 技术栈

- **Axum** - Rust Web 框架
- **MVC + Repository** - 简洁的控制器、模型与可替换存储实现
- **SQLx / MongoDB** - SQLite 与 MongoDB 存储适配器
- **JWT** - JSON Web Token 认证
- **Google OAuth 2.0** - Google 登录
- **Kimi OAuth (Device Flow)** - Kimi 设备授权登录

## 快速开始

### 前置要求

- Rust 1.85+ (2024 Edition)
- SQLite（默认）或 MongoDB

### 安装 & 运行

```bash
# 1. 克隆或复制项目
cd moyan-backend

# 2. 复制环境变量文件
cp .env.example .env
# 编辑 .env 填入你的 Google OAuth 凭据

# 3. 编译并运行（SQLite 会自动迁移）
cargo run

# 4. 或编译发布版本
cargo build --release
./target/release/moyan-backend
```

服务器将在 `http://0.0.0.0:8080` 启动。

### Docker 部署

```bash
# 构建镜像
docker build -t moyan-backend .

# 运行容器
docker run -d \
  -p 8080:8080 \
  -v $(pwd)/data:/data \
  -e DATABASE_URL=sqlite:/data/moyan.db \
  -e JWT_SECRET=your-secret-key \
  -e GOOGLE_CLIENT_ID=xxx \
  -e GOOGLE_CLIENT_SECRET=xxx \
  -e GOOGLE_REDIRECT_URL=https://your-domain.com/api/auth/google/callback \
  --name moyan-backend \
  moyan-backend
```

## API 端点

### 认证

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/auth/google/callback?code=xxx` | Google OAuth 回调 |
| POST | `/api/auth/kimi/device` | Kimi Device Flow 获取设备码（后端代理） |
| POST | `/api/auth/kimi/token` | Kimi Device Flow 轮询：授权完成后**服务端**用 userinfo 复核并签发本服务的 JWT |
| POST | `/api/auth/kimi` | ⚠️ **已废弃（410）**：原先客户端提交 access_token 换 JWT，而那里本地解 JWT 不验签，可被自签 `sub` 冒充他人（详见 `controllers/auth.rs`） |
| GET | `/api/auth/me` | 获取当前用户信息 (需 JWT) |
| GET | `/api/auth/stats` | 获取用户统计 (需 JWT) |

### 数据同步

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/sync/upload` | 上传学习数据 (需 JWT) |
| GET | `/api/sync/download` | 下载学习数据 (需 JWT) |
| GET | `/api/sync/status` | 获取同步状态 (需 JWT) |

### 健康检查

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/health` | 服务健康状态 |

## 配置说明

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 否 | 服务端口，默认 8080 |
| `DATABASE_BACKEND` | 否 | `sqlite` (默认) 或 `mongodb` |
| `DATABASE_URL` | 否 | SQLite 路径或 MongoDB URI |
| `MONGODB_DATABASE` | 否 | MongoDB 库名，默认 `moyan` |
| `JWT_SECRET` | 是 | JWT 签名密钥 |
| `GOOGLE_CLIENT_ID` | 是 | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | 是 | Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URL` | 否 | OAuth 回调地址 |

### 使用 MongoDB

```bash
DATABASE_BACKEND=mongodb \
DATABASE_URL=mongodb://mongodb:27017 \
docker compose --profile mongodb up -d --build
```

## 前端集成

在前端 `.env` 文件中设置：

```
VITE_API_URL=https://your-backend-domain.com
VITE_GOOGLE_CLIENT_ID=your-google-client-id
```

前端会自动使用后端 API 进行登录和数据同步。

## 性能优势

- **内存占用**: 启动约 5-10MB (vs Node.js 100MB+)
- **响应延迟**: P99 < 5ms (本地 SQLite)
- **并发处理**: 支持 10K+ 并发连接
- **二进制体积**: Release 构建约 8-12MB
- **启动速度**: 亚秒级冷启动
