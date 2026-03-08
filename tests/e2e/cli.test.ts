import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";

async function initRepo(repoDir: string): Promise<void> {
    await execa("git", ["init"], { cwd: repoDir });
    await execa("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await execa("git", ["config", "user.name", "Test User"], { cwd: repoDir });
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
        await writeFile(join(repoDir, "mock-fetch.mjs"), `
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
        await execa("git", ["checkout", "-b", "feature/ABC-123-readme"], { cwd: repoDir });
        await execa("git", ["add", "README.md"], { cwd: repoDir });

        const nodeBin = process.execPath;
        const cliPath = resolve(process.cwd(), "dist/cli.js");
        const bootstrapPath = join(repoDir, "mock-fetch.mjs");
        const { stdout, exitCode } = await execa(nodeBin, [
            "--import",
            bootstrapPath,
            cliPath,
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

    it("returns git context error code when no staged changes exist", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-e2e-"));
        await initRepo(repoDir);

        const nodeBin = process.execPath;
        const cliPath = resolve(process.cwd(), "dist/cli.js");

        const error = await execa(nodeBin, [
            cliPath,
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
});
