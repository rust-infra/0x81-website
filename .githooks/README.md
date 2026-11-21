# Git hooks

Enable the repository hooks once per clone:

```bash
./scripts/install-git-hooks.sh
```

## pre-commit

Runs `gofmt -l` on the Go files staged in the current commit. If a file is
unformatted, the commit is blocked and the hook prints the `gofmt -w` command
to fix it.

The CI `Go Checks` workflow still runs `gofmt -l .` over the whole
`rehearse-backend` module, so `git commit --no-verify` cannot hide a formatting
failure from CI.
