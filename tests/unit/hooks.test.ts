import { describe, expect, it } from "vitest";
import { buildHookScript, formatHookError, quoteShell, shouldSkipPrepareHook } from "../../src/hooks.js";

describe("quoteShell", () => {
    it("wraps a simple value in single quotes", () => {
        expect(quoteShell("/usr/bin/node")).toBe("'/usr/bin/node'");
    });

    it("escapes embedded single quotes", () => {
        expect(quoteShell("it's")).toBe("'it'\"'\"'s'");
    });

    it("handles a path with spaces", () => {
        expect(quoteShell("/path with spaces/node")).toBe("'/path with spaces/node'");
    });

    it("handles an empty string", () => {
        expect(quoteShell("")).toBe("''");
    });
});

describe("buildHookScript", () => {
    const nodePath = "/usr/bin/node";
    const cliPath = "/home/user/.npm/bin/commitgen-cc";

    it("includes the managed marker", () => {
        const script = buildHookScript("prepare-commit-msg", nodePath, cliPath, null);
        expect(script).toContain("# commitgen-cc managed hook");
    });

    it("includes the hook name in the exec line", () => {
        const script = buildHookScript("prepare-commit-msg", nodePath, cliPath, null);
        expect(script).toContain("__internal-hook prepare-commit-msg");
    });

    it("includes the node and cli paths (quoted)", () => {
        const script = buildHookScript("commit-msg", nodePath, cliPath, null);
        expect(script).toContain(quoteShell(nodePath));
        expect(script).toContain(quoteShell(cliPath));
    });

    it("omits config export when configPath is null", () => {
        const script = buildHookScript("prepare-commit-msg", nodePath, cliPath, null);
        expect(script).not.toContain("COMMITGEN_CONFIG_PATH");
    });

    it("includes config export when configPath is provided", () => {
        const script = buildHookScript("commit-msg", nodePath, cliPath, "/repo/.commitgen.json");
        expect(script).toContain("COMMITGEN_CONFIG_PATH=");
        expect(script).toContain(quoteShell("/repo/.commitgen.json"));
    });

    it("starts with a shebang", () => {
        const script = buildHookScript("prepare-commit-msg", nodePath, cliPath, null);
        expect(script.startsWith("#!/bin/sh")).toBe(true);
    });
});

describe("shouldSkipPrepareHook", () => {
    it("returns false for undefined source", () => {
        expect(shouldSkipPrepareHook(undefined)).toBe(false);
    });

    it("returns true for 'message' source", () => {
        expect(shouldSkipPrepareHook("message")).toBe(true);
    });

    it("returns true for 'template' source", () => {
        expect(shouldSkipPrepareHook("template")).toBe(true);
    });

    it("returns true for 'merge' source", () => {
        expect(shouldSkipPrepareHook("merge")).toBe(true);
    });

    it("returns true for 'squash' source", () => {
        expect(shouldSkipPrepareHook("squash")).toBe(true);
    });

    it("returns true for 'commit' source", () => {
        expect(shouldSkipPrepareHook("commit")).toBe(true);
    });

    it("returns false for an unknown source string", () => {
        expect(shouldSkipPrepareHook("interactive")).toBe(false);
    });

    it("returns false for an empty string", () => {
        expect(shouldSkipPrepareHook("")).toBe(false);
    });
});

describe("formatHookError", () => {
    it("formats an Error instance", () => {
        const result = formatHookError(new Error("something went wrong"));
        expect(result).toContain("something went wrong");
    });

    it("formats a non-Error value", () => {
        const result = formatHookError("plain string error");
        expect(result).toContain("plain string error");
    });

    it("returns a fallback for null", () => {
        const result = formatHookError(null);
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
    });
});
