export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function checkOllamaConnection(host: string): Promise<boolean> {
    try {
        const url = `${host.replace(/\/$/, "")}/api/tags`; // "tags" endpoint is lightweight
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 2000); // 2s timeout for check

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(id);

        return res.ok;
    } catch {
        return false;
    }
}

export async function ollamaChat(opts: {
    host: string;
    model: string;
    messages: ChatMessage[];
    json?: boolean;
}): Promise<string> {
    const url = `${opts.host.replace(/\/$/, "")}/api/chat`;

    // Default 60s timeout for generation
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
        const body: any = {
            model: opts.model,
            messages: opts.messages,
            stream: false
        };
        if (opts.json) body.format = "json";

        const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Ollama error ${res.status}: ${text}`);
        }

        const data = await res.json() as { message?: { content?: string } };
        return data?.message?.content ?? "";
    } catch (e) {
        if ((e as Error).name === "AbortError") {
            throw new Error("Ollama request timed out (60s).");
        }
        throw e;
    } finally {
        clearTimeout(timeoutId);
    }
}
