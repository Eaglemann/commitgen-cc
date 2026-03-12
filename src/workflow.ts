import {
    DEFAULT_HISTORY_ENABLED,
    DEFAULT_HISTORY_SAMPLE_SIZE,
    DEFAULT_HOST,
    DEFAULT_MAX_CHARS,
    DEFAULT_MODEL,
    DEFAULT_TICKET_PATTERN,
    loadRepoConfig,
    type RepoConfig
} from "./config.js";
import { buildWorkflowDiagnostics, type WorkflowDiagnostics } from "./diagnostics.js";
import { ExitCode, EXIT_CODE_LABEL } from "./exit-codes.js";
import { getGitDir, getRepoRoot, hasStagedChanges, isGitRepo } from "./git.js";
import { ensureLocalModel, OllamaError } from "./ollama.js";
import { buildSuccessResult, commitMessage, ensureValid, getAlternatives, maybeRecordHistory } from "./finalize.js";
import { resolveCommitPolicy, type CommitPolicy } from "./policy.js";
import { generateCandidates } from "./candidates.js";
import { loadRepoContext } from "./repo-context-loader.js";
import { normalizeErrorMessage, normalizeScopeName } from "./util.js";
import { type AllowedType } from "./validation.js";
import { ensureBoundedNumber, ensureNonEmptyString, WorkflowError } from "./workflow-errors.js";
import { runInteractive } from "./interactive.js";

export type OutputFormat = "text" | "json";
export type MessageSource = "model" | "repaired";

export const MIN_MAX_CHARS = 500;
export const MAX_MAX_CHARS = 200000;
export const MIN_CANDIDATES = 1;
export const MAX_CANDIDATES = 5;
const MIN_HISTORY_SAMPLE_SIZE = 1;
const MAX_HISTORY_SAMPLE_SIZE = 25;

export type WorkflowOptions = {
    model: string | null;
    host: string | null;
    maxChars: number | null;
    type: AllowedType | null;
    scope: string | null;
    dryRun: boolean;
    noVerify: boolean;
    ci: boolean;
    allowInvalid: boolean;
    explain: boolean;
    timeoutMs: number;
    retries: number;
    output: OutputFormat;
    configPath: string | null;
    candidates: number | null;
    ticket: string | null;
    history: boolean | null;
};

export type SuccessResult = {
    ok: true;
    exitCode: ExitCode.Success;
    message: string;
    source: MessageSource;
    committed: boolean;
    cancelled: boolean;
    scope: string | null;
    ticket: string | null;
    alternatives?: string[];
    diagnostics?: WorkflowDiagnostics;
};

export type ErrorResult = {
    ok: false;
    exitCode: Exclude<ExitCode, ExitCode.Success>;
    code: string;
    message: string;
    hint: string | null;
    diagnostics?: WorkflowDiagnostics;
};

export type WorkflowResult = SuccessResult | ErrorResult;

export type ResolvedWorkflowOptions = {
    model: string;
    host: string;
    maxChars: number;
    type: AllowedType | null;
    scope: string | null;
    dryRun: boolean;
    noVerify: boolean;
    ci: boolean;
    allowInvalid: boolean;
    explain: boolean;
    timeoutMs: number;
    retries: number;
    output: OutputFormat;
    candidates: number;
    ticket: string | null;
    historyEnabled: boolean;
    historySampleSize: number;
    ticketPattern: string;
    defaultScope: string | null;
    knownScopes: string[];
    policy: CommitPolicy;
};

export type RepoContext = {
    gitDir: string;
    diff: string;
    files: string[];
    branch: string | null;
    suggestedScope: string | null;
    effectiveScope: string | null;
    ticket: string | null;
    recentExamples: string[];
    expectedType: AllowedType | null;
    historyPath: string | null;
};

export function resolveWorkflowOptions(
    options: WorkflowOptions,
    repoConfig: RepoConfig
): ResolvedWorkflowOptions {
    const policy = resolveCommitPolicy(repoConfig);
    const requestedCandidates = options.candidates
        ?? 1;

    const historySampleSize = ensureBoundedNumber(
        repoConfig.historySampleSize ?? DEFAULT_HISTORY_SAMPLE_SIZE,
        "historySampleSize",
        MIN_HISTORY_SAMPLE_SIZE,
        MAX_HISTORY_SAMPLE_SIZE
    );

    return {
        model: ensureNonEmptyString(options.model ?? repoConfig.model ?? DEFAULT_MODEL, "--model"),
        host: ensureNonEmptyString(options.host ?? repoConfig.host ?? DEFAULT_HOST, "--host"),
        maxChars: ensureBoundedNumber(
            options.maxChars ?? repoConfig.maxChars ?? DEFAULT_MAX_CHARS,
            "--max-chars",
            MIN_MAX_CHARS,
            MAX_MAX_CHARS
        ),
        type: options.type,
        scope: normalizeScopeName(options.scope),
        dryRun: options.dryRun,
        noVerify: options.noVerify,
        ci: options.ci,
        allowInvalid: options.allowInvalid,
        explain: options.explain,
        timeoutMs: options.timeoutMs,
        retries: options.retries,
        output: options.output,
        candidates: ensureBoundedNumber(requestedCandidates, "--candidates", MIN_CANDIDATES, MAX_CANDIDATES),
        ticket: options.ticket?.trim() ? options.ticket.trim() : null,
        historyEnabled: options.history ?? repoConfig.historyEnabled ?? DEFAULT_HISTORY_ENABLED,
        historySampleSize,
        ticketPattern: repoConfig.ticketPattern ?? DEFAULT_TICKET_PATTERN,
        defaultScope: normalizeScopeName(repoConfig.defaultScope),
        knownScopes: [...new Set([
            ...(repoConfig.scopes ?? []),
            ...policy.requiredScopes,
            ...Object.values(policy.scopeMap)
        ])],
        policy
    };
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

async function runNonInteractive(
    context: RepoContext,
    options: ResolvedWorkflowOptions
): Promise<WorkflowResult> {
    const candidates = await generateCandidates(context, options);
    const selected = candidates[0];
    if (!selected) {
        throw new WorkflowError(ExitCode.InternalError, "Failed to generate a commit message.");
    }

    const diagnostics = options.explain || options.output === "text"
        ? buildWorkflowDiagnostics(context, options, selected, candidates)
        : undefined;
    const alternatives = getAlternatives(candidates);

    if (!selected.validation.ok && !options.allowInvalid) {
        return {
            ok: false,
            exitCode: ExitCode.InvalidAiOutput,
            code: EXIT_CODE_LABEL[ExitCode.InvalidAiOutput],
            message: `AI output failed validation: ${selected.validation.reason}`,
            hint: "Regenerate/edit the message or pass --allow-invalid to override.",
            diagnostics
        };
    }

    ensureValid(selected, options.allowInvalid);

    if (options.dryRun) {
        return buildSuccessResult(
            selected.message,
            selected.source,
            false,
            false,
            context,
            options.ticketPattern,
            alternatives,
            diagnostics
        );
    }

    await commitMessage(selected.message, options.noVerify);
    await maybeRecordHistory(options, context, selected.message, false, true);

    return buildSuccessResult(
        selected.message,
        selected.source,
        true,
        false,
        context,
        options.ticketPattern,
        alternatives,
        diagnostics
    );
}

export async function runWorkflow(options: WorkflowOptions): Promise<WorkflowResult> {
    try {
        if (!(await isGitRepo())) {
            throw new WorkflowError(ExitCode.GitContextError, "Not a git repository.");
        }

        const repoRoot = await getRepoRoot();
        const gitDir = await getGitDir();

        let repoConfig: RepoConfig;
        try {
            repoConfig = await loadRepoConfig(repoRoot, options.configPath);
        } catch (error: unknown) {
            throw new WorkflowError(
                ExitCode.UsageError,
                normalizeErrorMessage(error, "Failed to load config file.")
            );
        }

        const resolvedOptions = resolveWorkflowOptions(options, repoConfig);

        if (!(await hasStagedChanges())) {
            throw new WorkflowError(
                ExitCode.GitContextError,
                "No staged changes. Stage files first: git add <files>."
            );
        }

        await ensureLocalModel(
            resolvedOptions.host,
            resolvedOptions.model,
            Math.min(resolvedOptions.timeoutMs, 10000)
        );

        const context = await loadRepoContext(gitDir, resolvedOptions);

        if (resolvedOptions.ci || resolvedOptions.dryRun) {
            return await runNonInteractive(context, resolvedOptions);
        }

        return await runInteractive(context, resolvedOptions);
    } catch (error: unknown) {
        return toErrorResult(error);
    }
}
