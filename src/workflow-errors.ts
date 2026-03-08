import { ExitCode, EXIT_CODE_LABEL } from "./exit-codes.js";

export class WorkflowError extends Error {
    exitCode: Exclude<ExitCode, ExitCode.Success>;
    code: string;
    hint: string | null;

    constructor(
        exitCode: Exclude<ExitCode, ExitCode.Success>,
        message: string,
        opts?: { code?: string; hint?: string }
    ) {
        super(message);
        this.name = "WorkflowError";
        this.exitCode = exitCode;
        this.code = opts?.code ?? EXIT_CODE_LABEL[exitCode];
        this.hint = opts?.hint ?? null;
    }
}

export function ensureBoundedNumber(
    value: number,
    name: string,
    min: number,
    max: number
): number {
    if (!Number.isInteger(value)) {
        throw new WorkflowError(ExitCode.UsageError, `${name} must be an integer.`);
    }

    if (value < min || value > max) {
        throw new WorkflowError(ExitCode.UsageError, `${name} must be between ${min} and ${max}.`);
    }

    return value;
}

export function ensureNonEmptyString(value: string | null | undefined, name: string): string {
    const normalized = value?.trim();
    if (!normalized) {
        throw new WorkflowError(ExitCode.UsageError, `${name} must be a non-empty string.`);
    }
    return normalized;
}
