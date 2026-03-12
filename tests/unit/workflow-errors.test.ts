import { describe, expect, it } from "vitest";
import { ExitCode } from "../../src/exit-codes.js";
import { ensureBoundedNumber, ensureNonEmptyString, WorkflowError } from "../../src/workflow-errors.js";

describe("WorkflowError", () => {
    it("sets exitCode, code, and message", () => {
        const err = new WorkflowError(ExitCode.UsageError, "bad input");
        expect(err.exitCode).toBe(ExitCode.UsageError);
        expect(err.code).toBe("USAGE_ERROR");
        expect(err.message).toBe("bad input");
        expect(err.hint).toBeNull();
        expect(err.name).toBe("WorkflowError");
        expect(err).toBeInstanceOf(Error);
    });

    it("accepts a hint", () => {
        const err = new WorkflowError(ExitCode.GitContextError, "msg", { hint: "fix it" });
        expect(err.hint).toBe("fix it");
    });

    it("allows a custom code override", () => {
        const err = new WorkflowError(ExitCode.InternalError, "msg", { code: "MY_CODE" });
        expect(err.code).toBe("MY_CODE");
    });
});

describe("ensureBoundedNumber", () => {
    it("returns the value when it is within bounds", () => {
        expect(ensureBoundedNumber(5, "x", 1, 10)).toBe(5);
    });

    it("returns the value at the lower bound", () => {
        expect(ensureBoundedNumber(1, "x", 1, 10)).toBe(1);
    });

    it("returns the value at the upper bound", () => {
        expect(ensureBoundedNumber(10, "x", 1, 10)).toBe(10);
    });

    it("throws when the value is below the minimum", () => {
        expect(() => ensureBoundedNumber(0, "count", 1, 10)).toThrow("between 1 and 10");
    });

    it("throws when the value exceeds the maximum", () => {
        expect(() => ensureBoundedNumber(11, "count", 1, 10)).toThrow("between 1 and 10");
    });

    it("throws when the value is not an integer", () => {
        expect(() => ensureBoundedNumber(1.5, "count", 1, 10)).toThrow("integer");
    });

    it("throws a WorkflowError with UsageError exit code", () => {
        try {
            ensureBoundedNumber(0, "n", 1, 10);
            expect.fail("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(WorkflowError);
            expect((err as WorkflowError).exitCode).toBe(ExitCode.UsageError);
        }
    });
});

describe("ensureNonEmptyString", () => {
    it("returns the trimmed value when non-empty", () => {
        expect(ensureNonEmptyString("  hello  ", "field")).toBe("hello");
    });

    it("throws when the value is an empty string", () => {
        expect(() => ensureNonEmptyString("", "field")).toThrow("non-empty string");
    });

    it("throws when the value is whitespace only", () => {
        expect(() => ensureNonEmptyString("   ", "field")).toThrow("non-empty string");
    });

    it("throws when the value is null", () => {
        expect(() => ensureNonEmptyString(null, "field")).toThrow("non-empty string");
    });

    it("throws when the value is undefined", () => {
        expect(() => ensureNonEmptyString(undefined, "field")).toThrow("non-empty string");
    });

    it("throws a WorkflowError with UsageError exit code", () => {
        try {
            ensureNonEmptyString("", "name");
            expect.fail("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(WorkflowError);
            expect((err as WorkflowError).exitCode).toBe(ExitCode.UsageError);
        }
    });
});
