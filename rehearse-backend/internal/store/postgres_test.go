package store

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestEnsurePoolerSafeDSN_AddsExecWhenAbsent(t *testing.T) {
	// 最常见的路径：人不会记得写这个参数。补上而不是报错——否则本地开发
	// 每次都要手写一遍。
	got, err := EnsurePoolerSafeDSN("postgres://u:p@host:6543/postgres?sslmode=require")
	require.NoError(t, err, "unexpected error")
	require.Equal(t, "exec", execModeOf(t, got), "default_query_exec_mode")
	require.Contains(t, got, "sslmode=require", "原有参数被丢掉了")
}

func TestEnsurePoolerSafeDSN_KeepsSafeModes(t *testing.T) {
	for _, mode := range []string{"exec", "simple_protocol"} {
		dsn := "postgres://u:p@host:6543/postgres?default_query_exec_mode=" + mode
		got, err := EnsurePoolerSafeDSN(dsn)
		require.NoErrorf(t, err, "mode %s: unexpected error", mode)
		require.Equalf(t, dsn, got, "mode %s: DSN 被改动了", mode)
	}
}

// 显式写错要吵。静默改掉会让人以为自己的配置生效了。
func TestEnsurePoolerSafeDSN_RejectsPoolerUnsafeModes(t *testing.T) {
	for _, mode := range []string{"cache_statement", "describe_exec"} {
		dsn := "postgres://u:p@host:6543/postgres?default_query_exec_mode=" + mode
		_, err := EnsurePoolerSafeDSN(dsn)
		require.Errorf(t, err, "mode %s: 应当报错，却通过了", mode)
		// 错误信息要能自解释，并且指出该改成什么。
		require.Containsf(t, err.Error(), "exec", "mode %s: 错误信息没给出正确做法", mode)
	}
}

func TestEnsurePoolerSafeDSN_RejectsUnknownMode(t *testing.T) {
	_, err := EnsurePoolerSafeDSN("postgres://u:p@host:6543/postgres?default_query_exec_mode=whatever")
	require.Error(t, err, "未知模式应当报错")
	require.Contains(t, err.Error(), "unknown", "错误信息没说清是未知值")
}

func TestEnsurePoolerSafeDSN_RejectsMalformedURL(t *testing.T) {
	// 控制字符会让 url.Parse 失败。
	_, err := EnsurePoolerSafeDSN("postgres://u:p@host\x7f/postgres")
	require.Error(t, err, "非法 URL 应当报错")
}

// 连接串里有密码，任何日志/错误都不该把它带出来（§13 的验收项）。
func TestEnsurePoolerSafeDSN_ErrorDoesNotLeakPassword(t *testing.T) {
	const secret = "sup3r-s3cret-pw"
	_, err := EnsurePoolerSafeDSN(
		"postgres://u:" + secret + "@host:6543/postgres?default_query_exec_mode=cache_statement")
	require.Error(t, err, "应当报错")
	require.NotContains(t, err.Error(), secret, "错误信息泄漏了密码")
}

func execModeOf(t *testing.T, dsn string) string {
	t.Helper()
	parsed, err := url.Parse(dsn)
	require.NoError(t, err, "结果不是合法 URL")
	return parsed.Query().Get("default_query_exec_mode")
}
