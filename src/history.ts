import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type HistoryEntry = {
    createdAt: string;
    message: string;
    edited: boolean;
    scope: string | null;
    ticket: string | null;
    files: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseHistoryEntry(line: string): HistoryEntry | null {
    try {
        const parsed = JSON.parse(line) as unknown;
        if (!isRecord(parsed)) return null;
        if (typeof parsed.message !== "string" || parsed.message.trim().length === 0) return null;
        if (typeof parsed.edited !== "boolean") return null;
        if (parsed.scope !== null && parsed.scope !== undefined && typeof parsed.scope !== "string") return null;
        if (parsed.ticket !== null && parsed.ticket !== undefined && typeof parsed.ticket !== "string") return null;
        if (!Array.isArray(parsed.files) || parsed.files.some((entry) => typeof entry !== "string")) return null;

        return {
            createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
            message: parsed.message.trim(),
            edited: parsed.edited,
            scope: typeof parsed.scope === "string" ? parsed.scope : null,
            ticket: typeof parsed.ticket === "string" ? parsed.ticket : null,
            files: parsed.files
        };
    } catch {
        return null;
    }
}

export function resolveHistoryPath(gitDir: string): string {
    return join(gitDir, "commitgen", "history.jsonl");
}

export async function readHistory(historyPath: string, limit: number): Promise<HistoryEntry[]> {
    if (limit <= 0) return [];

    let raw: string;
    try {
        raw = await readFile(historyPath, "utf8");
    } catch {
        return [];
    }

    const entries = raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map(parseHistoryEntry)
        .filter((entry): entry is HistoryEntry => entry !== null);

    return entries.slice(-limit).reverse();
}

export async function appendHistory(historyPath: string, entry: HistoryEntry): Promise<void> {
    await mkdir(dirname(historyPath), { recursive: true });
    await appendFile(historyPath, `${JSON.stringify(entry)}\n`, "utf8");
}
