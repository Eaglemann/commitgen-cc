import { describe, expect, it } from "vitest";
import { resolveCommitPolicy } from "../../src/policy.js";
import { buildMessages } from "../../src/prompt.js";

describe("buildMessages", () => {
    it("includes forced type and scope constraints when provided", () => {
        const messages = buildMessages({
            diff: "diff --git a/src/a.ts b/src/a.ts",
            files: Array.from({ length: 12 }, (_, index) => `src/file-${index + 1}.ts`),
            branch: "feature/ABC-123-parser",
            suggestedScope: "src",
            ticket: "ABC-123",
            recentExamples: [
                "feat(src): add parser",
                "fix(src): tighten checks",
                "docs: update usage",
                "refactor(src): simplify flow"
            ],
            forcedType: "fix",
            forcedScope: "api",
            knownScopes: ["api", "cli"],
            candidateCount: 3,
            policy: resolveCommitPolicy({
                requiredScopes: ["api", "cli"],
                bodyRequiredTypes: ["feat"]
            })
        });

        expect(messages).toHaveLength(2);
        expect(messages[1].content).toContain("Forced type: fix");
        expect(messages[1].content).toContain("Forced scope: api");
        expect(messages[1].content).toContain("Associated ticket: ABC-123");
        expect(messages[1].content).toContain("Branch: feature/ABC-123-parser");
        expect(messages[1].content).toContain("Preferred scopes: api, cli");
        expect(messages[1].content).toContain("Scope is required and must be one of: api, cli.");
        expect(messages[1].content).toContain("Add a short body when the type is: feat.");
        expect(messages[1].content).toContain("Recent accepted commit examples");
        expect(messages[1].content).toContain('Return exactly 3 messages.');
        expect(messages[1].content).toContain("Changed files (showing 10 of 12):");
        expect(messages[1].content).not.toContain("src/file-11.ts");
        expect(messages[1].content).not.toContain("refactor(src): simplify flow");
    });

    it("includes default constraints when type and scope are not provided", () => {
        const messages = buildMessages({
            diff: "diff --git a/src/a.ts b/src/a.ts",
            files: ["src/a.ts", "src/b.ts"],
            branch: null,
            suggestedScope: null,
            ticket: null,
            recentExamples: [],
            forcedType: null,
            forcedScope: null,
            policy: resolveCommitPolicy({})
        });

        expect(messages[1].content).toContain("Choose the best type from: feat, fix, chore, refactor, docs, test, perf, build, ci.");
        expect(messages[1].content).toContain("Use a scope only if it helps; otherwise omit.");
        expect(messages[1].content).toContain("No explicit ticket was provided.");
        expect(messages[1].content).toContain("Changed files:");
    });

    it("includes revision context when revising an existing message", () => {
        const messages = buildMessages({
            diff: "diff --git a/src/a.ts b/src/a.ts",
            files: ["src/a.ts"],
            branch: "feature/ABC-123-parser",
            suggestedScope: "src",
            ticket: "ABC-123",
            recentExamples: [],
            forcedType: null,
            forcedScope: null,
            policy: resolveCommitPolicy({}),
            revisionRequest: {
                currentMessage: "feat(src): add baseline",
                feedback: "make it shorter"
            }
        });

        expect(messages[1].content).toContain("Revise the existing commit message");
        expect(messages[1].content).toContain("Current Message:");
        expect(messages[1].content).toContain("feat(src): add baseline");
        expect(messages[1].content).toContain("Revision Feedback:");
        expect(messages[1].content).toContain("make it shorter");
    });
});
