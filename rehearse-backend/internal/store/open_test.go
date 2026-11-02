package store

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// DetectDialect 决定「跑哪个后端的代码、哪一套迁移」。判错的后果不是报错，
// 而是**用另一套方言跑到底**——所以这里只认显式 scheme，不给裸路径留口子。
func TestDetectDialect(t *testing.T) {
	for name, tc := range map[string]struct {
		dsn     string
		want    Dialect
		wantErr bool
	}{
		"postgres":      {"postgres://u:p@host:6543/postgres?sslmode=require", DialectPostgres, false},
		"postgresql 别名": {"postgresql://u:p@host:5432/postgres", DialectPostgres, false},
		"sqlite 相对路径":   {"sqlite:./data/rehearse.db", DialectSQLite, false},
		"sqlite 绝对路径":   {"sqlite:///var/lib/rehearse.db", DialectSQLite, false},
		"sqlite 内存库":    {"sqlite::memory:", DialectSQLite, false},
		"file: URI":     {"file:rehearse.db", DialectSQLite, false},
		"裸路径（拒绝）":       {"./data/rehearse.db", "", true},
		"裸文件名（拒绝）":      {"rehearse.db", "", true},
		"空串（拒绝）":        {"", "", true},
		"只有空格（拒绝）":      {"   ", "", true},
		"别的数据库（拒绝）":     {"mysql://u:p@host:3306/db", "", true},
		// 这个最容易误判成 SQLite：它带着 .db 后缀，但 scheme 是 postgres。
		"postgres 的奇怪库名": {"postgres://u:p@host:5432/x.db", DialectPostgres, false},
	} {
		t.Run(name, func(t *testing.T) {
			got, err := DetectDialect(tc.dsn)
			if tc.wantErr {
				require.Errorf(t, err, "应当报错")
				require.Empty(t, got, "报错时不该返回方言")
				return
			}
			require.NoErrorf(t, err, "不该报错")
			require.Equalf(t, tc.want, got, "方言判断错了")
		})
	}
}

// 连接串里有密码，任何错误信息都不该把它带出来（§13 的验收项）。
func TestDetectDialect_ErrorDoesNotLeakPassword(t *testing.T) {
	const secret = "sup3r-s3cret-pw"
	_, err := DetectDialect("mysql://u:" + secret + "@host:3306/db")
	require.Error(t, err, "未知后端应当报错")
	require.NotContains(t, err.Error(), secret, "错误信息泄漏了密码")
}

// 报错时要给出**可操作**的方向，否则使用者只能去翻源码。
func TestDetectDialect_ErrorSaysWhatIsAccepted(t *testing.T) {
	_, err := DetectDialect("rehearse.db")
	require.Error(t, err, "应当报错")
	require.Contains(t, err.Error(), "sqlite:", "错误信息要指出正确写法")
	require.Contains(t, err.Error(), "postgres://", "错误信息要指出正确写法")
}
