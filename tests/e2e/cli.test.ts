import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";

async function initRepo(repoDir: string): Promise<void> {
    await execa("git", ["init"], { cwd: repoDir });
    await execa("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await execa("git", ["config", "user.name", "Test User"], { cwd: repoDir });
}

function getCliPath(): string {
    return resolve(process.cwd(), "dist/cli.js");
}

function getNodeBin(): string {
    return process.execPath;
}

async function writeMockFetch(repoDir: string): Promise<string> {
    const bootstrapPath = join(repoDir, "mock-fetch.mjs");
    await writeFile(bootstrapPath, `
const chatResponses = JSON.parse(process.env.MOCK_OLLAMA_CHAT_RESPONSES ?? "[]");
const models = JSON.parse(process.env.MOCK_OLLAMA_MODELS ?? "[]");

globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.endsWith("/api/tags")) {
    return new Response(JSON.stringify({ models: models.map((name) => ({ name })) }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (target.endsWith("/api/chat")) {
    const content = chatResponses.shift() ?? "{\\"message\\":\\"docs: update readme\\"}";
    return new Response(JSON.stringify({ message: { content } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  return new Response("not found", { status: 404 });
};
`);
    return bootstrapPath;
}

describe("cli e2e", () => {
    it("emits JSON success output in CI dry-run mode with repo config, ticket inference, and alternatives", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-e2e-"));
        await initRepo(repoDir);
        await writeFile(join(repoDir, "README.md"), "# Demo\n");
        await writeFile(join(repoDir, ".commitgen.json"), JSON.stringify({
            model: "repo-model",
            host: "http://repo-config-host"
        }, null, 2));
        const bootstrapPath = await writeMockFetch(repoDir);
        await execa("git", ["checkout", "-b", "feature/ABC-123-readme"], { cwd: repoDir });
        await execa("git", ["add", "README.md"], { cwd: repoDir });

        const { stdout, exitCode } = await execa(getNodeBin(), [
            "--import",
            bootstrapPath,
            getCliPath(),
            "--ci",
            "--dry-run",
            "--output",
            "json",
            "--candidates",
            "3"
        ], {
            cwd: repoDir,
            env: {
                MOCK_OLLAMA_MODELS: JSON.stringify(["repo-model:latest"]),
                MOCK_OLLAMA_CHAT_RESPONSES: JSON.stringify([
                    "{\"messages\":[\"docs: update readme\",\"docs: refine readme guidance\",\"docs: tighten readme copy\"]}"
                ])
            }
        });

        expect(exitCode).toBe(0);
        const payload = JSON.parse(stdout) as {
            status: string;
            message: string;
            source: string;
            committed: boolean;
            ticket?: string;
            alternatives?: string[];
        };

        expect(payload.status).toBe("ok");
        expect(payload.message).toBe("docs: update readme\n\nRefs ABC-123");
        expect(payload.committed).toBe(false);
        expect(payload.source).toBe("repaired");
        expect(payload.ticket).toBe("ABC-123");
        expect(payload.alternatives).toEqual([
            "docs: refine readme guidance\n\nRefs ABC-123",
            "docs: tighten readme copy\n\nRefs ABC-123"
        ]);
    });

    it("emits JSON diagnostics when explain mode is enabled", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-e2e-"));
        await initRepo(repoDir);
        await writeFile(join(repoDir, "README.md"), "# Demo\n");
        await writeFile(join(repoDir, ".commitgen.json"), JSON.stringify({
            model: "repo-model",
            host: "http://repo-config-host"
        }, null, 2));
        const bootstrapPath = await writeMockFetch(repoDir);
        await execa("git", ["checkout", "-b", "feature/ABC-123-readme"], { cwd: repoDir });
        await execa("git", ["add", "README.md"], { cwd: repoDir });

        const { stdout, exitCode } = await execa(getNodeBin(), [
            "--import",
            bootstrapPath,
            getCliPath(),
            "--ci",
            "--dry-run",
            "--output",
            "json",
            "--candidates",
            "2",
            "--explain"
        ], {
            cwd: repoDir,
            env: {
                MOCK_OLLAMA_MODELS: JSON.stringify(["repo-model:latest"]),
                MOCK_OLLAMA_CHAT_RESPONSES: JSON.stringify([
                    "{\"messages\":[\"docs: update readme\",\"docs: refine readme guidance\"]}"
                ])
            }
        });

        expect(exitCode).toBe(0);
        const payload = JSON.parse(stdout) as {
            status: string;
            diagnostics?: {
                context: {
                    ticket: {
                        value: string | null;
                        source: string;
                    };
                };
                selected: {
                    source: string;
                    validation: {
                        ok: boolean;
                    };
                    ranking: {
                        total: number;
                    };
                };
                candidates: Array<unknown>;
            };
        };

        expect(payload.status).toBe("ok");
        expect(payload.diagnostics?.context.ticket).toEqual({
            value: "ABC-123",
            source: "branch"
        });
        expect(payload.diagnostics?.selected.source).toBe("repaired");
        expect(payload.diagnostics?.selected.validation.ok).toBe(true);
        expect(payload.diagnostics?.selected.ranking.total).toBeGreaterThan(0);
        expect(payload.diagnostics?.candidates).toHaveLength(2);
    });

    it("returns git context error code when no staged changes exist", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-e2e-"));
        await initRepo(repoDir);

        const error = await execa(getNodeBin(), [
            getCliPath(),
            "--ci",
            "--output",
            "json"
        ], { cwd: repoDir, reject: false });

        expect(error.exitCode).toBe(2);
        const payload = JSON.parse(error.stdout) as {
            status: string;
            code: string;
            hint: string;
        };

        expect(payload.status).toBe("error");
        expect(payload.code).toBe("GIT_CONTEXT_ERROR");
        expect(payload.hint).toContain("Stage files first");
    });

    it("prints doctor output in named sections", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-e2e-"));
        await initRepo(repoDir);
        const bootstrapPath = await writeMockFetch(repoDir);

        const { stdout, exitCode } = await execa(getNodeBin(), [
            "--import",
            bootstrapPath,
            getCliPath(),
            "doctor"
        ], {
            cwd: repoDir,
            env: {
                MOCK_OLLAMA_MODELS: JSON.stringify(["gpt-oss:120b-cloud:latest"])
            }
        });

        expect(exitCode).toBe(0);
        expect(stdout).toContain("== Doctor ==");
        expect(stdout).toContain("== Environment ==");
        expect(stdout).toContain("== Repository ==");
        expect(stdout).toContain("== Ollama ==");
        expect(stdout).toContain("All checks passed.");
    });

    it("prints explain output in single-candidate dry-run text mode", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-e2e-"));
        await initRepo(repoDir);
        await writeFile(join(repoDir, "README.md"), "# Demo\n");
        const bootstrapPath = await writeMockFetch(repoDir);
        await execa("git", ["checkout", "-b", "feature/ABC-123-readme"], { cwd: repoDir });
        await execa("git", ["add", "README.md"], { cwd: repoDir });

        const { stdout, exitCode } = await execa(getNodeBin(), [
            "--import",
            bootstrapPath,
            getCliPath(),
            "--dry-run",
            "--explain"
        ], {
            cwd: repoDir,
            env: {
                MOCK_OLLAMA_MODELS: JSON.stringify(["gpt-oss:120b-cloud:latest"]),
                MOCK_OLLAMA_CHAT_RESPONSES: JSON.stringify([
                    "{\"message\":\"docs: update readme\"}"
                ])
            }
        });

        expect(exitCode).toBe(0);
        expect(stdout).toContain("docs: update readme");
        expect(stdout).toContain("== Why this message ==");
        expect(stdout).toContain("Selected ticket : ABC-123 (branch inference)");
        expect(stdout).toContain("Ranking");
    });

    it("prints explain output with alternatives in multi-candidate dry-run text mode", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-e2e-"));
        await initRepo(repoDir);
        await writeFile(join(repoDir, "README.md"), "# Demo\n");
        const bootstrapPath = await writeMockFetch(repoDir);
        await execa("git", ["checkout", "-b", "feature/ABC-123-readme"], { cwd: repoDir });
        await execa("git", ["add", "README.md"], { cwd: repoDir });

        const { stdout, exitCode } = await execa(getNodeBin(), [
            "--import",
            bootstrapPath,
            getCliPath(),
            "--dry-run",
            "--candidates",
            "2",
            "--explain"
        ], {
            cwd: repoDir,
            env: {
                MOCK_OLLAMA_MODELS: JSON.stringify(["gpt-oss:120b-cloud:latest"]),
                MOCK_OLLAMA_CHAT_RESPONSES: JSON.stringify([
                    "{\"messages\":[\"docs: update readme\",\"docs: refine readme guidance\"]}"
                ])
            }
        });

        expect(exitCode).toBe(0);
        expect(stdout).toContain("== Why this message ==");
        expect(stdout).toContain("Alternatives    : 1");
    });

    it("shows full validation errors in explain mode when generation is invalid", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-e2e-"));
        await initRepo(repoDir);
        await mkdir(join(repoDir, "src"), { recursive: true });
        await writeFile(join(repoDir, "src", "cli.ts"), "export const x = 1;\n");
        await writeFile(join(repoDir, ".commitgen.json"), JSON.stringify({
            requireTicket: true,
            requiredScopes: ["cli"]
        }, null, 2));
        const bootstrapPath = await writeMockFetch(repoDir);
        await execa("git", ["add", "src/cli.ts"], { cwd: repoDir });

        const result = await execa(getNodeBin(), [
            "--import",
            bootstrapPath,
            getCliPath(),
            "--dry-run",
            "--config",
            ".commitgen.json",
            "--explain"
        ], {
            cwd: repoDir,
            env: {
                MOCK_OLLAMA_MODELS: JSON.stringify(["gpt-oss:120b-cloud:latest"]),
                MOCK_OLLAMA_CHAT_RESPONSES: JSON.stringify([
                    "{\"message\":\"bad message\"}"
                ])
            },
            reject: false
        });

        expect(result.exitCode).toBe(4);
        expect(result.stderr).toContain("AI output failed validation: Not Conventional Commits format");
        expect(result.stderr).toContain("Not Conventional Commits format");
        expect(result.stderr).toContain("== Why this message ==");
        expect(result.stderr).toContain("Scope is required and must be one of: cli.");
        expect(result.stderr).toContain("Message must reference a ticket.");
    });

    it("installs and uninstalls managed hooks", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-hooks-"));
        await initRepo(repoDir);

        await execa(getNodeBin(), [getCliPath(), "install-hook"], { cwd: repoDir });

        const prepareHookPath = join(repoDir, ".git", "hooks", "prepare-commit-msg");
        const commitHookPath = join(repoDir, ".git", "hooks", "commit-msg");
        const prepareHook = await readFile(prepareHookPath, "utf8");
        const commitHook = await readFile(commitHookPath, "utf8");
        const prepareStats = await stat(prepareHookPath);

        expect(prepareHook).toContain("commitgen-cc managed hook");
        expect(commitHook).toContain("commitgen-cc managed hook");
        expect(prepareStats.mode & 0o111).not.toBe(0);

        await execa(getNodeBin(), [getCliPath(), "uninstall-hook"], { cwd: repoDir });
        await expect(stat(prepareHookPath)).rejects.toThrow();
        await expect(stat(commitHookPath)).rejects.toThrow();
    });

    it("generates a commit message through the prepare-commit-msg hook using the installed config path", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-hooks-"));
        await initRepo(repoDir);
        await writeFile(join(repoDir, "README.md"), "# Demo\n");
        await writeFile(join(repoDir, "custom-config.json"), JSON.stringify({
            model: "custom-model",
            host: "http://custom-host"
        }, null, 2));
        const bootstrapPath = await writeMockFetch(repoDir);
        await execa("git", ["add", "README.md"], { cwd: repoDir });
        await execa(getNodeBin(), [getCliPath(), "install-hook", "--config", "custom-config.json"], { cwd: repoDir });

        const messageFile = join(repoDir, "COMMIT_EDITMSG");
        await writeFile(messageFile, "");

        const hookResult = await execa(join(repoDir, ".git", "hooks", "prepare-commit-msg"), [messageFile], {
            cwd: repoDir,
            env: {
                NODE_OPTIONS: `--import ${bootstrapPath}`,
                MOCK_OLLAMA_MODELS: JSON.stringify(["custom-model:latest"]),
                MOCK_OLLAMA_CHAT_RESPONSES: JSON.stringify([
                    "{\"message\":\"docs: update readme\"}"
                ])
            }
        });

        expect(hookResult.exitCode).toBe(0);
        await expect(readFile(messageFile, "utf8")).resolves.toContain("docs: update readme");
    });

    it("stores an absolute installed config path so hooks still work when installed from a subdirectory", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-hooks-"));
        const nestedDir = join(repoDir, "nested");
        await initRepo(repoDir);
        await mkdir(nestedDir, { recursive: true });
        await writeFile(join(repoDir, "README.md"), "# Demo\n");
        const configPath = join(repoDir, "custom-config.json");
        await writeFile(configPath, JSON.stringify({
            model: "custom-model",
            host: "http://custom-host"
        }, null, 2));
        const bootstrapPath = await writeMockFetch(repoDir);
        await execa("git", ["add", "README.md"], { cwd: repoDir });
        await execa(getNodeBin(), [getCliPath(), "install-hook", "--config", "../custom-config.json"], {
            cwd: nestedDir
        });

        const prepareHookPath = join(repoDir, ".git", "hooks", "prepare-commit-msg");
        await expect(readFile(prepareHookPath, "utf8")).resolves.toContain(configPath);

        const messageFile = join(repoDir, "COMMIT_EDITMSG");
        await writeFile(messageFile, "");

        const hookResult = await execa(prepareHookPath, [messageFile], {
            cwd: repoDir,
            env: {
                NODE_OPTIONS: `--import ${bootstrapPath}`,
                MOCK_OLLAMA_MODELS: JSON.stringify(["custom-model:latest"]),
                MOCK_OLLAMA_CHAT_RESPONSES: JSON.stringify([
                    "{\"message\":\"docs: update readme\"}"
                ])
            }
        });

        expect(hookResult.exitCode).toBe(0);
        await expect(readFile(messageFile, "utf8")).resolves.toContain("docs: update readme");
    });

    it("blocks invalid commit messages through the commit-msg hook and validates files via lint-message", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-hooks-"));
        await initRepo(repoDir);
        await writeFile(join(repoDir, ".commitgen.json"), JSON.stringify({
            hookMode: "enforce",
            requireTicket: true
        }, null, 2));
        await execa(getNodeBin(), [getCliPath(), "install-hook"], { cwd: repoDir });

        const messageFile = join(repoDir, "COMMIT_EDITMSG");
        await writeFile(messageFile, "bad message\n");

        const hookResult = await execa(join(repoDir, ".git", "hooks", "commit-msg"), [messageFile], {
            cwd: repoDir,
            reject: false
        });

        expect(hookResult.exitCode).toBe(4);
        expect(hookResult.stderr).toContain("Commit message failed validation.");

        await writeFile(messageFile, "fix(cli): tighten hook flow\n\nRefs ABC-123\n");
        const lintResult = await execa(getNodeBin(), [
            getCliPath(),
            "lint-message",
            "--file",
            messageFile,
            "--output",
            "json"
        ], { cwd: repoDir });

        const payload = JSON.parse(lintResult.stdout) as {
            status: string;
            subject: string;
            ticket: string;
        };
        expect(payload.status).toBe("ok");
        expect(payload.subject).toBe("fix(cli): tighten hook flow");
        expect(payload.ticket).toBe("ABC-123");
    });
});
