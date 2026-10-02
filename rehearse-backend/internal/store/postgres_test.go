package store

import (
	"net/url"
	"strings"
	"testing"
)

func TestEnsurePoolerSafeDSN_AddsExecWhenAbsent(t *testing.T) {
	// 最常见的路径：人不会记得写这个参数。补上而不是报错——否则本地开发
	// 每次都要手写一遍。
	got, err := EnsurePoolerSafeDSN("postgres://u:p@host:6543/postgres?sslmode=require")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mode := execModeOf(t, got); mode != "exec" {
		t.Fatalf("default_query_exec_mode = %q, want %q", mode, "exec")
	}
	if !strings.Contains(got, "sslmode=require") {
		t.Fatalf("原有参数被丢掉了: %s", got)
	}
}

func TestEnsurePoolerSafeDSN_KeepsSafeModes(t *testing.T) {
	for _, mode := range []string{"exec", "simple_protocol"} {
		dsn := "postgres://u:p@host:6543/postgres?default_query_exec_mode=" + mode
		got, err := EnsurePoolerSafeDSN(dsn)
		if err != nil {
			t.Fatalf("mode %s: unexpected error: %v", mode, err)
		}
		if got != dsn {
			t.Fatalf("mode %s: DSN 被改动了: %s", mode, got)
		}
	}
}

// 显式写错要吵。静默改掉会让人以为自己的配置生效了。
func TestEnsurePoolerSafeDSN_RejectsPoolerUnsafeModes(t *testing.T) {
	for _, mode := range []string{"cache_statement", "describe_exec"} {
		dsn := "postgres://u:p@host:6543/postgres?default_query_exec_mode=" + mode
		_, err := EnsurePoolerSafeDSN(dsn)
		if err == nil {
			t.Fatalf("mode %s: 应当报错，却通过了", mode)
		}
		// 错误信息要能自解释，并且指出该改成什么。
		if !strings.Contains(err.Error(), "exec") {
			t.Fatalf("mode %s: 错误信息没给出正确做法: %v", mode, err)
		}
	}
}

func TestEnsurePoolerSafeDSN_RejectsUnknownMode(t *testing.T) {
	_, err := EnsurePoolerSafeDSN("postgres://u:p@host:6543/postgres?default_query_exec_mode=whatever")
	if err == nil {
		t.Fatal("未知模式应当报错")
	}
	if !strings.Contains(err.Error(), "unknown") {
		t.Fatalf("错误信息没说清是未知值: %v", err)
	}
}

func TestEnsurePoolerSafeDSN_RejectsMalformedURL(t *testing.T) {
	// 控制字符会让 url.Parse 失败。
	if _, err := EnsurePoolerSafeDSN("postgres://u:p@host\x7f/postgres"); err == nil {
		t.Fatal("非法 URL 应当报错")
	}
}

// 连接串里有密码，任何日志/错误都不该把它带出来（§13 的验收项）。
func TestEnsurePoolerSafeDSN_ErrorDoesNotLeakPassword(t *testing.T) {
	const secret = "sup3r-s3cret-pw"
	_, err := EnsurePoolerSafeDSN(
		"postgres://u:" + secret + "@host:6543/postgres?default_query_exec_mode=cache_statement")
	if err == nil {
		t.Fatal("应当报错")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("错误信息泄漏了密码: %v", err)
	}
}

func execModeOf(t *testing.T, dsn string) string {
	t.Helper()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("结果不是合法 URL: %v", err)
	}
	return parsed.Query().Get("default_query_exec_mode")
}
