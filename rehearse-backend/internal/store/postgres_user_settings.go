// Postgres 版的用户设置文档读写（migrations/postgres/0002_user_settings）。
//
// 与 SQLite 版逐行对照；`settings` 列是 JSONB，pgx 把 string 参数按 jsonb
// 收下，Postgres 会在写入时校验合法性。
package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (p *Postgres) UserSettingsGet(ctx context.Context, userSub string) (string, error) {
	var settings string
	err := p.pool.QueryRow(ctx,
		`SELECT settings FROM rehearse_user_settings WHERE user_sub = $1`, userSub,
	).Scan(&settings)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrUserSettingsNotFound
	}
	if err != nil {
		return "", fmt.Errorf("user settings get: %w", err)
	}
	return settings, nil
}

func (p *Postgres) UserSettingsPut(ctx context.Context, userSub, settings string) error {
	// $2 必须显式 cast：pgx 把 Go string 编码成 text OID，而 text → jsonb 没有
	// 赋值转换，不写 `::jsonb` 在运行时才会爆「column is of type jsonb but
	// expression is of type text」。
	_, err := p.pool.Exec(ctx,
		`INSERT INTO rehearse_user_settings (user_sub, settings, updated_at)
		 VALUES ($1, $2::jsonb, now())
		 ON CONFLICT (user_sub)
		 DO UPDATE SET settings = excluded.settings, updated_at = now()`,
		userSub, settings)
	if err != nil {
		return fmt.Errorf("user settings put: %w", err)
	}
	return nil
}
