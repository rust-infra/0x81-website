// Package config 集中读取与校验环境变量（§7.7）。
//
// 设计原则：**该报错的必须报错退出，不给假默认值。** 这是从
// docker-compose.yml 的 `:-change-me-in-production` 那个坑里学来的——
// 默认值会让「服务器上漏改 .env」变成「服务正常启动但所有 token 验不过」，
// 比启动失败难查得多。compose 侧用 `:?` 强制校验，这里做第二道。
//
// 全仓唯一有默认值的键是 `DATABASE_URL`（见 `DefaultDatabaseURL`），那是一个
// **刻意的例外**，并且配了三件事把「静默用错库」这件事变吵：启动时 WARN、
// `/health` 里带 `database_defaulted`、compose 里的默认值写成容器内绝对路径。
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// DefaultDatabaseURL 是 `DATABASE_URL` 未设置时用的连接串（§7.3.5）。
//
// **为什么默认 SQLite**：SQLite 后端 2026-10-10 加进来，本来是为了「一致性测试
// 终于跑得起来」与「本地开发不用起 PG」。但这两件事有个隐含前提——
// **不设 DATABASE_URL 也能起服务**。原来的实现把它设成必填，而 README 里写的
// 「未设置时回落到 sqlite:./data/rehearse.db」一直没有代码支撑（稿子先于代码）。
// 现在补上。
//
// **代价必须说清楚**：默认值把「线上漏配 DATABASE_URL」从**启动失败**变成了
// **静默跑在单副本 SQLite 上**——正是本包想避免的那类失败。所以配套做了三件事：
//
//  1. `cmd/rehearse` 启动时打一条 WARN，并且说清该设成什么
//  2. `/health` 的响应里带 `dialect` 与 `database_defaulted`，
//     运维一条 curl 就能判出「现在跑在默认库上」
//  3. compose 侧默认值写成容器路径 `sqlite:/data/rehearse.db`
//     （`rehearse-data` 卷已经挂在 `/data`）
//
// 生产仍然应当**显式写 Postgres**（Supabase pooler，§7.3.2）：SQLite
// **只支持单副本**（多进程写同一文件靠文件锁，跨容器/网络卷会静默失效），
// 也没有托管备份与 PITR。
const DefaultDatabaseURL = "sqlite:./data/rehearse.db"

// ResolveDatabaseURL 给出实际要用的连接串，以及它是否来自内置默认值。
//
// 空串与「只有空格」都算未设置——env 文件里留一个 `REHEARSE_DATABASE_URL=`
// （compose 侧 `${VAR:-…}` 的常见形态）就该走默认，而不是报错。
// 所以「DSN 从哪来」这个问题只有两个答案：显式写 env，或用默认值。
//
// DSN 的**内容**不在这一步校验（哪个后端、pooler 模式）——那是 `store.Open`
// 的事，那里有 `EnsurePoolerSafeDSN` / `EnsureSQLiteDSN` 两道代码约束。
func ResolveDatabaseURL() (dsn string, defaulted bool) {
	dsn = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		return DefaultDatabaseURL, true
	}
	return dsn, false
}

// LLMFallback 是 LLM 配置的 env 兜底（§7.3.2）。
//
// 权威来源是 DB 里的 rehearse_settings；这里只保证「DB 不可用 / 还没配」时
// 服务仍能起来。照搬 moyan-backend 的 fill_from_env_if_empty 模式。
type LLMFallback struct {
	BaseURL string
	APIKey  string
	Model   string
}

// Config 是服务的全部运行时配置。
type Config struct {
	Port        int
	DatabaseURL string
	// DatabaseURLDefaulted 为 true 表示 `DATABASE_URL` 没有设置，
	// 用的是 `DefaultDatabaseURL`。它的唯一用途是让启动日志与 `/health`
	// 能指出「现在跑在默认库上」——见 DefaultDatabaseURL 的代价说明。
	DatabaseURLDefaulted bool
	JWTSecret            []byte
	AdminToken           string

	// AllowedOrigins 没有 Web 客户端时其实用不上（RN 的 fetch 不带 Origin），
	// 留着只是为将来留口子（§7.7）。
	AllowedOrigins []string

	LLMFallback LLMFallback
	LogLevel    string
}

// DefaultPort 与 §6.5 的端口分配一致（moyan-backend 是 4323）。
const DefaultPort = 4324

// Load 读取并校验配置。任何必填项缺失或非法都会返回错误。
func Load() (*Config, error) {
	cfg := &Config{
		Port:       DefaultPort,
		AdminToken: os.Getenv("ADMIN_TOKEN"),
		LogLevel:   envOr("LOG_LEVEL", "info"),
	}
	// 未配置 DATABASE_URL 时默认使用本地 SQLite（§7.3.5，DefaultDatabaseURL）。
	// 本地开发不需要外部数据库，一条命令就能跑起来。
	cfg.DatabaseURL, cfg.DatabaseURLDefaulted = ResolveDatabaseURL()

	jwtSecret, err := requireEnv("JWT_SECRET")
	if err != nil {
		return nil, err
	}
	// JWT_SECRET 必须 ASCII。仓库里踩过 X-Admin-Token 含非 ASCII 恒 401 的坑
	// （HeaderValue::to_str() 拿不到非 ASCII），JWT 密钥同理——签出来的 token
	// 两边解不开，而症状是「所有 token 都验不过」，很难定位。
	if err := requireASCII("JWT_SECRET", jwtSecret); err != nil {
		return nil, err
	}
	cfg.JWTSecret = []byte(jwtSecret)

	if cfg.AdminToken != "" {
		if err := requireASCII("ADMIN_TOKEN", cfg.AdminToken); err != nil {
			return nil, err
		}
	}

	if raw := os.Getenv("PORT"); raw != "" {
		port, err := strconv.Atoi(raw)
		if err != nil || port < 1 || port > 65535 {
			return nil, fmt.Errorf("PORT must be a valid port number, got %q", raw)
		}
		cfg.Port = port
	}

	if raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS")); raw != "" {
		for _, origin := range strings.Split(raw, ",") {
			if origin = strings.TrimSpace(origin); origin != "" {
				cfg.AllowedOrigins = append(cfg.AllowedOrigins, origin)
			}
		}
	}

	cfg.LLMFallback = LLMFallback{
		BaseURL: envOr("REHEARSE_LLM_BASE_URL", envOr("OPENAI_BASE_URL", "")),
		APIKey:  envOr("REHEARSE_LLM_API_KEY", envOr("OPENAI_API_KEY", "")),
		Model:   envOr("REHEARSE_LLM_MODEL", envOr("OPENAI_MODEL", "")),
	}

	return cfg, nil
}

// LoadDatabaseURL 只解析 `DATABASE_URL`（未设置时用 `DefaultDatabaseURL`），
// 不碰其余任何键。
//
// 给 `cmd/migrate` 用：迁移只需要「连哪个库」，而 `Load` 会连 `JWT_SECRET` /
// `ADMIN_TOKEN` 一起要求——那些是 server 的事。强迫一个只想建表的命令去编一个
// JWT 密钥，结果就是本地开发随手 `export JWT_SECRET=dev`，而「随手值」
// 正是 §7.7 想避免的东西。
//
// 第二个返回值告诉调用方「用的是默认值」，`cmd/migrate` 据此提示一句：
// 免得有人在**默认的那个 SQLite 文件**上跑完迁移，却以为改的是生产库
// ——那种误会的症状是「迁移明明成功了，线上 schema 没变」。
//
// ⚠️ 不校验 DSN 的**内容**（哪个后端、pooler 模式）——那是 `store.Open` 的事。
// 这里只管「取到哪个值」。
func LoadDatabaseURL() (dsn string, defaulted bool) {
	return ResolveDatabaseURL()
}

func requireEnv(key string) (string, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return "", fmt.Errorf("%s is required and must not be empty", key)
	}
	return value, nil
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

// requireASCII 拒绝 0x20-0x7E 之外的字符。
//
// 这条不是洁癖：非 ASCII 的密钥在 HTTP 头与签名计算上都会出问题，而症状
// 是「无论输入什么都 401」，历史上真踩过（见 .env.example 里 ADMIN_TOKEN 的注释）。
func requireASCII(key, value string) error {
	for i := 0; i < len(value); i++ {
		if value[i] < 0x20 || value[i] > 0x7e {
			return fmt.Errorf("%s must be printable ASCII (0x20-0x7E); found byte 0x%02x at offset %d", key, value[i], i)
		}
	}
	return nil
}
