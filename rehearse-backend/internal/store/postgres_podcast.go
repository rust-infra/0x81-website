// Postgres 版的播客译文读写（migrations/postgres/0003_podcast_translations）。
//
// 与 SQLite 版逐行对照，差异只有占位符与事务写法。
package store

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (p *Postgres) PodcastTranslationsGet(
	ctx context.Context, episodeID, sourceHash string,
) ([]PodcastTranslation, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT turn_index, source_hash, speaker, source_text, translation
		FROM rehearse_podcast_translations
		WHERE episode_id = $1 AND source_hash = $2
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

func (p *Postgres) PodcastTranslationsPutReplace(
	ctx context.Context, episodeID string, rows []PodcastTranslation,
) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("podcast translations put begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 删掉这一集的全部旧行（任何 `source_hash`）：整集替换的语义是
	// 「这一集现在只有这一版译文」。
	if _, err := tx.Exec(ctx,
		`DELETE FROM rehearse_podcast_translations WHERE episode_id = $1`, episodeID); err != nil {
		return fmt.Errorf("podcast translations put delete: %w", err)
	}

	batch := &pgx.Batch{}
	for _, row := range rows {
		batch.Queue(`
			INSERT INTO rehearse_podcast_translations
				(episode_id, turn_index, source_hash, speaker, source_text, translation, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, now())`,
			episodeID, row.TurnIndex, row.SourceHash, row.Speaker, row.SourceText, row.Translation)
	}
	if batch.Len() > 0 {
		results := tx.SendBatch(ctx, batch)
		for range rows {
			if _, err := results.Exec(); err != nil {
				_ = results.Close()
				return fmt.Errorf("podcast translations put insert: %w", err)
			}
		}
		if err := results.Close(); err != nil {
			return fmt.Errorf("podcast translations put close: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("podcast translations put commit: %w", err)
	}
	return nil
}
