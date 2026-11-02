package store

import (
	"context"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// EnsureSQLiteDSN 是纯函数，所以这里不需要数据库——与 postgres_test.go
// 对 EnsurePoolerSafeDSN 的测法一致。

func TestEnsureSQLiteDSN_NormalizesPaths(t *testing.T) {
	for name, tc := range map[string]struct{ in, wantPrefix string }{
		"相对路径":          {"sqlite:./data/rehearse.db", "file:./data/rehearse.db"},
		"三个斜杠的绝对路径":     {"sqlite:///var/lib/rehearse.db", "file:/var/lib/rehearse.db"},
		"一个斜杠的绝对路径":     {"sqlite:/var/lib/rehearse.db", "file:/var/lib/rehearse.db"},
		"已经是 file: URI": {"file:rehearse.db", "file:rehearse.db"},
		// 路径里有空格必须转义，否则 SQLite 会在空格处截断文件名。
		"路径含空格": {"sqlite:./my data/rehearse.db", "file:./my%20data/rehearse.db"},
	} {
		t.Run(name, func(t *testing.T) {
			got, err := EnsureSQLiteDSN(tc.in)
			require.NoError(t, err, "不该报错")
			// 后面还会追加 PRAGMA，所以只断言前缀 + 一个 `?`。
			require.True(t, strings.HasPrefix(got, tc.wantPrefix+"?"),
				"应当以 %q 开头，实际是 %q", tc.wantPrefix, got)
		})
	}
}

func TestEnsureSQLiteDSN_RejectsEmptyPath(t *testing.T) {
	for _, in := range []string{"sqlite:", "sqlite://", "   "} {
		_, err := EnsureSQLiteDSN(in)
		require.Errorf(t, err, "%q 应当报错，而不是悄悄用当前目录", in)
	}
}

// 四条 PRAGMA 一个都不能少——它们不是可调项，是「这么写才不会在并发下坏掉」。
func TestEnsureSQLiteDSN_AppendsPragmas(t *testing.T) {
	got, err := EnsureSQLiteDSN("sqlite:rehearse.db")
	require.NoError(t, err, "不该报错")

	parsed, err := url.Parse(got)
	require.NoError(t, err, "结果不是合法 URI")
	require.ElementsMatch(t, []string{
		"busy_timeout(5000)",
		"journal_mode(WAL)",
		"synchronous(NORMAL)",
		"foreign_keys(1)",
	}, parsed.Query()["_pragma"], "PRAGMA 列表")
}

// 内存库必须共享缓存，否则池子里的每条连接各建一个库、互相看不见——
// 症状是「表建好了但查不到」，极难定位。
func TestEnsureSQLiteDSN_MemoryIsShared(t *testing.T) {
	for _, in := range []string{"sqlite::memory:", "sqlite:file::memory:"} {
		got, err := EnsureSQLiteDSN(in)
		require.NoErrorf(t, err, "%q: 不该报错", in)
		require.Containsf(t, got, "cache=shared", "%q: 内存库必须共享缓存", in)
	}
}

// 上面测的是「DSN 字符串里写了什么」，这一条测的是「SQLite 真的照做了」。
// 两者都要有：拼错参数名（`journal_mode` 写成 `journal-mode`）时前者会过、
// 后者会拦住。
func TestSQLite_AppliesPragmas(t *testing.T) {
	ctx := context.Background()
	lite := openTestSQLite(t, "sqlite:"+filepath.Join(t.TempDir(), "rehearse.db"))

	var journalMode string
	require.NoError(t, lite.DB().QueryRowContext(ctx, `PRAGMA journal_mode`).Scan(&journalMode))
	require.Equal(t, "wal", strings.ToLower(journalMode), "没切 WAL：读会阻塞写")

	var busyTimeout int
	require.NoError(t, lite.DB().QueryRowContext(ctx, `PRAGMA busy_timeout`).Scan(&busyTimeout))
	require.Equal(t, 5000, busyTimeout, "没设 busy_timeout：并发写会立刻 SQLITE_BUSY")

	var foreignKeys int
	require.NoError(t, lite.DB().QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&foreignKeys))
	require.Equal(t, 1, foreignKeys, "外键校验没打开")
}

func TestSQLite_InMemory(t *testing.T) {
	lite := openTestSQLite(t, "sqlite::memory:")
	require.True(t, lite.InMemory(), "应当识别为内存库")
	require.Equal(t, 1, lite.DB().Stats().MaxOpenConnections,
		"内存库必须限制成单连接")
}

// 目录不存在要**报错**，不能静默在错误的位置建库。
//
// 这条不是洁癖：如果静默建库，`DATABASE_URL` 打错一个字母的后果是
// 「服务正常启动、数据全在另一个文件里」，比启动失败难查得多（§7.7）。
func TestSQLite_MissingDirectoryFailsLoudly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "no-such-dir", "rehearse.db")
	_, err := connectSQLite(context.Background(), "sqlite:"+path)
	require.Error(t, err, "目录不存在应当报错")
	require.Contains(t, err.Error(), "目录", "错误信息要指出可能的原因")
}

func openTestSQLite(t *testing.T, dsn string) *SQLite {
	t.Helper()
	lite, err := connectSQLite(context.Background(), dsn)
	require.NoError(t, err, "connect sqlite")
	t.Cleanup(lite.Close)
	return lite
}
