import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ollamaChat, ensureLocalModel, OllamaError } from "../../src/ollama.js";

type Handler = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void;

async function startServer(handler: Handler): Promise<{ host: string; close: () => Promise<void> }> {
    const server = createServer(handler);

    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Failed to start test server.");
    }

    return {
        host: `http://127.0.0.1:${address.port}`,
        close: async () => {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        }
    };
}

describe("ollama helpers", () => {
    const cleaners: Array<() => Promise<void>> = [];

    afterEach(async () => {
        while (cleaners.length > 0) {
            const cleanup = cleaners.pop();
            if (cleanup) await cleanup();
        }
    });

    it("retries chat on transient server errors", async () => {
        let attempts = 0;
        const server = await startServer((req, res) => {
            if (req.url === "/api/chat" && req.method === "POST") {
                attempts += 1;
                if (attempts < 3) {
                    res.statusCode = 500;
                    res.end("temporary failure");
                    return;
                }

                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ message: { content: "{\"message\":\"feat: recover after retries\"}" } }));
                return;
            }

            if (req.url === "/api/tags" && req.method === "GET") {
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ models: [{ name: "llama3:latest" }] }));
                return;
            }

            res.statusCode = 404;
            res.end();
        });
        cleaners.push(server.close);

        const content = await ollamaChat({
            host: server.host,
            model: "llama3",
            messages: [{ role: "user", content: "hello" }],
            json: true,
            retries: 2,
            timeoutMs: 2000
        });

        expect(content).toContain("feat: recover after retries");
        expect(attempts).toBe(3);
    });

    it("throws a timeout error when the server is too slow", async () => {
        const server = await startServer((req, res) => {
            if (req.url === "/api/chat" && req.method === "POST") {
                setTimeout(() => {
                    res.setHeader("content-type", "application/json");
                    res.end(JSON.stringify({ message: { content: "{\"message\":\"feat: late response\"}" } }));
                }, 120);
                return;
            }

            res.statusCode = 404;
            res.end();
        });
        cleaners.push(server.close);

        await expect(() => ollamaChat({
            host: server.host,
            model: "llama3",
            messages: [{ role: "user", content: "hello" }],
            json: true,
            retries: 0,
            timeoutMs: 20
        })).rejects.toMatchObject<OllamaError>({ code: "TIMEOUT" });
    });

    it("fails model readiness check when local model is missing", async () => {
        const server = await startServer((req, res) => {
            if (req.url === "/api/tags" && req.method === "GET") {
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ models: [{ name: "mistral:latest" }] }));
                return;
            }

            res.statusCode = 404;
            res.end();
        });
        cleaners.push(server.close);

        await expect(() => ensureLocalModel(server.host, "llama3", 1000))
            .rejects
            .toMatchObject<OllamaError>({ code: "MODEL_NOT_FOUND" });
    });
});
