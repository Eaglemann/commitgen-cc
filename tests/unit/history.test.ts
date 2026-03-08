import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readHistory } from "../../src/history.js";

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
