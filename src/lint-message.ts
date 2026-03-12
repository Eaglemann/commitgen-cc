import { readFile } from "node:fs/promises";
import { ExitCode, EXIT_CODE_LABEL } from "./exit-codes.js";
import { loadRepoConfig } from "./config.js";
import { getRepoRoot, isGitRepo } from "./git.js";
import { lintCommitMessage, resolveCommitPolicy } from "./policy.js";
import { normalizeErrorMessage } from "./util.js";
import { WorkflowError } from "./workflow-errors.js";

export type LintMessageSuccess = {
    ok: true;
    exitCode: ExitCode.Success;
    message: string;
    subject: string;
    type: string | null;
    scope: string | null;
    ticket: string | null;
};

export type LintMessageError = {
    ok: false;
    exitCode: Exclude<ExitCode, ExitCode.Success>;
    code: string;
    message: string;
    errors: string[];
};

export type LintMessageCommandResult = LintMessageSuccess | LintMessageError;

function toErrorResult(error: unknown, fallbackCode: Exclude<ExitCode, ExitCode.Success>): LintMessageError {
    if (error instanceof WorkflowError) {
        return {
            ok: false,
            exitCode: error.exitCode,
            code: error.code,
            message: error.message,
            errors: [error.message]
        };
    }

    const message = normalizeErrorMessage(error, "Failed to lint commit message.");
    return {
        ok: false,
        exitCode: fallbackCode,
        code: EXIT_CODE_LABEL[fallbackCode],
        message,
        errors: [message]
    };
}

export function stripCommentLines(message: string): string {
    return message
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"))
        .join("\n");
}

async function readCommitMessageFile(filePath: string): Promise<string> {
    try {
        const raw = await readFile(filePath, "utf8");
        return stripCommentLines(raw);
    } catch (error: unknown) {
        throw new WorkflowError(
            ExitCode.UsageError,
            `Failed to read commit message file "${filePath}": ${normalizeErrorMessage(error, "Unknown error.")}`
        );
    }
}

export async function lintMessageFile(
    filePath: string,
    configPath: string | null
): Promise<LintMessageCommandResult> {
    try {
        if (!(await isGitRepo())) {
            throw new WorkflowError(ExitCode.GitContextError, "Not a git repository.");
        }

        const repoRoot = await getRepoRoot();
        const repoConfig = await loadRepoConfig(repoRoot, configPath);
        const policy = resolveCommitPolicy(repoConfig);
        const message = await readCommitMessageFile(filePath);
        const lintResult = lintCommitMessage(message, policy, repoConfig.ticketPattern ?? "([A-Z][A-Z0-9]+-\\d+)");

        if (!lintResult.ok) {
            return {
                ok: false,
                exitCode: ExitCode.InvalidAiOutput,
                code: EXIT_CODE_LABEL[ExitCode.InvalidAiOutput],
                message: "Commit message failed validation.",
                errors: lintResult.errors
            };
        }

        return {
            ok: true,
            exitCode: ExitCode.Success,
            message: lintResult.normalizedMessage,
            subject: lintResult.subject,
            type: lintResult.parsedSubject?.type ?? null,
            scope: lintResult.parsedSubject?.scope ?? null,
            ticket: lintResult.ticket
        };
    } catch (error: unknown) {
        return toErrorResult(error, ExitCode.UsageError);
    }
}
