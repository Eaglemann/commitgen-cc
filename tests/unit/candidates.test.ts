import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoContext, ResolvedWorkflowOptions } from "../../src/workflow.js";
import { resolveCommitPolicy } from "../../src/policy.js";

const ollamaMock = {
    ollamaChat: vi.fn()
};

vi.mock("../../src/ollama.js", () => ({
    ollamaChat: ollamaMock.ollamaChat
}));

const { reviseCandidate } = await import("../../src/candidates.js");

function baseContext(overrides: Partial<RepoContext> = {}): RepoContext {
    return {
        gitDir: "/repo/.git",
        diff: "diff --git a/src/a.ts b/src/a.ts\n+const x = 1;",
        files: ["src/a.ts"],
        branch: "feature/ABC-123-add-baseline",
        suggestedScope: "src",
        effectiveScope: "src",
        ticket: null,
        recentExamples: [],
        expectedType: "feat",
        historyPath: null,
        ...overrides
    };
}

function baseOptions(overrides: Partial<ResolvedWorkflowOptions> = {}): ResolvedWorkflowOptions {
    return {
        model: "gpt-oss:120b-cloud",
        host: "http://localhost:11434",
        maxChars: 16000,
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
        historyEnabled: false,
        historySampleSize: 5,
        ticketPattern: "([A-Z][A-Z0-9]+-\\d+)",
        defaultScope: null,
        knownScopes: [],
        policy: resolveCommitPolicy({}),
        ...overrides
    };
}

describe("reviseCandidate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("keeps the current required scope when the revised output omits it", async () => {
        ollamaMock.ollamaChat.mockResolvedValue("{\"message\":\"fix: tighten parser flow\"}");

        const result = await reviseCandidate(
            baseContext({
                effectiveScope: null
            }),
            baseOptions({
                policy: resolveCommitPolicy({
                    requiredScopes: ["api"]
                })
            }),
            "feat(api): add baseline",
            "make it shorter"
        );

        expect(result.message).toBe("fix(api): tighten parser flow");
    });

    it("uses the context scope and inferred ticket when policy requires them", async () => {
        ollamaMock.ollamaChat.mockResolvedValue("{\"message\":\"fix: tighten parser flow\"}");

        const result = await reviseCandidate(
            baseContext({
                effectiveScope: "cli",
                ticket: "ABC-123"
            }),
            baseOptions({
                policy: resolveCommitPolicy({
                    requiredScopes: ["cli"],
                    requireTicket: true
                })
            }),
            "feat: add baseline",
            "make it shorter"
        );

        expect(result.message).toBe("fix(cli): tighten parser flow\n\nRefs ABC-123");
    });

    it("keeps a revised scope when it already satisfies the required scope policy", async () => {
        ollamaMock.ollamaChat.mockResolvedValue("{\"message\":\"fix(docs): tighten parser flow\"}");

        const result = await reviseCandidate(
            baseContext({
                effectiveScope: "cli"
            }),
            baseOptions({
                policy: resolveCommitPolicy({
                    requiredScopes: ["docs", "cli"]
                })
            }),
            "feat(cli): add baseline",
            "change the scope to docs"
        );

        expect(result.message).toBe("fix(docs): tighten parser flow");
    });
});
