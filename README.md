# Commitgen-CC

A CLI tool that uses a local [Ollama](https://ollama.com/) instance to generate Conventional Commits messages from your staged changes. It can learn from recent accepted commits, infer scopes and ticket references from repo context, and rank multiple candidates before committing.

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Ollama](https://ollama.com/) running locally (default: `http://localhost:11434`)
- `git`

## Installation

```bash
# Global installation
npm install -g commitgen-cc

# Or run directly with npx
npx commitgen-cc
```

## Usage

Stage your changes:

```bash
git add .
```

Run the tool:

```bash
commitgen-cc
```

### Options

- `-m, --model <name>`: Specify Ollama model (default: `gpt-oss:120b-cloud`)
- `--host <url>`: Ollama host (default: `http://localhost:11434`)
- `--max-chars <n>`: Max diff characters sent (range: `500-200000`, default: `16000`)
- `--type <type>`: Force a commit type (feat, fix, etc.)
- `--scope <scope>`: Optional commit scope
- `--config <path>`: Load config from a custom JSON file
- `--candidates <n>`: Generate and rank between `1` and `5` candidates
- `--ticket <id>`: Force a ticket reference such as `ABC-123`
- `--no-history`: Disable local history examples and persistence
- `--dry-run`: Print message to stdout without committing
- `--ci`: Non-interactive mode for CI/hooks
- `--allow-invalid`: Override validation and allow invalid messages
- `--timeout-ms <n>`: Ollama request timeout in milliseconds (range: `1000-300000`, default: `60000`)
- `--retries <n>`: Retry count for transient Ollama failures (range: `0-5`, default: `2`)
- `--output <text|json>`: Output format (default: `text`)
- `--no-verify`: Pass `--no-verify` to `git commit`

### Environment variables

- `GIT_AI_MODEL`
- `GIT_AI_HOST`
- `GIT_AI_TIMEOUT_MS`
- `GIT_AI_RETRIES`

### Repo config

Place a `.commitgen.json` file at the repo root to set project defaults:

```json
{
  "model": "repo-model",
  "host": "http://localhost:11434",
  "maxChars": 12000,
  "defaultScope": "cli",
  "scopes": ["cli", "workflow", "docs"],
  "ticketPattern": "([A-Z][A-Z0-9]+-\\d+)",
  "historyEnabled": true,
  "historySampleSize": 5,
  "interactiveCandidates": 3
}
```

Precedence is `CLI > env > repo config > defaults`.

Accepted commit messages are stored in `.git/commitgen/history.jsonl` by default and are reused as prompt examples on later runs.

### CI usage

Generate JSON output in non-interactive mode:

```bash
commitgen-cc --ci --dry-run --output json
```

Generate three ranked candidates and keep machine-readable metadata:

```bash
commitgen-cc --ci --dry-run --output json --candidates 3
```

JSON success output now includes `scope`, `ticket`, and `alternatives` when available.

## Releases and npm publish

This repo runs CI on pushes/PRs, and publishes only when you push a version tag. The release workflow uses npm trusted publishing via GitHub OIDC and also creates a GitHub Release for that same tag.

Setup:

1. Open the npm package settings for `commitgen-cc`.
2. Add a Trusted Publisher for GitHub Actions with:
   - owner: `Eaglemann`
   - repository: `commitgen-cc`
   - workflow filename: `release.yml`
3. Save the change. npm only allows one trusted publisher per package, so this should replace any previous `ci.yml` entry.

Release flow:

```bash
npm version patch
git push origin main --follow-tags
```

That creates a tag like `v3.1.1`, pushes it, runs the release workflow, publishes the package if that version is not already on npm, and creates a GitHub Release with the packed tarball attached.

Notes:

- No `NPM_TOKEN` GitHub secret is required for trusted publishing.
- The workflow file name matters. npm must trust `release.yml` exactly.
- npm only allows one trusted publisher per package, so `release.yml` must be the only active trusted publisher entry for this package.
- The tag must match `package.json` exactly. Example: package version `3.1.1` must be pushed as tag `v3.1.1`.
- If `npm publish` still fails with `E404` after this fix, the trusted publisher details on npm are still mismatched with the package/repo/workflow.
- If you later rename the workflow file, npm must be updated to trust the new filename.

### Exit codes

- `0`: success
- `1`: usage/configuration error
- `2`: git context error (not a repo or no staged changes)
- `3`: Ollama/model error
- `4`: invalid AI output (blocked by default)
- `5`: `git commit` failed
- `6`: unexpected internal error

## Tips

### Set an alias

You can set a shorter alias (e.g. `aic`) in your shell config (`.zshrc`, `.bashrc`, etc.):

```bash
alias aic="commitgen-cc"
```
