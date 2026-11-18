package main

import (
	"context"
	"errors"
	"testing"
)

type fakeMigrationRunner struct {
	applied []string
	err     error
	calls   int
}

func (f *fakeMigrationRunner) Up(context.Context) ([]string, error) {
	f.calls++
	return f.applied, f.err
}

func TestApplyMigrationsRunsRunner(t *testing.T) {
	runner := &fakeMigrationRunner{applied: []string{"0002"}}

	if err := applyMigrations(context.Background(), runner); err != nil {
		t.Fatalf("applyMigrations returned error: %v", err)
	}
	if runner.calls != 1 {
		t.Fatalf("Up calls = %d, want 1", runner.calls)
	}
}

func TestApplyMigrationsStopsOnFailure(t *testing.T) {
	wantErr := errors.New("apply migration: database is locked")
	runner := &fakeMigrationRunner{err: wantErr}

	err := applyMigrations(context.Background(), runner)
	if !errors.Is(err, wantErr) {
		t.Fatalf("applyMigrations error = %v, want %v", err, wantErr)
	}
}
