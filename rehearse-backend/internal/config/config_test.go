package config_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/0x81/rehearse-backend/internal/config"
	"github.com/0x81/rehearse-backend/internal/store"
)

// `DATABASE_URL` 是全仓唯一有默认值的键（见 config.go 的包注释）。
// 默认值的存在意味着「不设也能起」是**规格**而不是巧合，所以用测试钉住。
func TestResolveDatabaseURL_DefaultsToSQLite(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	dsn, defaulted := config.ResolveDatabaseURL()
	assert.Equal(t, config.DefaultDatabaseURL, dsn)
	assert.True(t, defaulted, "空值必须被判定为「用了默认值」，否则启动日志不会 WARN")
}

// env 文件里留一个 `DATABASE_URL=`（或只有空格）是 `${VAR:-…}` 的常见形态，
// 应当走默认，而不是被当成「设了一个空的 DSN」而报错。
func TestResolveDatabaseURL_WhitespaceCountsAsUnset(t *testing.T) {
	t.Setenv("DATABASE_URL", "   ")

	dsn, defaulted := config.ResolveDatabaseURL()
	assert.Equal(t, config.DefaultDatabaseURL, dsn)
	assert.True(t, defaulted)
}

// 显式设置必须原样透传：DSN 的**内容**校验（哪个后端、pooler 模式）是
// store.Open 的事，这里多做一层会让「DSN 写错了」的错误信息来自两个地方。
func TestResolveDatabaseURL_ExplicitWins(t *testing.T) {
	const dsn = "postgres://u:p@host:6543/postgres?sslmode=require"
	t.Setenv("DATABASE_URL", dsn)

	got, defaulted := config.ResolveDatabaseURL()
	assert.Equal(t, dsn, got)
	assert.False(t, defaulted, "显式设置不能被标成默认值")
}

// 默认值必须能被 store 认出来是 SQLite。`DetectDialect` 只认显式 scheme，
// 一旦 DefaultDatabaseURL 被改成裸路径（`./data/rehearse.db`），服务会在
// 启动连库时才炸——这条测试把那个错误提前到 `go test`。
func TestDefaultDatabaseURL_IsRecognizedAsSQLite(t *testing.T) {
	require.NotEmpty(t, config.DefaultDatabaseURL)

	dialect, err := store.DetectDialect(config.DefaultDatabaseURL)
	require.NoError(t, err, "默认 DSN 必须能被 DetectDialect 识别")
	assert.Equal(t, store.DialectSQLite, dialect)
}
