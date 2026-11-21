// SQLite 版的播客译文读写（migrations/sqlite/0003_podcast_translations）。
//
// 与 Postgres 版逐行对照，差异只有占位符（`?` vs `$n`）与事务写法。
// 失效规则（`source_hash` 不一致即作废）在 SQL 里表达，两条实现必须一致。
package store

import (
	"context"
	"fmt"
)

func (s *SQLite) PodcastTranslationsGet(
	ctx context.Context, episodeID, sourceHash string,
) ([]PodcastTranslation, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT turn_index, source_hash, speaker, source_text, translation
		FROM rehearse_podcast_translations
		WHERE episode_id = ? AND source_hash = ?
		ORDER BY turn_index ASC`, episodeID, sourceHash)
	if err != nil {
		return nil, fmt.Errorf("podcast translations get: %w", err)
	}
	defer rows.Close()

	out := make([]PodcastTranslation, 0, 16)
	for rows.Next() {
		var row PodcastTranslation
		if err := rows.Scan(
			&row.TurnIndex, &row.SourceHash, &row.Speaker, &row.SourceText, &row.Translation,
		); err != nil {
			return nil, fmt.Errorf("podcast translations get scan: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("podcast translations get rows: %w", err)
	}
	return out, nil
}

func (s *SQLite) PodcastTranslationsPutReplace(
	ctx context.Context, episodeID string, rows []PodcastTranslation,
) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("podcast translations put begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// 删掉这一集的全部旧行（任何 `source_hash`）：整集替换的语义是
	// 「这一集现在只有这一版译文」。
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM rehearse_podcast_translations WHERE episode_id = ?`, episodeID); err != nil {
		return fmt.Errorf("podcast translations put delete: %w", err)
	}

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO rehearse_podcast_translations
			(episode_id, turn_index, source_hash, speaker, source_text, translation, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
	if err != nil {
		return fmt.Errorf("podcast translations put prepare: %w", err)
	}
	defer stmt.Close()

	for _, row := range rows {
		if _, err := stmt.ExecContext(ctx,
			episodeID, row.TurnIndex, row.SourceHash, row.Speaker, row.SourceText, row.Translation,
		); err != nil {
			return fmt.Errorf("podcast translations put insert: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("podcast translations put commit: %w", err)
	}
	return nil
}
