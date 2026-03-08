import { describe, expect, it } from "vitest";
import { lintCommitMessage, resolveCommitPolicy } from "../../src/policy.js";

describe("lintCommitMessage", () => {
    it("requires a ticket when configured", () => {
        const policy = resolveCommitPolicy({
            requireTicket: true
        });

        const result = lintCommitMessage("feat(cli): add hook installer", policy, "([A-Z][A-Z0-9]+-\\d+)");

        expect(result.ok).toBe(false);
        expect(result.errors).toContain("Message must reference a ticket.");
    });

    it("requires a scope from the configured allowlist", () => {
        const policy = resolveCommitPolicy({
            requiredScopes: ["cli", "hooks"]
        });

        const result = lintCommitMessage("feat(api): add hook installer", policy, "([A-Z][A-Z0-9]+-\\d+)");

        expect(result.ok).toBe(false);
        expect(result.errors).toContain("Scope must be one of: cli, hooks.");
    });

    it("requires a body for configured types", () => {
        const policy = resolveCommitPolicy({
            bodyRequiredTypes: ["feat"]
        });

        const result = lintCommitMessage("feat(cli): add hook installer", policy, "([A-Z][A-Z0-9]+-\\d+)");

        expect(result.ok).toBe(false);
        expect(result.errors).toContain('Type "feat" requires a commit body.');
    });

    it("honors a custom subject length limit", () => {
        const policy = resolveCommitPolicy({
            subjectMaxLength: 20
        });

        const result = lintCommitMessage("feat(cli): add local hook installation flow", policy, "([A-Z][A-Z0-9]+-\\d+)");

        expect(result.ok).toBe(false);
        expect(result.errors[0]).toContain("Subject line > 20 chars");
    });
});
