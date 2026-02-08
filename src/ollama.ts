export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type OllamaErrorCode = "UNREACHABLE" | "TIMEOUT" | "HTTP_ERROR" | "MODEL_NOT_FOUND" | "INVALID_RESPONSE";

export class OllamaError extends Error {
    code: OllamaErrorCode;
    hint: string | null;
    status: number | null;
    retryable: boolean;

    constructor(message: string, code: OllamaErrorCode, opts?: {
        hint?: string;
        status?: number;
        retryable?: boolean;
    }) {
        super(message);
        this.name = "OllamaError";
        this.code = code;
        this.hint = opts?.hint ?? null;
        this.status = opts?.status ?? null;
        this.retryable = opts?.retryable ?? false;
    }
}

type ChatOptions = {
    host: string;
    model: string;
    messages: ChatMessage[];
    json?: boolean;
    timeoutMs?: number;
    retries?: number;
};

type TagsResponse = {
    models?: Array<{ name?: string }>;
};

function toUrl(host: string, path: string): string {
    return `${host.replace(/\/$/, "")}${path}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal
        });
    } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
            throw new OllamaError(`Ollama request timed out (${timeoutMs}ms).`, "TIMEOUT", {
                hint: "Ensure Ollama is running and/or increase --timeout-ms.",
                retryable: true
            });
        }
        if (error instanceof TypeError) {
            throw new OllamaError("Cannot reach Ollama.", "UNREACHABLE", {
                hint: "Run `ollama serve` and verify --host points to the local Ollama endpoint.",
                retryable: true
            });
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function listLocalModels(host: string, timeoutMs = 2000): Promise<string[]> {
    const url = toUrl(host, "/api/tags");
    const res = await fetchWithTimeout(url, { method: "GET" }, timeoutMs);

    if (!res.ok) {
        throw new OllamaError(`Ollama returned HTTP ${res.status} while checking models.`, "HTTP_ERROR", {
            status: res.status,
            retryable: res.status >= 500,
            hint: "Confirm Ollama is healthy and reachable on --host."
        });
    }

    let data: TagsResponse;
    try {
        data = await res.json() as TagsResponse;
    } catch {
        throw new OllamaError("Failed to parse Ollama model list response.", "INVALID_RESPONSE", {
            hint: "Update Ollama and retry. The /api/tags response was not valid JSON."
        });
    }

    return (data.models ?? [])
        .map((model) => model.name?.trim())
        .filter((name): name is string => Boolean(name));
}

function matchesModel(requested: string, available: string): boolean {
    const req = requested.toLowerCase();
    const model = available.toLowerCase();

    if (req === model) return true;
    if (!req.includes(":") && model.startsWith(`${req}:`)) return true;
    return false;
}

export async function ensureLocalModel(host: string, model: string, timeoutMs: number): Promise<void> {
    const availableModels = await listLocalModels(host, timeoutMs);
    const found = availableModels.some((available) => matchesModel(model, available));

    if (!found) {
        throw new OllamaError(`Model "${model}" is not available in local Ollama.`, "MODEL_NOT_FOUND", {
            hint: `Run \`ollama pull ${model}\` and try again.`
        });
    }
}

export async function checkOllamaConnection(host: string): Promise<boolean> {
    try {
        await listLocalModels(host, 2000);
        return true;
    } catch {
        return false;
    }
}

function shouldRetry(error: OllamaError): boolean {
    if (error.retryable) return true;
    return error.code === "HTTP_ERROR" && Boolean(error.status && error.status >= 500);
}

function normalizeOllamaError(error: unknown): OllamaError {
    if (error instanceof OllamaError) return error;
    if (error instanceof Error) {
        return new OllamaError(error.message, "HTTP_ERROR");
    }
    return new OllamaError(String(error), "HTTP_ERROR");
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ollamaChat(opts: ChatOptions): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? 60000;
    const retries = Math.max(0, Math.floor(opts.retries ?? 2));
    const url = toUrl(opts.host, "/api/chat");

    let lastError: OllamaError | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const body: {
                model: string;
                messages: ChatMessage[];
                stream: boolean;
                format?: "json";
            } = {
                model: opts.model,
                messages: opts.messages,
                stream: false
            };
            if (opts.json) body.format = "json";

            const res = await fetchWithTimeout(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body)
            }, timeoutMs);

            if (!res.ok) {
                const text = await res.text().catch(() => "");

                if (res.status === 404 && text.toLowerCase().includes("model")) {
                    throw new OllamaError(`Model "${opts.model}" is not available in local Ollama.`, "MODEL_NOT_FOUND", {
                        status: res.status,
                        hint: `Run \`ollama pull ${opts.model}\` and try again.`
                    });
                }

                throw new OllamaError(`Ollama error ${res.status}: ${text}`, "HTTP_ERROR", {
                    status: res.status,
                    retryable: res.status >= 500,
                    hint: "Check Ollama logs and confirm the local model can run."
                });
            }

            const data = await res.json() as { message?: { content?: string } };
            const content = data?.message?.content;
            if (typeof content !== "string" || content.trim() === "") {
                throw new OllamaError("Ollama returned an empty response.", "INVALID_RESPONSE", {
                    hint: "Try a larger --timeout-ms, then retry generation."
                });
            }

            return content;
        } catch (error: unknown) {
            const normalized = normalizeOllamaError(error);
            lastError = normalized;

            if (attempt < retries && shouldRetry(normalized)) {
                await sleep(150 * (attempt + 1));
                continue;
            }

            throw normalized;
        }
    }

    throw (lastError ?? new OllamaError("Unknown Ollama failure.", "HTTP_ERROR"));
}
