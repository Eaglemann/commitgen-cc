# Git Message AI Commit

A CLI tool that uses a local [Ollama](https://ollama.com/) instance to generate Conventional Commits messages from your staged changes.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Ollama](https://ollama.com/) running locally (default: `http://localhost:11434`)
- `git`

## Installation

```bash
# Global installation
npm install -g git-message-ai-commit

# Or run directly with npx
npx git-message-ai-commit
```

## Usage

Stage your changes:

```bash
git add .
```

Run the tool:

```bash
git-ai-commit
```

### Options

- `-m, --model <name>`: Specify Ollama model (default: `llama3`)
- `--host <url>`: Ollama host (default: `http://localhost:11434`)
- `--max-chars <n>`: Max diff characters sent (range: `500-200000`, default: `16000`)
- `--type <type>`: Force a commit type (feat, fix, etc.)
- `--scope <scope>`: Optional commit scope
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

### CI usage

Generate JSON output in non-interactive mode:

```bash
git-ai-commit --ci --dry-run --output json
```

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

You can set a shorter alias (e.g. `gmac`) in your shell config (`.zshrc`, `.bashrc`, etc.):

```bash
alias gmac="git-ai-commit"
```
