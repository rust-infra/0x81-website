package main

import (
	"context"
	"fmt"
	"log/slog"
)

type migrationRunner interface {
	Up(context.Context) ([]string, error)
}

func applyMigrations(ctx context.Context, runner migrationRunner) error {
	applied, err := runner.Up(ctx)
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	if len(applied) > 0 {
		slog.Info("migrations applied", "versions", applied)
	}
	return nil
}
