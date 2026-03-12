import { describe, expect, it, vi } from "vitest";
import { resolveCommitPolicy } from "../../src/policy.js";
import type { ResolvedWorkflowOptions } from "../../src/workflow.js";

const gitMock = {
    getStagedDiff: vi.fn().mockResolvedValue("diff --git a/src/a.ts b/src/a.ts\n+const x = 1;"),
    getStagedFiles: vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts"]),
    getCurrentBranch: vi.fn().mockResolvedValue("feature/ABC-42-add-thing")
};

vi.mock("../../src/git.js", () => gitMock);

const historyMock = {
    readHistory: vi.fn().mockResolvedValue([]),
    resolveHistoryPath: vi.fn().mockReturnValue("/repo/.git/commitgen/history.jsonl")
};

vi.mock("../../src/history.js", () => historyMock);

const { loadRepoContext } = await import("../../src/repo-context-loader.js");

function baseOptions(overrides: Partial<ResolvedWorkflowOptions> = {}): ResolvedWorkflowOptions {
    return {
        model: "llama3",
        host: "http://localhost:11434",
        maxChars: 100000,
        type: null,
        scope: null,
        dryRun: false,
        noVerify: false,
        ci: false,
        allowInvalid: false,
        explain: false,
        timeoutMs: 60000,
        retries: 2,
        output: "text",
        candidates: 1,
        ticket: null,
        historyEnabled: true,
        historySampleSize: 3,
        ticketPattern: "([A-Z][A-Z0-9]+-\\d+)",
        defaultScope: null,
        knownScopes: [],
        policy: resolveCommitPolicy({}),
        ...overrides
    };
}

describe("loadRepoContext", () => {
    it("returns the expected context shape", async () => {
        const ctx = await loadRepoContext("/repo/.git", baseOptions());

        expect(ctx.gitDir).toBe("/repo/.git");
        expect(typeof ctx.diff).toBe("string");
        expect(Array.isArray(ctx.files)).toBe(true);
        expect(ctx.branch).toBe("feature/ABC-42-add-thing");
        expect(ctx.historyPath).toBe("/repo/.git/commitgen/history.jsonl");
    });

    it("infers a ticket from the branch using ticketPattern", async () => {
        const ctx = await loadRepoContext("/repo/.git", baseOptions());
        expect(ctx.ticket).toBe("ABC-42");
    });

    it("uses the explicit ticket when provided via options", async () => {
        const ctx = await loadRepoContext("/repo/.git", baseOptions({ ticket: "PROJ-99" }));
        expect(ctx.ticket).toBe("PROJ-99");
    });

    it("returns null historyPath when historyEnabled is false", async () => {
        const ctx = await loadRepoContext("/repo/.git", baseOptions({ historyEnabled: false }));
        expect(ctx.historyPath).toBeNull();
    });

    it("does not call readHistory when historyEnabled is false", async () => {
        historyMock.readHistory.mockClear();
        await loadRepoContext("/repo/.git", baseOptions({ historyEnabled: false }));
        expect(historyMock.readHistory).not.toHaveBeenCalled();
    });

    it("calls readHistory with historyPath and historySampleSize when enabled", async () => {
        historyMock.readHistory.mockClear();
        historyMock.readHistory.mockResolvedValueOnce([
            { message: "feat: old thing", createdAt: "", edited: false, scope: null, ticket: null, files: [] }
        ]);
        const ctx = await loadRepoContext("/repo/.git", baseOptions({ historySampleSize: 3 }));
        expect(historyMock.readHistory).toHaveBeenCalledWith(
            "/repo/.git/commitgen/history.jsonl",
            3
        );
        expect(ctx.recentExamples).toEqual(["feat: old thing"]);
    });

    it("uses the forced type from options", async () => {
        const ctx = await loadRepoContext("/repo/.git", baseOptions({ type: "fix" }));
        expect(ctx.expectedType).toBe("fix");
    });

    it("uses the forced scope from options as effectiveScope", async () => {
        const ctx = await loadRepoContext("/repo/.git", baseOptions({ scope: "cli" }));
        expect(ctx.effectiveScope).toBe("cli");
    });

    it("clamps the diff to maxChars", async () => {
        gitMock.getStagedDiff.mockResolvedValueOnce("x".repeat(1000));
        const ctx = await loadRepoContext("/repo/.git", baseOptions({ maxChars: 100 }));
        expect(ctx.diff.length).toBeLessThanOrEqual(100 + 50); // allow for truncation message
    });
});
