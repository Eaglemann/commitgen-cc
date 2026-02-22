# Commitgen-CC

A CLI tool that uses a local [Ollama](https://ollama.com/) instance to generate Conventional Commits messages from your staged changes.

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
commitgen-cc --ci --dry-run --output json
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
