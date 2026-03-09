import prompts from "prompts";
import { buildCandidateDiagnostics, buildContextDiagnostics } from "./diagnostics.js";
import { formatExplainBlock, formatMessageCard } from "./explain-output.js";
import { ExitCode } from "./exit-codes.js";
import { getAlternatives, buildSuccessResult, commitMessage, maybeRecordHistory } from "./finalize.js";
import { lintCommitMessage } from "./policy.js";
import { type RankedCandidate } from "./ranking.js";
import { normalizeMessage, type ValidationResult } from "./validation.js";
import { WorkflowError } from "./workflow-errors.js";
import { generateCandidates, reviseCandidate } from "./candidates.js";
import type { RepoContext, ResolvedWorkflowOptions, SuccessResult } from "./workflow.js";

function toCandidateChoice(candidate: RankedCandidate, index: number): { title: string; value: string; description?: string } {
    const [subject, ...bodyLines] = candidate.message.split("\n");
    const details = [
        candidate.validation.ok ? "valid" : `invalid: ${candidate.validation.reason}`,
        candidate.source === "repaired" ? "repaired" : null,
        bodyLines.find((line) => line.trim().length > 0)
            ? `body: ${bodyLines.find((line) => line.trim().length > 0)}`
            : null
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

async function chooseCandidateAction(): Promise<"accept" | "edit" | "dry" | "back" | "regen" | "cancel"> {
    const response = await prompts({
        type: "select",
        name: "action",
        message: "What next?",
        choices: [
            { title: "Commit selected message", value: "accept" },
            { title: "Edit selected message", value: "edit" },
            { title: "Print selected message only", value: "dry" },
            { title: "Pick another candidate", value: "back" },
            { title: "Regenerate candidates", value: "regen" },
            { title: "Cancel", value: "cancel" }
        ],
        initial: 0
    });

    return (response.action as "accept" | "edit" | "dry" | "back" | "regen" | "cancel" | undefined) ?? "cancel";
}

async function chooseSingleMessageAction(): Promise<"accept" | "revise" | "edit" | "dry" | "regen" | "cancel"> {
    const response = await prompts({
        type: "select",
        name: "action",
        message: "What next?",
        choices: [
            { title: "Commit this message", value: "accept" },
            { title: "Ask for a revision", value: "revise" },
            { title: "Edit manually", value: "edit" },
            { title: "Print message only", value: "dry" },
            { title: "Generate another", value: "regen" },
            { title: "Cancel", value: "cancel" }
        ],
        initial: 0
    });

    return (response.action as "accept" | "revise" | "edit" | "dry" | "regen" | "cancel" | undefined) ?? "cancel";
}

async function promptRevisionFeedback(): Promise<string | null> {
    const response = await prompts({
        type: "text",
        name: "feedback",
        message: "What should change? (leave empty to keep the current message)"
    });

    const feedback = response.feedback as string | undefined;
    const normalized = feedback?.trim();
    return normalized && normalized.length > 0 ? normalized : null;
}

function printSelectedCandidate(
    candidate: RankedCandidate,
    context: RepoContext,
    options: ResolvedWorkflowOptions,
    alternativesCount = 0
): void {
    const diagnostics = buildCandidateDiagnostics(candidate, context, options);

    console.log("");
    console.log(formatMessageCard(diagnostics));

    if (!candidate.validation.ok && !options.explain) {
        console.log("");
        console.log(`Validation: ${candidate.validation.reason}`);
    }

    if (options.explain) {
        console.log("");
        console.log(formatExplainBlock(
            buildContextDiagnostics(context, options),
            diagnostics,
            alternativesCount
        ));
    }

    console.log("");
}

function validateCandidateMessage(
    message: string,
    options: ResolvedWorkflowOptions
): ValidationResult {
    const lintResult = lintCommitMessage(message, options.policy, options.ticketPattern);
    return lintResult.ok
        ? { ok: true }
        : { ok: false, reason: lintResult.errors[0] ?? "Invalid commit message" };
}

function createCandidateFromMessage(
    base: RankedCandidate,
    message: string,
    options: ResolvedWorkflowOptions,
    source?: RankedCandidate["source"]
): RankedCandidate {
    const normalized = normalizeMessage(message);
    return {
        ...base,
        message: normalized,
        source: source ?? (normalized === base.message ? base.source : "repaired"),
        validationErrors: lintCommitMessage(normalized, options.policy, options.ticketPattern).errors,
        validation: validateCandidateMessage(normalized, options)
    };
}

async function handleFinalAction(
    context: RepoContext,
    options: ResolvedWorkflowOptions,
    candidate: RankedCandidate,
    action: "accept" | "edit" | "dry" | "cancel",
    alternatives: string[]
): Promise<SuccessResult | RankedCandidate> {
    if (action === "cancel") {
        return buildSuccessResult(
            candidate.message,
            candidate.source,
            false,
            true,
            context,
            options.ticketPattern,
            alternatives
        );
    }

    let finalCandidate = candidate;
    let edited = false;

    if (action === "edit") {
        const editedResponse = await prompts({
            type: "text",
            name: "message",
            message: "Edit commit message (leave empty to cancel)",
            initial: candidate.message
        });

        const editedMessage = editedResponse.message as string | undefined;
        if (!editedMessage) {
            console.log("No edited message entered. Cancelling.");
            return buildSuccessResult(
                candidate.message,
                candidate.source,
                false,
                true,
                context,
                options.ticketPattern,
                alternatives
            );
        }

        finalCandidate = createCandidateFromMessage(candidate, editedMessage, options, "repaired");
        edited = true;
    }

    const validation = validateCandidateMessage(finalCandidate.message, options);
    if (action === "accept" && !validation.ok && !options.allowInvalid) {
        console.error(`Cannot commit invalid message: ${validation.reason}`);
        console.error("Use Ask for change/Edit/Regenerate, or rerun with --allow-invalid to override.");
        finalCandidate = {
            ...finalCandidate,
            validation
        };
        return finalCandidate;
    }

    if (action === "dry") {
        return buildSuccessResult(
            finalCandidate.message,
            finalCandidate.source,
            false,
            false,
            context,
            options.ticketPattern,
            alternatives
        );
    }

    await commitMessage(finalCandidate.message, options.noVerify);
    await maybeRecordHistory(options, context, finalCandidate.message, edited, true);
    return buildSuccessResult(
        finalCandidate.message,
        finalCandidate.source,
        true,
        false,
        context,
        options.ticketPattern,
        alternatives
    );
}

async function runSingleMessageInteractive(
    context: RepoContext,
    options: ResolvedWorkflowOptions
): Promise<SuccessResult> {
    while (true) {
        process.stdout.write("Generating commit message... ");
        const candidates = await generateCandidates(context, {
            ...options,
            candidates: 1
        });
        process.stdout.write("Done.\n");

        const initial = candidates[0];
        if (!initial) {
            throw new WorkflowError(ExitCode.InternalError, "Failed to generate a commit message.");
        }

        let current = initial;

        while (true) {
            printSelectedCandidate(current, context, options);
            const action = await chooseSingleMessageAction();

            if (action === "regen") break;

            if (action === "revise") {
                const feedback = await promptRevisionFeedback();
                if (!feedback) {
                    console.log("No revision request entered. Keeping the current message.");
                    continue;
                }
                current = await reviseCandidate(context, options, current.message, feedback);
                continue;
            }

            const result = await handleFinalAction(context, options, current, action, []);
            if ("ok" in result) return result;
            current = result;
        }
    }
}

async function runCandidateSelectionInteractive(
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

        while (true) {
            const selection = await chooseCandidate(candidates);
            if (selection === "cancel") {
                return buildSuccessResult(
                    candidates[0].message,
                    candidates[0].source,
                    false,
                    true,
                    context,
                    options.ticketPattern,
                    getAlternatives(candidates)
                );
            }
            if (selection === "regen") break;

            printSelectedCandidate(selection, context, options, candidates.length - 1);

            const action = await chooseCandidateAction();
            if (action === "back") continue;
            if (action === "regen") break;

            const result = await handleFinalAction(
                context,
                options,
                selection,
                action,
                getAlternatives(candidates)
            );
            if ("ok" in result) return result;
        }
    }
}

export async function runInteractive(
    context: RepoContext,
    options: ResolvedWorkflowOptions
): Promise<SuccessResult> {
    if (options.candidates <= 1) {
        return await runSingleMessageInteractive(context, options);
    }

    return await runCandidateSelectionInteractive(context, options);
}
