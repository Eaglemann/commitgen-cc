import { describe, expect, it } from "vitest";
import {
    extractMessageFromModelOutput,
    inferTypeFromDiff,
    repairMessage,
    validateMessage
} from "../../src/validation.js";

describe("validateMessage", () => {
    it("accepts valid multiline conventional commits", () => {
        const message = "feat(api): add health endpoint\n\nAdd endpoint for readiness probes.";
        expect(validateMessage(message)).toEqual({ ok: true });
    });

    it("rejects long subject lines", () => {
        const message = `feat: ${"x".repeat(80)}`;
        const result = validateMessage(message);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain("Subject line > 72 chars");
    });

    it("rejects markdown code fences", () => {
        const result = validateMessage("feat: add output\n\n```json\n{}\n```");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain("No markdown/code fences");
    });
});

describe("extractMessageFromModelOutput", () => {
    it("extracts message from strict json output", () => {
        const raw = "{\"message\":\"fix: handle null response\"}";
        expect(extractMessageFromModelOutput(raw)).toBe("fix: handle null response");
    });

    it("extracts message from fenced json output", () => {
        const raw = "```json\n{\"message\":\"docs: update readme\"}\n```";
        expect(extractMessageFromModelOutput(raw)).toBe("docs: update readme");
    });

    it("extracts message from embedded json", () => {
        const raw = "some prefix {\"message\":\"fix: handle crash\"} trailing text";
        expect(extractMessageFromModelOutput(raw)).toBe("fix: handle crash");
    });

    it("falls back to plain text when json shape is invalid", () => {
        const raw = "{\"message\":123}";
        expect(extractMessageFromModelOutput(raw)).toBe("{\"message\":123}");
    });
});

describe("repairMessage", () => {
    it("adds a safe inferred docs type when all changed files are documentation", () => {
        const repaired = repairMessage({
            message: "update readme content.",
            diff: "diff --git a/README.md b/README.md\nindex 1..2 100644",
            forcedType: null,
            scope: null
        });

        expect(repaired.message).toBe("docs: update readme content");
    });

    it("applies forced type and scope", () => {
        const repaired = repairMessage({
            message: "fix parser edge case.",
            diff: "diff --git a/src/parser.ts b/src/parser.ts",
            forcedType: "refactor",
            scope: "core api"
        });

        expect(repaired.message).toBe("refactor(core-api): fix parser edge case");
    });

    it("normalizes loose typed subjects", () => {
        const repaired = repairMessage({
            message: "FEAT - add retries.",
            diff: "diff --git a/src/retries.ts b/src/retries.ts",
            forcedType: null,
            scope: null
        });

        expect(repaired.message).toBe("feat: add retries");
    });
});

describe("inferTypeFromDiff", () => {
    it("returns null for mixed unrelated files", () => {
        const diff = [
            "diff --git a/src/a.ts b/src/a.ts",
            "diff --git a/README.md b/README.md"
        ].join("\n");

        expect(inferTypeFromDiff(diff)).toBeNull();
    });

    it("detects test changes", () => {
        const diff = "diff --git a/tests/a.test.ts b/tests/a.test.ts";
        expect(inferTypeFromDiff(diff)).toBe("test");
    });

    it("detects ci changes", () => {
        const diff = "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml";
        expect(inferTypeFromDiff(diff)).toBe("ci");
    });

    it("detects build changes", () => {
        const diff = "diff --git a/package-lock.json b/package-lock.json";
        expect(inferTypeFromDiff(diff)).toBe("build");
    });
});
