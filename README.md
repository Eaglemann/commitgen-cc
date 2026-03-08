# Commitgen-CC

A CLI tool that uses a local [Ollama](https://ollama.com/) instance to generate Conventional Commits messages from your staged changes. It can learn from recent accepted commits, infer scopes and ticket references from repo context, and rank multiple candidates before committing.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
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

## Automatic npm publish

This repo publishes automatically from GitHub Actions on pushes to `main` after CI passes, using npm trusted publishing via GitHub OIDC.

Setup:

1. Open the npm package settings for `commitgen-cc`.
2. Add a Trusted Publisher for GitHub Actions with:
   - owner: `Eaglemann`
   - repository: `Git-Message-AI-Commit`
   - workflow filename: `ci.yml`
   - branch: `main`
3. Push to `main` from this repository.

The workflow publishes only when the version in `package.json` is not already on npm. If you push without bumping the version, the publish job will skip instead of failing.

Notes:

- No `NPM_TOKEN` GitHub secret is required for trusted publishing.
- The workflow file name matters. npm must trust `ci.yml` exactly.
- If you later rename the workflow file or split publishing into a different workflow, you must update the trusted publisher configuration on npm.

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
<<<<<<< HEAD
echo 'alias aic="commitgen-cc"' >> ~/.aliases \
&& { [ -n "$ZSH_VERSION" ] && echo '[ -f ~/.aliases ] && source ~/.aliases' >> ~/.zshrc; } \
&& { [ -n "$BASH_VERSION" ] && echo '[ -f ~/.aliases ] && source ~/.aliases' >> ~/.bashrc; } \
&& source ~/.aliases
=======
alias aic="commitgen-cc"
>>>>>>> 7be0031 (refactor(cli): rename tool to commitgen-cc and switch default model)
```
