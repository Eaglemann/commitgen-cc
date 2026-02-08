import { describe, expect, it } from "vitest";
import { clampDiff, parseBoundedInteger } from "../../src/util.js";

describe("clampDiff", () => {
    it("returns original diff when below limit", () => {
        const diff = "diff --git a/file.ts b/file.ts\n+const a = 1;";
        expect(clampDiff(diff, 1000)).toBe(diff);
    });

    it("truncates large diff within requested size", () => {
        const largeDiff = `diff --git a/a.ts b/a.ts\n${"x".repeat(4000)}`;
        const limited = clampDiff(largeDiff, 500);
        expect(limited.length).toBeLessThanOrEqual(500);
        expect(limited).toContain("--- DIFF TRUNCATED ---");
    });

    it("handles very small max chars safely", () => {
        const text = "abcdefghijklmnopqrstuvwxyz";
        expect(clampDiff(text, 10)).toBe("abcdefghij");
    });
});

describe("parseBoundedInteger", () => {
    it("parses a valid integer in range", () => {
        expect(parseBoundedInteger("42", "--timeout-ms", 10, 100)).toBe(42);
    });

    it("throws for non-numeric values", () => {
        expect(() => parseBoundedInteger("abc", "--timeout-ms", 10, 100)).toThrow("--timeout-ms must be a number.");
    });

    it("throws for out-of-range values", () => {
        expect(() => parseBoundedInteger("9", "--timeout-ms", 10, 100)).toThrow("--timeout-ms must be between 10 and 100.");
    });
});
