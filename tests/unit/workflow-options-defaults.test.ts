import { describe, expect, it } from "vitest";
import {
    buildDefaultWorkflowOptions,
    MAX_RETRIES,
    MAX_TIMEOUT_MS,
    MIN_RETRIES,
    MIN_TIMEOUT_MS,
    readEnv
} from "../../src/workflow-options.js";

describe("readEnv", () => {
    it("returns null when the env var is not set", () => {
        delete process.env.TEST_COMMITGEN_ABSENT;
        expect(readEnv("TEST_COMMITGEN_ABSENT")).toBeNull();
    });

    it("returns the trimmed value when the env var is set", () => {
        process.env.TEST_COMMITGEN_VAL = "  llama3  ";
        expect(readEnv("TEST_COMMITGEN_VAL")).toBe("llama3");
        delete process.env.TEST_COMMITGEN_VAL;
    });

    it("returns null when the env var is whitespace only", () => {
        process.env.TEST_COMMITGEN_BLANK = "   ";
        expect(readEnv("TEST_COMMITGEN_BLANK")).toBeNull();
        delete process.env.TEST_COMMITGEN_BLANK;
    });
});

describe("buildDefaultWorkflowOptions", () => {
    it("returns an object with the expected default shape", () => {
        const opts = buildDefaultWorkflowOptions();
        expect(opts.dryRun).toBe(false);
        expect(opts.ci).toBe(false);
        expect(opts.noVerify).toBe(false);
        expect(opts.allowInvalid).toBe(false);
        expect(opts.explain).toBe(false);
        expect(opts.output).toBe("text");
        expect(opts.configPath).toBeNull();
        expect(opts.candidates).toBeNull();
        expect(opts.ticket).toBeNull();
        expect(opts.history).toBeNull();
    });

    it("accepts overrides that take precedence over defaults", () => {
        const opts = buildDefaultWorkflowOptions({ dryRun: true, ci: true, candidates: 3 });
        expect(opts.dryRun).toBe(true);
        expect(opts.ci).toBe(true);
        expect(opts.candidates).toBe(3);
    });

    it("timeoutMs is within the valid range", () => {
        const opts = buildDefaultWorkflowOptions();
        expect(opts.timeoutMs).toBeGreaterThanOrEqual(MIN_TIMEOUT_MS);
        expect(opts.timeoutMs).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
    });

    it("retries is within the valid range", () => {
        const opts = buildDefaultWorkflowOptions();
        expect(opts.retries).toBeGreaterThanOrEqual(MIN_RETRIES);
        expect(opts.retries).toBeLessThanOrEqual(MAX_RETRIES);
    });

    it("reads GIT_AI_MODEL from the environment when set", () => {
        process.env.GIT_AI_MODEL = "mistral";
        const opts = buildDefaultWorkflowOptions();
        expect(opts.model).toBe("mistral");
        delete process.env.GIT_AI_MODEL;
    });

    it("returns null for model when GIT_AI_MODEL is not set", () => {
        delete process.env.GIT_AI_MODEL;
        const opts = buildDefaultWorkflowOptions();
        expect(opts.model).toBeNull();
    });
});
