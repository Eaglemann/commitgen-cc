import prompts from "prompts";
import { ExitCode, EXIT_CODE_LABEL } from "./exit-codes.js";
import { getStagedDiff, gitCommit, hasStagedChanges, isGitRepo } from "./git.js";
import { ensureLocalModel, ollamaChat, OllamaError } from "./ollama.js";
import { buildMessages } from "./prompt.js";
import { clampDiff, normalizeErrorMessage } from "./util.js";
import {
    type AllowedType,
    extractMessageFromModelOutput,
    normalizeMessage,
    repairMessage,
    validateMessage
} from "./validation.js";

export type OutputFormat = "text" | "json";
export type MessageSource = "model" | "repaired";

export type WorkflowOptions = {
    model: string;
    host: string;
    maxChars: number;
    type: AllowedType | null;
    scope: string | null;
    dryRun: boolean;
    noVerify: boolean;
    ci: boolean;
    allowInvalid: boolean;
    timeoutMs: number;
    retries: number;
    output: OutputFormat;
};

type SuccessResult = {
    ok: true;
    exitCode: ExitCode.Success;
    message: string;
    source: MessageSource;
    committed: boolean;
    cancelled: boolean;
};

type ErrorResult = {
    ok: false;
    exitCode: Exclude<ExitCode, ExitCode.Success>;
    code: string;
    message: string;
    hint: string | null;
};

export type WorkflowResult = SuccessResult | ErrorResult;

class WorkflowError extends Error {
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

type Candidate = {
    message: string;
    source: MessageSource;
    validation: ReturnType<typeof validateMessage>;
};

async function generateCandidate(diff: string, opts: WorkflowOptions): Promise<Candidate> {
    const messages = buildMessages({
        diff,
        forcedType: opts.type,
        scope: opts.scope
    });

    const raw = (await ollamaChat({
        host: opts.host,
        model: opts.model,
        messages,
        json: true,
        timeoutMs: opts.timeoutMs,
        retries: opts.retries
    })).trim();

    const extracted = extractMessageFromModelOutput(raw);
    const repaired = repairMessage({
        message: extracted,
        diff,
        forcedType: opts.type,
        scope: opts.scope
    });
    const candidate = normalizeMessage(repaired.message);
    return {
        message: candidate,
        source: repaired.didRepair ? "repaired" : "model",
        validation: validateMessage(candidate)
    };
}

function ensureValid(candidate: Candidate, allowInvalid: boolean): void {
    if (candidate.validation.ok || allowInvalid) return;
    throw new WorkflowError(
        ExitCode.InvalidAiOutput,
        `AI output failed validation: ${candidate.validation.reason}`,
        {
            hint: "Regenerate/edit the message or pass --allow-invalid to override."
        }
    );
}

function toErrorResult(error: unknown): ErrorResult {
    if (error instanceof WorkflowError) {
        return {
            ok: false,
            exitCode: error.exitCode,
            code: error.code,
            message: error.message,
            hint: error.hint
        };
    }

    if (error instanceof OllamaError) {
        return {
            ok: false,
            exitCode: ExitCode.OllamaError,
            code: EXIT_CODE_LABEL[ExitCode.OllamaError],
            message: error.message,
            hint: error.hint
        };
    }

    return {
        ok: false,
        exitCode: ExitCode.InternalError,
        code: EXIT_CODE_LABEL[ExitCode.InternalError],
        message: normalizeErrorMessage(error, "Unexpected internal error."),
        hint: null
    };
}

async function commitMessage(message: string, noVerify: boolean): Promise<void> {
    try {
        await gitCommit(message, { noVerify });
    } catch (error: unknown) {
        throw new WorkflowError(
            ExitCode.GitCommitError,
            normalizeErrorMessage(error, "git commit failed."),
            { hint: "Resolve git hook or repository errors, then retry." }
        );
    }
}

async function runNonInteractive(diff: string, opts: WorkflowOptions): Promise<SuccessResult> {
    const candidate = await generateCandidate(diff, opts);
    ensureValid(candidate, opts.allowInvalid);

    if (opts.dryRun) {
        return {
            ok: true,
            exitCode: ExitCode.Success,
            message: candidate.message,
            source: candidate.source,
            committed: false,
            cancelled: false
        };
    }

    await commitMessage(candidate.message, opts.noVerify);
    return {
        ok: true,
        exitCode: ExitCode.Success,
        message: candidate.message,
        source: candidate.source,
        committed: true,
        cancelled: false
    };
}

async function runInteractive(diff: string, opts: WorkflowOptions): Promise<SuccessResult> {
    while (true) {
        process.stdout.write("Generating commit message... ");

        const candidate = await generateCandidate(diff, opts);
        process.stdout.write("Done.\n");

        if (!candidate.validation.ok) {
            console.warn(`AI output validation failed: ${candidate.validation.reason}`);
        }

        console.log("\n--- Suggested commit message ---\n");
        console.log(candidate.message);
        console.log("\n-------------------------------\n");

        const response = await prompts({
            type: "select",
            name: "action",
            message: "What next?",
            choices: [
                { title: "Accept and commit", value: "accept" },
                { title: "Edit", value: "edit" },
                { title: "Regenerate", value: "regen" },
                { title: "Dry-run (print only)", value: "dry" },
                { title: "Cancel", value: "cancel" }
            ],
            initial: 0
        });

        const action = response.action as "accept" | "edit" | "regen" | "dry" | "cancel" | undefined;
        if (!action || action === "cancel") {
            return {
                ok: true,
                exitCode: ExitCode.Success,
                message: candidate.message,
                source: candidate.source,
                committed: false,
                cancelled: true
            };
        }

        if (action === "regen") continue;
        if (action === "dry") {
            return {
                ok: true,
                exitCode: ExitCode.Success,
                message: candidate.message,
                source: candidate.source,
                committed: false,
                cancelled: false
            };
        }

        let finalMessage = candidate.message;
        if (action === "edit") {
            const edited = await prompts({
                type: "text",
                name: "message",
                message: "Edit commit message",
                initial: finalMessage
            });

            const editedMessage = edited.message as string | undefined;
            if (!editedMessage) {
                return {
                    ok: true,
                    exitCode: ExitCode.Success,
                    message: candidate.message,
                    source: candidate.source,
                    committed: false,
                    cancelled: true
                };
            }
            finalMessage = normalizeMessage(editedMessage);
        }

        const validation = validateMessage(finalMessage);
        if (!validation.ok && !opts.allowInvalid) {
            console.error(`Cannot commit invalid message: ${validation.reason}`);
            console.error("Use Edit/Regenerate, or rerun with --allow-invalid to override.");
            continue;
        }

        await commitMessage(finalMessage, opts.noVerify);
        return {
            ok: true,
            exitCode: ExitCode.Success,
            message: finalMessage,
            source: finalMessage === candidate.message ? candidate.source : "repaired",
            committed: true,
            cancelled: false
        };
    }
}

export async function runWorkflow(opts: WorkflowOptions): Promise<WorkflowResult> {
    try {
        if (!(await isGitRepo())) {
            throw new WorkflowError(ExitCode.GitContextError, "Not a git repository.");
        }

        if (!(await hasStagedChanges())) {
            throw new WorkflowError(
                ExitCode.GitContextError,
                "No staged changes. Stage files first: git add <files>."
            );
        }

        await ensureLocalModel(opts.host, opts.model, Math.min(opts.timeoutMs, 10000));

        const stagedDiff = await getStagedDiff();
        const diff = clampDiff(stagedDiff, opts.maxChars);

        if (opts.ci || opts.dryRun) {
            return await runNonInteractive(diff, opts);
        }

        return await runInteractive(diff, opts);
    } catch (error: unknown) {
        return toErrorResult(error);
    }
}
