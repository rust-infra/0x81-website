// Package config 集中读取与校验环境变量（§7.7）。
//
// 设计原则：**必填项缺失就报错退出，不给默认值。** 这是从
// docker-compose.yml 的 `:-change-me-in-production` 那个坑里学来的——
// 默认值会让「服务器上漏改 .env」变成「服务正常启动但所有 token 验不过」，
// 比启动失败难查得多。compose 侧用 `:?` 强制校验，这里做第二道。
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

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
	JWTSecret   []byte
	AdminToken  string

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
		Port:        DefaultPort,
		DatabaseURL: os.Getenv("DATABASE_URL"),
		AdminToken:  os.Getenv("ADMIN_TOKEN"),
		LogLevel:    envOr("LOG_LEVEL", "info"),
	}

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

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required (Supabase pooler connection string, §7.3.2)")
	}
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
