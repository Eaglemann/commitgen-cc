# Commitgen-CC

`commitgen-cc` reads your staged git changes and uses a local [Ollama](https://ollama.com/) model to generate a Conventional Commit message. The normal flow is simple: stage files, run `commitgen-cc`, review the suggested message, then accept, edit, regenerate, or cancel.

It can also run in dry-run mode, emit JSON for CI, remember recent accepted commit messages, and install git hooks for team workflows.

## Quick Start

Requirements:

- [Node.js](https://nodejs.org/) `v20+`
- `git`
- [Ollama](https://ollama.com/) running locally

Default runtime:

- Host: `http://localhost:11434`
- Model: `gpt-oss:120b-cloud`

Install and run:

```bash
ollama serve
ollama pull gpt-oss:120b-cloud
npm install -g commitgen-cc

git add .
commitgen-cc
```

If Ollama runs somewhere else, use `--host` or `GIT_AI_HOST`. If you want a different model, use `--model` or `GIT_AI_MODEL`. If anything fails, start with:

```bash
commitgen-cc doctor
```

`doctor` checks Node, git context, config loading, Ollama reachability, and whether the configured model exists locally.

## Install

For daily use:

```bash
npm install -g commitgen-cc
```

For a one-off run:

```bash
npx commitgen-cc
```

`npx commitgen-cc` is fine for one-off usage. For persistent workflows such as git hooks, use a regular install so the executable path stays stable.

## Main Command Options

These are the primary options for `commitgen-cc` itself:

| Option | Purpose |
| --- | --- |
| `-m, --model <name>` | Override the Ollama model name |
| `--host <url>` | Override the Ollama host |
| `--max-chars <n>` | Limit how much staged diff text is sent to the model |
| `--type <type>` | Force the commit type |
| `--scope <scope>` | Force the commit scope |
| `--config <path>` | Load a custom config file |
| `--candidates <n>` | Generate between `1` and `5` ranked candidates |
| `--ticket <id>` | Force a ticket such as `ABC-123` |
| `--no-history` | Disable local history examples and history writes |
| `--dry-run` | Print the message without committing |
| `--ci` | Use non-interactive mode |
| `--explain` | Show why the selected message won |
| `--allow-invalid` | Allow an invalid message instead of blocking it |
| `--timeout-ms <n>` | Set the Ollama request timeout |
| `--retries <n>` | Retry transient Ollama failures |
| `--output <text|json>` | Choose text or JSON output |
| `--no-verify` | Pass `--no-verify` to `git commit` |

## Common Usage Examples

Default interactive flow:

```bash
git add .
commitgen-cc
```

By default, interactive mode generates one best message and lets you accept it, ask for a change, edit it, regenerate it, dry-run it, or cancel.

Print the message without committing:

```bash
commitgen-cc --dry-run
```

Print the message with selection diagnostics:

```bash
commitgen-cc --dry-run --explain
```

Generate machine-readable output:

```bash
commitgen-cc --ci --dry-run --output json
```

Add diagnostics to JSON output only when needed:

```bash
commitgen-cc --ci --dry-run --output json --explain
```

Ask for multiple ranked candidates:

```bash
commitgen-cc --candidates 3
```

Force a type, scope, or ticket:

```bash
commitgen-cc --type fix --scope cli --ticket ABC-123
```

## Environment Variables

CLI flags override environment variables. Environment variables are useful when you want a persistent local default.

| Variable | What it changes | Default if unset | Use when |
| --- | --- | --- | --- |
| `GIT_AI_MODEL` | Default Ollama model | `gpt-oss:120b-cloud` | You usually want the same local model |
| `GIT_AI_HOST` | Default Ollama host | `http://localhost:11434` | Ollama runs on a different host or port |
| `GIT_AI_TIMEOUT_MS` | Default request timeout | `60000` | Your model is slower than the default timeout |
| `GIT_AI_RETRIES` | Default retry count | `2` | You want more or fewer retries for transient Ollama failures |

Example:

```bash
export GIT_AI_MODEL="llama3.1"
export GIT_AI_TIMEOUT_MS="120000"
```

## Repo Config

Use a `.commitgen.json` file in the repo root when you want project-level defaults.

Basic example:

```json
{
  "model": "gpt-oss:120b-cloud",
  "host": "http://localhost:11434",
  "maxChars": 16000,
  "defaultScope": "cli",
  "scopes": ["cli", "workflow", "docs"],
  "ticketPattern": "([A-Z][A-Z0-9]+-\\d+)",
  "historyEnabled": true,
  "historySampleSize": 5
}
```

Resolution order:

`CLI flags > environment variables > repo config > built-in defaults`

History behavior:

- Accepted commit messages are stored in `.git/commitgen/history.jsonl`
- Those recent messages are reused as local examples on later runs
- Use `--no-history` if you do not want to read or write local history

### Team policy keys

These keys are mainly for hooks and CI enforcement:

| Key | Meaning |
| --- | --- |
| `hookMode` | `suggest` or `enforce` |
| `requireTicket` | Require the final message to reference a ticket |
| `allowedTypes` | Restrict allowed Conventional Commit types |
| `requiredScopes` | Restrict allowed scopes and require a scope when set |
| `scopeMap` | Map changed path prefixes to preferred scopes |
| `subjectMaxLength` | Override the subject length limit |
| `bodyRequiredTypes` | Require a commit body for selected types |

Example with team policy:

```json
{
  "hookMode": "enforce",
  "requireTicket": true,
  "allowedTypes": ["feat", "fix", "docs", "refactor"],
  "requiredScopes": ["cli", "workflow", "docs"],
  "scopeMap": {
    "src/cli": "cli",
    "src/workflow": "workflow",
    "docs": "docs"
  },
  "subjectMaxLength": 72,
  "bodyRequiredTypes": ["feat", "refactor"]
}
```

## Hooks and CI

`commitgen-cc` can install repo-local hooks into `.git/hooks`.

Available team commands:

- `commitgen-cc install-hook`
- `commitgen-cc uninstall-hook`
- `commitgen-cc doctor`
- `commitgen-cc lint-message --file <path>`

### Install hooks

```bash
commitgen-cc install-hook
```

Install hooks with a custom config file:

```bash
commitgen-cc install-hook --config .commitgen.team.json
```

### What the hooks do

- `prepare-commit-msg` tries to generate a message when no message was supplied
- `commit-msg` validates the final message
- `commit-msg` only blocks commits when `hookMode` is set to `enforce`
- `prepare-commit-msg` is best-effort and does not hard-fail your commit if generation fails

### Remove managed hooks

```bash
commitgen-cc uninstall-hook
```

### Validate a commit message file manually

```bash
commitgen-cc lint-message --file .git/COMMIT_EDITMSG
commitgen-cc lint-message --file .git/COMMIT_EDITMSG --output json
```

For CI or scripts, generate machine-readable output:

```bash
commitgen-cc --ci --dry-run --output json --candidates 3
```

JSON success output can include:

- `message`
- `source`
- `committed`
- `scope`
- `ticket`
- `alternatives`
- `diagnostics` when `--explain` is set

### Enforce the same policy in GitHub Actions

You can write a commit title or PR title to a file and validate it with `lint-message`.

Example:

```yaml
- name: Validate PR title
  run: |
    printf '%s\n' "${{ github.event.pull_request.title }}" > /tmp/commit-title.txt
    npx commitgen-cc lint-message --file /tmp/commit-title.txt
```

## Maintainer Release Notes

This repo has two GitHub Actions workflows:

- `.github/workflows/ci.yml` runs `npm run check` on every push to `main`
- `.github/workflows/release.yml` runs only for pushed tags matching `v*`

Release flow:

```bash
npm version patch
git push origin main --follow-tags
```

That:

- creates a tag such as `v3.1.4`
- pushes `main`, which triggers CI
- pushes the matching tag, which triggers the release workflow
- verifies the tagged commit is already contained in `main`
- runs checks again before publishing
- publishes to npm if that version is not already published
- creates or updates the GitHub Release for that tag

### npm trusted publishing

The npm package should trust this exact GitHub Actions workflow:

- owner: `Eaglemann`
- repository: `commitgen-cc`
- workflow filename: `release.yml`
- environment: blank unless the workflow is later updated to use a GitHub Actions environment

Notes:

- No `NPM_TOKEN` GitHub secret is required
- The workflow filename must match exactly
- Only one trusted publisher can be active for the package
- The pushed tag must match `package.json`, for example `v3.1.4` for version `3.1.4`

## Exit Codes

- `0`: success
- `1`: usage/configuration error
- `2`: git context error
- `3`: Ollama/model error
- `4`: invalid AI output or failed message validation
- `5`: `git commit` failed
- `6`: unexpected internal error
