import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";

type Handler = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void;

async function startServer(handler: Handler): Promise<{ host: string; close: () => Promise<void> }> {
    const server = createServer(handler);

    await new Promise<void>((resolveStart) => {
        server.listen(0, "127.0.0.1", () => resolveStart());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Failed to start server.");
    }

    return {
        host: `http://127.0.0.1:${address.port}`,
        close: async () => {
            await new Promise<void>((resolveClose, rejectClose) => {
                server.close((error) => (error ? rejectClose(error) : resolveClose()));
            });
        }
    };
}

async function initRepo(repoDir: string): Promise<void> {
    await execa("git", ["init"], { cwd: repoDir });
    await execa("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await execa("git", ["config", "user.name", "Test User"], { cwd: repoDir });
}

describe("cli e2e", () => {
    const cleanupTasks: Array<() => Promise<void>> = [];

    afterEach(async () => {
        while (cleanupTasks.length > 0) {
            const cleanup = cleanupTasks.pop();
            if (cleanup) await cleanup();
        }
    });

    it("emits JSON success output in CI dry-run mode", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-e2e-"));
        await initRepo(repoDir);
        await writeFile(join(repoDir, "README.md"), "# Demo\n");
        await execa("git", ["add", "README.md"], { cwd: repoDir });

        const server = await startServer((req, res) => {
            if (req.url === "/api/tags" && req.method === "GET") {
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ models: [{ name: "llama3:latest" }] }));
                return;
            }

            if (req.url === "/api/chat" && req.method === "POST") {
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({
                    message: { content: "{\"message\":\"docs: update readme\"}" }
                }));
                return;
            }

            res.statusCode = 404;
            res.end();
        });
        cleanupTasks.push(server.close);

        const tsxBin = resolve(process.cwd(), "node_modules/.bin/tsx");
        const cliPath = resolve(process.cwd(), "src/cli.ts");
        const { stdout, exitCode } = await execa(tsxBin, [
            cliPath,
            "--ci",
            "--dry-run",
            "--output",
            "json",
            "--host",
            server.host,
            "--model",
            "llama3"
        ], { cwd: repoDir });

        expect(exitCode).toBe(0);
        const payload = JSON.parse(stdout) as {
            status: string;
            message: string;
            source: string;
            committed: boolean;
        };

        expect(payload.status).toBe("ok");
        expect(payload.message).toBe("docs: update readme");
        expect(payload.committed).toBe(false);
        expect(payload.source).toBe("model");
    });

    it("returns git context error code when no staged changes exist", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "git-ai-commit-e2e-"));
        await initRepo(repoDir);

        const tsxBin = resolve(process.cwd(), "node_modules/.bin/tsx");
        const cliPath = resolve(process.cwd(), "src/cli.ts");

        const error = await execa(tsxBin, [
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
