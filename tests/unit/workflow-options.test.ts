import { describe, expect, it } from "vitest";
import { resolveWorkflowOptions, type WorkflowOptions } from "../../src/workflow.js";

function baseOptions(overrides: Partial<WorkflowOptions> = {}): WorkflowOptions {
    return {
        model: null,
        host: null,
        maxChars: null,
        type: null,
        scope: null,
        dryRun: false,
        noVerify: false,
        ci: false,
        allowInvalid: false,
        timeoutMs: 60000,
        retries: 2,
        output: "text",
        configPath: null,
        candidates: null,
        ticket: null,
        history: null,
        ...overrides
    };
}

describe("resolveWorkflowOptions", () => {
    it("applies CLI values ahead of repo config", () => {
        const resolved = resolveWorkflowOptions(baseOptions({
            model: "cli-model",
            candidates: 5
        }), {
            model: "repo-model",
            host: "http://repo-host",
            maxChars: 9000,
            interactiveCandidates: 4
        });

        expect(resolved.model).toBe("cli-model");
        expect(resolved.host).toBe("http://repo-host");
        expect(resolved.maxChars).toBe(9000);
        expect(resolved.candidates).toBe(5);
    });

    it("uses repo defaults for interactive candidates and history when CLI does not override them", () => {
        const resolved = resolveWorkflowOptions(baseOptions(), {
            historyEnabled: false,
            historySampleSize: 3,
            interactiveCandidates: 4
        });

        expect(resolved.historyEnabled).toBe(false);
        expect(resolved.historySampleSize).toBe(3);
        expect(resolved.candidates).toBe(4);
    });

    it("forces non-interactive runs to a single candidate unless explicitly overridden", () => {
        const resolved = resolveWorkflowOptions(baseOptions({
            ci: true
        }), {
            interactiveCandidates: 4
        });

        expect(resolved.candidates).toBe(1);
    });
});
