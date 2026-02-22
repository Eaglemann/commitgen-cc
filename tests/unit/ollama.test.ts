import { afterEach, describe, expect, it, vi } from "vitest";
import {
    checkOllamaConnection,
    ensureLocalModel,
    listLocalModels,
    ollamaChat
} from "../../src/ollama.js";

describe("ollama unit branches", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("returns HTTP error for non-ok /api/tags responses", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));

        await expect(() => listLocalModels("http://localhost:11434", 1000))
            .rejects
            .toMatchObject({ code: "HTTP_ERROR", retryable: true });
    });

    it("returns INVALID_RESPONSE when /api/tags returns invalid json", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", {
            status: 200,
            headers: { "content-type": "application/json" }
        })));

        await expect(() => listLocalModels("http://localhost:11434", 1000))
            .rejects
            .toMatchObject({ code: "INVALID_RESPONSE" });
    });

    it("matches base model names against tagged local models", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
            models: [{ name: "gpt-oss:120b-cloud:latest" }]
        }), {
            status: 200,
            headers: { "content-type": "application/json" }
        })));

        await expect(ensureLocalModel("http://localhost:11434", "gpt-oss:120b-cloud", 1000)).resolves.toBeUndefined();
    });

    it("returns false from checkOllamaConnection when fetch fails", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

        await expect(checkOllamaConnection("http://localhost:11434")).resolves.toBe(false);
    });

    it("returns MODEL_NOT_FOUND when /api/chat returns 404 model error", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("model not found", { status: 404 })));

        await expect(() => ollamaChat({
            host: "http://localhost:11434",
            model: "gpt-oss:120b-cloud",
            messages: [{ role: "user", content: "hello" }],
            retries: 0,
            timeoutMs: 1000
        })).rejects.toMatchObject({ code: "MODEL_NOT_FOUND" });
    });

    it("returns INVALID_RESPONSE when chat content is empty", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
            message: { content: "   " }
        }), {
            status: 200,
            headers: { "content-type": "application/json" }
        })));

        await expect(() => ollamaChat({
            host: "http://localhost:11434",
            model: "gpt-oss:120b-cloud",
            messages: [{ role: "user", content: "hello" }],
            retries: 0,
            timeoutMs: 1000
        })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });

    it("normalizes thrown Error objects into HTTP errors", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

        await expect(() => ollamaChat({
            host: "http://localhost:11434",
            model: "gpt-oss:120b-cloud",
            messages: [{ role: "user", content: "hello" }],
            retries: 0,
            timeoutMs: 1000
        })).rejects.toMatchObject({ code: "HTTP_ERROR", message: "boom" });
    });

    it("normalizes thrown non-error values into HTTP errors", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue("boom-string"));

        await expect(() => ollamaChat({
            host: "http://localhost:11434",
            model: "llamgpt-oss:120b-clouda3",
            messages: [{ role: "user", content: "hello" }],
            retries: 0,
            timeoutMs: 1000
        })).rejects.toMatchObject({ code: "HTTP_ERROR", message: "boom-string" });
    });
});
