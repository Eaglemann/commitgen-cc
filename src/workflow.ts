import prompts from "prompts";
import {
    DEFAULT_HISTORY_ENABLED,
    DEFAULT_HISTORY_SAMPLE_SIZE,
    DEFAULT_HOST,
    DEFAULT_INTERACTIVE_CANDIDATES,
    DEFAULT_MAX_CHARS,
    DEFAULT_MODEL,
    DEFAULT_TICKET_PATTERN,
    loadRepoConfig,
    type RepoConfig
} from "./config.js";
import { inferScopeFromFiles, inferTicketFromBranch } from "./context.js";
import { ExitCode, EXIT_CODE_LABEL } from "./exit-codes.js";
import {
    getCurrentBranch,
    getGitDir,
    getRepoRoot,
    getStagedDiff,
    getStagedFiles,
    gitCommit,
    hasStagedChanges,
    isGitRepo
} from "./git.js";
import { appendHistory, readHistory, resolveHistoryPath } from "./history.js";
import { ensureLocalModel, ollamaChat, OllamaError } from "./ollama.js";
import { buildMessages } from "./prompt.js";
import { rankCandidates, type RankedCandidate } from "./ranking.js";
import { clampDiff, normalizeErrorMessage, normalizeScopeName } from "./util.js";
import {
    type AllowedType,
    extractMessageFromModelOutput,
    inferTypeFromDiff,
    normalizeMessage,
    parseConventionalSubject,
    repairMessage,
    validateMessage
} from "./validation.js";

export type OutputFormat = "text" | "json";
export type MessageSource = "model" | "repaired";

const MIN_MAX_CHARS = 500;
const MAX_MAX_CHARS = 200000;
const MIN_HISTORY_SAMPLE_SIZE = 1;
const MAX_HISTORY_SAMPLE_SIZE = 25;
const MIN_CANDIDATES = 1;
const MAX_CANDIDATES = 5;

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
    timeoutMs: number;
    retries: number;
    output: OutputFormat;
    configPath: string | null;
    candidates: number | null;
    ticket: string | null;
    history: boolean | null;
};

type SuccessResult = {
    ok: true;
    exitCode: ExitCode.Success;
    message: string;
    source: MessageSource;
    committed: boolean;
    cancelled: boolean;
    scope: string | null;
    ticket: string | null;
    alternatives?: string[];
};

type ErrorResult = {
    ok: false;
    exitCode: Exclude<ExitCode, ExitCode.Success>;
    code: string;
    message: string;
    hint: string | null;
};

export type WorkflowResult = SuccessResult | ErrorResult;

type ResolvedWorkflowOptions = {
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
    candidates: number;
    ticket: string | null;
    historyEnabled: boolean;
    historySampleSize: number;
    ticketPattern: string;
    defaultScope: string | null;
    knownScopes: string[];
};

type RepoContext = {
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

function ensureBoundedNumber(
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

function ensureNonEmptyString(value: string | null | undefined, name: string): string {
    const normalized = value?.trim();
    if (!normalized) {
        throw new WorkflowError(ExitCode.UsageError, `${name} must be a non-empty string.`);
    }
    return normalized;
}

export function resolveWorkflowOptions(
    options: WorkflowOptions,
    repoConfig: RepoConfig
): ResolvedWorkflowOptions {
    const interactiveCandidates = ensureBoundedNumber(
        repoConfig.interactiveCandidates ?? DEFAULT_INTERACTIVE_CANDIDATES,
        "interactiveCandidates",
        MIN_CANDIDATES,
        MAX_CANDIDATES
    );

    const requestedCandidates = options.candidates
        ?? (options.ci || options.dryRun ? 1 : interactiveCandidates);

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
        timeoutMs: options.timeoutMs,
        retries: options.retries,
        output: options.output,
        candidates: ensureBoundedNumber(requestedCandidates, "--candidates", MIN_CANDIDATES, MAX_CANDIDATES),
        ticket: options.ticket?.trim() ? options.ticket.trim() : null,
        historyEnabled: options.history ?? repoConfig.historyEnabled ?? DEFAULT_HISTORY_ENABLED,
        historySampleSize,
        ticketPattern: repoConfig.ticketPattern ?? DEFAULT_TICKET_PATTERN,
        defaultScope: normalizeScopeName(repoConfig.defaultScope),
        knownScopes: repoConfig.scopes ?? []
    };
}

function buildSuccessResult(
    message: string,
    source: MessageSource,
    committed: boolean,
    cancelled: boolean,
    context: RepoContext,
    alternatives: string[]
): SuccessResult {
    const parsed = parseConventionalSubject(message.split("\n")[0] ?? "");

    return {
        ok: true,
        exitCode: ExitCode.Success,
        message,
        source,
        committed,
        cancelled,
        scope: parsed?.scope ?? context.effectiveScope,
        ticket: context.ticket,
        alternatives: alternatives.length > 0 ? alternatives : undefined
    };
}

function ensureValid(candidate: RankedCandidate, allowInvalid: boolean): void {
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

async function maybeRecordHistory(
    options: ResolvedWorkflowOptions,
    context: RepoContext,
    message: string,
    edited: boolean,
    shouldRecord: boolean
): Promise<void> {
    if (!shouldRecord || options.ci || !options.historyEnabled || !context.historyPath) return;

    const parsed = parseConventionalSubject(message.split("\n")[0] ?? "");
    try {
        await appendHistory(context.historyPath, {
            createdAt: new Date().toISOString(),
            message,
            edited,
            scope: parsed?.scope ?? context.effectiveScope,
            ticket: context.ticket,
            files: context.files
        });
    } catch {
        // History is best-effort and must not block commits.
    }
}

async function generateCandidate(
    context: RepoContext,
    options: ResolvedWorkflowOptions
): Promise<Omit<RankedCandidate, "score">> {
    const messages = buildMessages({
        diff: context.diff,
        files: context.files,
        branch: context.branch,
        suggestedScope: context.effectiveScope,
        ticket: context.ticket,
        recentExamples: context.recentExamples,
        forcedType: options.type,
        forcedScope: options.scope,
        knownScopes: options.knownScopes
    });

    const raw = (await ollamaChat({
        host: options.host,
        model: options.model,
        messages,
        json: true,
        timeoutMs: options.timeoutMs,
        retries: options.retries
    })).trim();

    const extracted = extractMessageFromModelOutput(raw);
    const repaired = repairMessage({
        message: extracted,
        diff: context.diff,
        forcedType: options.type,
        scope: context.effectiveScope,
        ticket: context.ticket
    });

    const message = normalizeMessage(repaired.message);
    return {
        message,
        source: repaired.didRepair ? "repaired" : "model",
        validation: validateMessage(message)
    };
}

async function generateCandidates(
    context: RepoContext,
    options: ResolvedWorkflowOptions
): Promise<RankedCandidate[]> {
    const attempts = Math.max(options.candidates, 1) * 3;
    const uniqueMessages = new Set<string>();
    const candidates: Array<Omit<RankedCandidate, "score">> = [];

    for (let attempt = 0; attempt < attempts && candidates.length < options.candidates; attempt += 1) {
        const candidate = await generateCandidate(context, options);
        if (uniqueMessages.has(candidate.message)) continue;

        uniqueMessages.add(candidate.message);
        candidates.push(candidate);
    }

    return rankCandidates(candidates, {
        expectedType: context.expectedType,
        expectedScope: context.effectiveScope,
        ticket: context.ticket
    });
}

function getAlternatives(candidates: RankedCandidate[]): string[] {
    return candidates.slice(1).map((candidate) => candidate.message);
}

function printCandidates(candidates: RankedCandidate[]): void {
    console.log("\n--- Suggested commit candidates ---\n");
    candidates.forEach((candidate, index) => {
        console.log(`${index + 1}. ${candidate.message}`);
        if (!candidate.validation.ok) {
            console.log(`   Validation: ${candidate.validation.reason}`);
        }
        console.log("");
    });
    console.log("-------------------------------\n");
}

function toCandidateChoice(candidate: RankedCandidate, index: number): { title: string; value: string; description?: string } {
    const [subject, ...bodyLines] = candidate.message.split("\n");
    const details = [
        candidate.source === "repaired" ? "repaired" : null,
        !candidate.validation.ok ? candidate.validation.reason : null,
        bodyLines.find((line) => line.trim().length > 0) ?? null
    ]
        .filter((entry): entry is string => Boolean(entry))
        .join(" | ");

    return {
        title: `${index + 1}. ${subject}`,
        value: `candidate:${index}`,
        description: details || undefined
    };
}

async function chooseCandidate(candidates: RankedCandidate[]): Promise<RankedCandidate | "regen" | "cancel"> {
    const response = await prompts({
        type: "select",
        name: "selection",
        message: "Select a candidate",
        choices: [
            ...candidates.map(toCandidateChoice),
            { title: "Regenerate all", value: "regen" },
            { title: "Cancel", value: "cancel" }
        ],
        initial: 0
    });

    const selection = response.selection as string | undefined;
    if (!selection || selection === "cancel") return "cancel";
    if (selection === "regen") return "regen";

    const index = Number.parseInt(selection.replace("candidate:", ""), 10);
    return candidates[index] ?? "cancel";
}

async function chooseAction(): Promise<"accept" | "edit" | "dry" | "back" | "regen" | "cancel"> {
    const response = await prompts({
        type: "select",
        name: "action",
        message: "What next?",
        choices: [
            { title: "Accept and commit", value: "accept" },
            { title: "Edit selected", value: "edit" },
            { title: "Dry-run selected", value: "dry" },
            { title: "Choose another candidate", value: "back" },
            { title: "Regenerate all", value: "regen" },
            { title: "Cancel", value: "cancel" }
        ],
        initial: 0
    });

    return (response.action as "accept" | "edit" | "dry" | "back" | "regen" | "cancel" | undefined) ?? "cancel";
}

async function runNonInteractive(
    context: RepoContext,
    options: ResolvedWorkflowOptions
): Promise<SuccessResult> {
    const candidates = await generateCandidates(context, options);
    const selected = candidates[0];
    if (!selected) {
        throw new WorkflowError(ExitCode.InternalError, "Failed to generate a commit message.");
    }

    ensureValid(selected, options.allowInvalid);
    const alternatives = getAlternatives(candidates);

    if (options.dryRun) {
        return buildSuccessResult(
            selected.message,
            selected.source,
            false,
            false,
            context,
            alternatives
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
        alternatives
    );
}

async function runInteractive(
    context: RepoContext,
    options: ResolvedWorkflowOptions
): Promise<SuccessResult> {
    while (true) {
        process.stdout.write("Generating commit candidates... ");
        const candidates = await generateCandidates(context, options);
        process.stdout.write("Done.\n");

        if (candidates.length === 0) {
            throw new WorkflowError(ExitCode.InternalError, "Failed to generate a commit message.");
        }

        printCandidates(candidates);

        while (true) {
            const selection = await chooseCandidate(candidates);
            if (selection === "cancel") {
                return buildSuccessResult(
                    candidates[0].message,
                    candidates[0].source,
                    false,
                    true,
                    context,
                    getAlternatives(candidates)
                );
            }
            if (selection === "regen") break;

            const action = await chooseAction();
            if (action === "cancel") {
                return buildSuccessResult(
                    selection.message,
                    selection.source,
                    false,
                    true,
                    context,
                    getAlternatives(candidates)
                );
            }
            if (action === "back") continue;
            if (action === "regen") break;

            let finalMessage = selection.message;
            let edited = false;

            if (action === "edit") {
                const editedResponse = await prompts({
                    type: "text",
                    name: "message",
                    message: "Edit commit message",
                    initial: finalMessage
                });

                const editedMessage = editedResponse.message as string | undefined;
                if (!editedMessage) {
                    return buildSuccessResult(
                        selection.message,
                        selection.source,
                        false,
                        true,
                        context,
                        getAlternatives(candidates)
                    );
                }

                finalMessage = normalizeMessage(editedMessage);
                edited = true;
            }

            const validation = validateMessage(finalMessage);
            if (action === "accept" && !validation.ok && !options.allowInvalid) {
                console.error(`Cannot commit invalid message: ${validation.reason}`);
                console.error("Use Edit/Regenerate, or rerun with --allow-invalid to override.");
                continue;
            }

            const source = edited || finalMessage !== selection.message ? "repaired" : selection.source;
            if (action === "dry") {
                await maybeRecordHistory(options, context, finalMessage, edited, validation.ok || options.allowInvalid);
                return buildSuccessResult(
                    finalMessage,
                    source,
                    false,
                    false,
                    context,
                    getAlternatives(candidates)
                );
            }

            await commitMessage(finalMessage, options.noVerify);
            await maybeRecordHistory(options, context, finalMessage, edited, true);
            return buildSuccessResult(
                finalMessage,
                source,
                true,
                false,
                context,
                getAlternatives(candidates)
            );
        }
    }
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

        const stagedDiff = await getStagedDiff();
        const files = await getStagedFiles();
        const branch = await getCurrentBranch();
        const suggestedScope = inferScopeFromFiles(files);
        const effectiveScope = resolvedOptions.scope ?? suggestedScope ?? resolvedOptions.defaultScope;
        const ticket = resolvedOptions.ticket ?? inferTicketFromBranch(branch, resolvedOptions.ticketPattern);
        const historyPath = resolvedOptions.historyEnabled ? resolveHistoryPath(gitDir) : null;
        const recentExamples = historyPath
            ? (await readHistory(historyPath, resolvedOptions.historySampleSize)).map((entry) => entry.message)
            : [];

        const context: RepoContext = {
            gitDir,
            diff: clampDiff(stagedDiff, resolvedOptions.maxChars),
            files,
            branch,
            suggestedScope,
            effectiveScope,
            ticket,
            recentExamples,
            expectedType: resolvedOptions.type ?? inferTypeFromDiff(stagedDiff),
            historyPath
        };

        if (resolvedOptions.ci || resolvedOptions.dryRun) {
            return await runNonInteractive(context, resolvedOptions);
        }

        return await runInteractive(context, resolvedOptions);
    } catch (error: unknown) {
        return toErrorResult(error);
    }
}
