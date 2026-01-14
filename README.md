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
- `--max-chars <n>`: Max diff characters sent (default: `16000`)
- `--type <type>`: Force a commit type (feat, fix, etc.)
- `--dry-run`: Print message to stdout without committing

## Tips

### Set an alias

You can set a shorter alias (e.g. `gmac`) in your shell config (`.zshrc`, `.bashrc`, etc.):

```bash
alias gmac="git-ai-commit"
```

