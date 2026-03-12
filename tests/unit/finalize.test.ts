import { describe, expect, it, vi } from "vitest";
import { ExitCode } from "../../src/exit-codes.js";
import { WorkflowError } from "../../src/workflow-errors.js";
import type { RankedCandidate } from "../../src/ranking.js";
import type { RepoContext, ResolvedWorkflowOptions } from "../../src/workflow.js";
import { resolveCommitPolicy } from "../../src/policy.js";

const gitMock = { gitCommit: vi.fn() };
vi.mock("../../src/git.js", () => gitMock);

const historyMock = { appendHistory: vi.fn() };
vi.mock("../../src/history.js", () => historyMock);

const {
    getMessageSubject,
    buildSuccessResult,
    ensureValid,
    commitMessage,
    maybeRecordHistory,
    getAlternatives
} = await import("../../src/finalize.js");

function makeCandidate(overrides: Partial<RankedCandidate> = {}): RankedCandidate {
    return {
        message: "feat(api): add endpoint",
        source: "model",
        validation: { ok: true, reason: "" },
        score: 1,
        scoreBreakdown: { typeMatch: 0, scopeMatch: 0, subjectLength: 0, hasBody: 0, ticketMatch: 0 },
        ...overrides
    };
}

function baseContext(overrides: Partial<RepoContext> = {}): RepoContext {
    return {
        gitDir: "/repo/.git",
        diff: "diff --git a/src/a.ts b/src/a.ts\n+const x = 1;",
        files: ["src/a.ts"],
        branch: "feature/add-thing",
        suggestedScope: null,
        effectiveScope: null,
        ticket: null,
        recentExamples: [],
        expectedType: null,
        historyPath: "/repo/.git/commitgen/history.jsonl",
        ...overrides
    };
}

function baseOptions(overrides: Partial<ResolvedWorkflowOptions> = {}): ResolvedWorkflowOptions {
    return {
        model: "llama3",
        host: "http://localhost:11434",
        maxChars: 10000,
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

describe("getMessageSubject", () => {
    it("returns the first line of a multi-line message", () => {
        expect(getMessageSubject("feat: add thing\n\nbody")).toBe("feat: add thing");
    });

    it("trims whitespace", () => {
        expect(getMessageSubject("  fix: bug  ")).toBe("fix: bug");
    });

    it("returns the full message when there is no newline", () => {
        expect(getMessageSubject("chore: update deps")).toBe("chore: update deps");
    });

    it("returns empty string for an empty message", () => {
        expect(getMessageSubject("")).toBe("");
    });
});

describe("buildSuccessResult", () => {
    it("returns a SuccessResult with ok:true", () => {
        const result = buildSuccessResult("feat(api): add thing", "model", true, false, baseContext(), "([A-Z]+-\\d+)", []);
        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(ExitCode.Success);
        expect(result.committed).toBe(true);
        expect(result.cancelled).toBe(false);
        expect(result.message).toBe("feat(api): add thing");
        expect(result.source).toBe("model");
    });

    it("extracts scope from the message", () => {
        const result = buildSuccessResult("feat(cli): add flag", "model", false, false, baseContext(), "([A-Z]+-\\d+)", []);
        expect(result.scope).toBe("cli");
    });

    it("extracts ticket from the message body", () => {
        const result = buildSuccessResult("fix: handle error\n\nRefs ABC-123", "model", true, false, baseContext(), "([A-Z][A-Z0-9]+-\\d+)", []);
        expect(result.ticket).toBe("ABC-123");
    });

    it("includes alternatives when provided", () => {
        const result = buildSuccessResult("feat: thing", "model", true, false, baseContext(), "([A-Z]+-\\d+)", ["alt1", "alt2"]);
        expect(result.alternatives).toEqual(["alt1", "alt2"]);
    });

    it("omits alternatives when empty", () => {
        const result = buildSuccessResult("feat: thing", "model", true, false, baseContext(), "([A-Z]+-\\d+)", []);
        expect(result.alternatives).toBeUndefined();
    });
});

describe("ensureValid", () => {
    it("does not throw when the candidate is valid", () => {
        expect(() => ensureValid(makeCandidate(), false)).not.toThrow();
    });

    it("does not throw when invalid but allowInvalid is true", () => {
        const candidate = makeCandidate({ validation: { ok: false, reason: "bad format" } });
        expect(() => ensureValid(candidate, true)).not.toThrow();
    });

    it("throws a WorkflowError when invalid and allowInvalid is false", () => {
        const candidate = makeCandidate({ validation: { ok: false, reason: "bad format" } });
        expect(() => ensureValid(candidate, false)).toThrow(WorkflowError);
    });

    it("throws with InvalidAiOutput exit code", () => {
        const candidate = makeCandidate({ validation: { ok: false, reason: "bad format" } });
        try {
            ensureValid(candidate, false);
            expect.fail("should have thrown");
        } catch (err) {
            expect((err as WorkflowError).exitCode).toBe(ExitCode.InvalidAiOutput);
        }
    });
});

describe("commitMessage", () => {
    it("calls gitCommit with the message and noVerify flag", async () => {
        gitMock.gitCommit.mockResolvedValueOnce(undefined);
        await commitMessage("feat: do thing", false);
        expect(gitMock.gitCommit).toHaveBeenCalledWith("feat: do thing", { noVerify: false });
    });

    it("throws WorkflowError with GitCommitError when gitCommit fails", async () => {
        gitMock.gitCommit.mockRejectedValueOnce(new Error("hook failed"));
        await expect(commitMessage("feat: do thing", false)).rejects.toBeInstanceOf(WorkflowError);
    });

    it("includes GitCommitError exit code on failure", async () => {
        gitMock.gitCommit.mockRejectedValueOnce(new Error("hook failed"));
        try {
            await commitMessage("feat: do thing", false);
            expect.fail("should have thrown");
        } catch (err) {
            expect((err as WorkflowError).exitCode).toBe(ExitCode.GitCommitError);
        }
    });
});

describe("maybeRecordHistory", () => {
    it("skips recording when shouldRecord is false", async () => {
        historyMock.appendHistory.mockClear();
        await maybeRecordHistory(baseOptions(), baseContext(), "feat: thing", false, false);
        expect(historyMock.appendHistory).not.toHaveBeenCalled();
    });

    it("skips recording when ci is true", async () => {
        historyMock.appendHistory.mockClear();
        await maybeRecordHistory(baseOptions({ ci: true }), baseContext(), "feat: thing", false, true);
        expect(historyMock.appendHistory).not.toHaveBeenCalled();
    });

    it("skips recording when historyEnabled is false", async () => {
        historyMock.appendHistory.mockClear();
        await maybeRecordHistory(baseOptions({ historyEnabled: false }), baseContext(), "feat: thing", false, true);
        expect(historyMock.appendHistory).not.toHaveBeenCalled();
    });

    it("skips recording when historyPath is null", async () => {
        historyMock.appendHistory.mockClear();
        await maybeRecordHistory(baseOptions(), baseContext({ historyPath: null }), "feat: thing", false, true);
        expect(historyMock.appendHistory).not.toHaveBeenCalled();
    });

    it("records history when all conditions are met", async () => {
        historyMock.appendHistory.mockResolvedValueOnce(undefined);
        await maybeRecordHistory(baseOptions(), baseContext(), "feat(api): add thing", false, true);
        expect(historyMock.appendHistory).toHaveBeenCalledWith(
            "/repo/.git/commitgen/history.jsonl",
            expect.objectContaining({ message: "feat(api): add thing", edited: false })
        );
    });
});

describe("getAlternatives", () => {
    it("returns an empty array when there is only one candidate", () => {
        expect(getAlternatives([makeCandidate()])).toEqual([]);
    });

    it("returns messages of all candidates except the first", () => {
        const candidates = [
            makeCandidate({ message: "feat: first" }),
            makeCandidate({ message: "fix: second" }),
            makeCandidate({ message: "chore: third" })
        ];
        expect(getAlternatives(candidates)).toEqual(["fix: second", "chore: third"]);
    });

    it("returns an empty array for an empty input", () => {
        expect(getAlternatives([])).toEqual([]);
    });
});
