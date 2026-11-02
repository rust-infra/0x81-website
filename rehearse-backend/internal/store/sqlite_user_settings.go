// SQLite 版的用户设置文档读写（migrations/sqlite/0002_user_settings）。
//
// 文档是**客户端写的 JSON**，这里只做存取，不做形状校验——校验在
// `internal/httpapi/user_settings.go`（系统边界）。存储层唯一要保证的是
// upsert 语义与「存得进去、逐字读得回来」。
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

func (s *SQLite) UserSettingsGet(ctx context.Context, userSub string) (string, error) {
	var settings string
	err := s.db.QueryRowContext(ctx,
		`SELECT settings FROM rehearse_user_settings WHERE user_sub = ?`, userSub,
	).Scan(&settings)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrUserSettingsNotFound
	}
	if err != nil {
		return "", fmt.Errorf("user settings get: %w", err)
	}
	return settings, nil
}

func (s *SQLite) UserSettingsPut(ctx context.Context, userSub, settings string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO rehearse_user_settings (user_sub, settings, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(user_sub)
		DO UPDATE SET settings = excluded.settings, updated_at = CURRENT_TIMESTAMP`,
		userSub, settings)
	if err != nil {
		return fmt.Errorf("user settings put: %w", err)
	}
	return nil
}
