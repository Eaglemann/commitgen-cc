import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendHistory, readHistory, resolveHistoryPath } from "../../src/history.js";

describe("readHistory", () => {
    it("ignores malformed lines and returns the most recent valid entries first", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commitgen-history-"));
        const historyPath = join(dir, "history.jsonl");

        await writeFile(historyPath, [
            "{\"bad\":true}",
            JSON.stringify({
                createdAt: "2026-03-08T12:00:00.000Z",
                message: "feat(cli): add config support",
                edited: false,
                scope: "cli",
                ticket: "ABC-123",
                files: ["src/cli.ts"]
            }),
            "not-json",
            JSON.stringify({
                createdAt: "2026-03-08T12:05:00.000Z",
                message: "fix(workflow): rank candidates",
                edited: true,
                scope: "workflow",
                ticket: null,
                files: ["src/workflow.ts"]
            })
        ].join("\n"));

        const entries = await readHistory(historyPath, 2);

        expect(entries).toHaveLength(2);
        expect(entries[0].message).toBe("fix(workflow): rank candidates");
        expect(entries[1].message).toBe("feat(cli): add config support");
    });
});

describe("resolveHistoryPath", () => {
    it("returns the expected path relative to gitDir", () => {
        const result = resolveHistoryPath("/repo/.git");
        expect(result).toBe(join("/repo/.git", "commitgen", "history.jsonl"));
    });
});

describe("appendHistory", () => {
    it("writes a valid JSONL entry to the file", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commitgen-history-"));
        const historyPath = join(dir, "commitgen", "history.jsonl");

        const entry = {
            createdAt: "2026-03-12T10:00:00.000Z",
            message: "feat(ui): add card component",
            edited: false,
            scope: "ui",
            ticket: null,
            files: ["src/ui.ts"]
        };

        await appendHistory(historyPath, entry);

        const raw = await readFile(historyPath, "utf8");
        const parsed = JSON.parse(raw.trim()) as typeof entry;
        expect(parsed.message).toBe(entry.message);
        expect(parsed.scope).toBe("ui");
        expect(parsed.edited).toBe(false);
    });

    it("appends multiple entries as separate lines", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commitgen-history-"));
        const historyPath = join(dir, "commitgen", "history.jsonl");

        const entry1 = { createdAt: "2026-03-12T10:00:00.000Z", message: "feat: first", edited: false, scope: null, ticket: null, files: [] };
        const entry2 = { createdAt: "2026-03-12T10:01:00.000Z", message: "fix: second", edited: true, scope: null, ticket: null, files: [] };

        await appendHistory(historyPath, entry1);
        await appendHistory(historyPath, entry2);

        const entries = await readHistory(historyPath, 10);
        expect(entries).toHaveLength(2);
        expect(entries[0].message).toBe("fix: second");
        expect(entries[1].message).toBe("feat: first");
    });
});

describe("readHistory (parseHistoryEntry validation)", () => {
    it("skips entries with invalid scope type", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commitgen-history-"));
        const historyPath = join(dir, "history.jsonl");
        await writeFile(historyPath, [
            JSON.stringify({ createdAt: "", message: "feat: valid", edited: false, scope: 123, ticket: null, files: [] }),
            JSON.stringify({ createdAt: "", message: "fix: also valid", edited: false, scope: null, ticket: null, files: [] })
        ].join("\n"), "utf8");

        const entries = await readHistory(historyPath, 10);
        expect(entries).toHaveLength(1);
        expect(entries[0].message).toBe("fix: also valid");
    });

    it("skips entries with invalid ticket type", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commitgen-history-"));
        const historyPath = join(dir, "history.jsonl");
        await writeFile(historyPath, [
            JSON.stringify({ createdAt: "", message: "feat: valid", edited: false, scope: null, ticket: 999, files: [] }),
            JSON.stringify({ createdAt: "", message: "fix: also valid", edited: false, scope: null, ticket: null, files: [] })
        ].join("\n"), "utf8");

        const entries = await readHistory(historyPath, 10);
        expect(entries).toHaveLength(1);
        expect(entries[0].message).toBe("fix: also valid");
    });

    it("skips entries with invalid files array (non-string element)", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commitgen-history-"));
        const historyPath = join(dir, "history.jsonl");
        await writeFile(historyPath, [
            JSON.stringify({ createdAt: "", message: "feat: valid", edited: false, scope: null, ticket: null, files: [42] }),
            JSON.stringify({ createdAt: "", message: "fix: also valid", edited: false, scope: null, ticket: null, files: [] })
        ].join("\n"), "utf8");

        const entries = await readHistory(historyPath, 10);
        expect(entries).toHaveLength(1);
        expect(entries[0].message).toBe("fix: also valid");
    });
});

describe("readHistory (additional cases)", () => {
    it("returns an empty array when the file does not exist", async () => {
        const entries = await readHistory("/nonexistent/path/history.jsonl", 10);
        expect(entries).toEqual([]);
    });

    it("returns entries in reverse chronological order (newest first)", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commitgen-history-"));
        const historyPath = join(dir, "history.jsonl");

        const lines = [
            JSON.stringify({ createdAt: "2026-01-01T00:00:00.000Z", message: "chore: first", edited: false, scope: null, ticket: null, files: [] }),
            JSON.stringify({ createdAt: "2026-01-02T00:00:00.000Z", message: "chore: second", edited: false, scope: null, ticket: null, files: [] }),
            JSON.stringify({ createdAt: "2026-01-03T00:00:00.000Z", message: "chore: third", edited: false, scope: null, ticket: null, files: [] })
        ].join("\n");

        await writeFile(historyPath, lines, "utf8");

        const entries = await readHistory(historyPath, 10);
        expect(entries[0].message).toBe("chore: third");
        expect(entries[1].message).toBe("chore: second");
        expect(entries[2].message).toBe("chore: first");
    });

    it("returns an empty array when limit is zero", async () => {
        const entries = await readHistory("/nonexistent/path/history.jsonl", 0);
        expect(entries).toEqual([]);
    });

    it("respects the limit parameter", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commitgen-history-"));
        const historyPath = join(dir, "history.jsonl");

        const lines = Array.from({ length: 5 }, (_, i) =>
            JSON.stringify({ createdAt: `2026-01-0${i + 1}T00:00:00.000Z`, message: `chore: entry ${i + 1}`, edited: false, scope: null, ticket: null, files: [] })
        ).join("\n");

        await writeFile(historyPath, lines, "utf8");

        const entries = await readHistory(historyPath, 2);
        expect(entries).toHaveLength(2);
    });
});
