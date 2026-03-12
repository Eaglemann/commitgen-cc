import { DEFAULT_RETRIES, DEFAULT_TIMEOUT_MS } from "./config.js";
import { parseBoundedInteger } from "./util.js";
import type { WorkflowOptions } from "./workflow.js";

export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 300000;
export const MIN_RETRIES = 0;
export const MAX_RETRIES = 5;

export function readEnv(name: string): string | null {
    const value = process.env[name]?.trim();
    return value && value.length > 0 ? value : null;
}

export function buildDefaultWorkflowOptions(overrides: Partial<WorkflowOptions> = {}): WorkflowOptions {
    return {
        model: readEnv("GIT_AI_MODEL"),
        host: readEnv("GIT_AI_HOST"),
        maxChars: null,
        type: null,
        scope: null,
        dryRun: false,
        noVerify: false,
        ci: false,
        allowInvalid: false,
        explain: false,
        timeoutMs: parseBoundedInteger(
            readEnv("GIT_AI_TIMEOUT_MS") ?? String(DEFAULT_TIMEOUT_MS),
            "--timeout-ms",
            MIN_TIMEOUT_MS,
            MAX_TIMEOUT_MS
        ),
        retries: parseBoundedInteger(
            readEnv("GIT_AI_RETRIES") ?? String(DEFAULT_RETRIES),
            "--retries",
            MIN_RETRIES,
            MAX_RETRIES
        ),
        output: "text",
        configPath: null,
        candidates: null,
        ticket: null,
        history: null,
        ...overrides
    };
}
