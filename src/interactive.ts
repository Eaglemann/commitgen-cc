import prompts from "prompts";
import { ExitCode } from "./exit-codes.js";
import { getAlternatives, buildSuccessResult, commitMessage, maybeRecordHistory } from "./finalize.js";
import { type RankedCandidate } from "./ranking.js";
import { normalizeMessage, validateMessage } from "./validation.js";
import { WorkflowError } from "./workflow-errors.js";
import { generateCandidates, reviseCandidate } from "./candidates.js";
import type { RepoContext, ResolvedWorkflowOptions, SuccessResult } from "./workflow.js";

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

async function chooseCandidateAction(): Promise<"accept" | "edit" | "dry" | "back" | "regen" | "cancel"> {
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

async function chooseSingleMessageAction(): Promise<"accept" | "revise" | "edit" | "dry" | "regen" | "cancel"> {
    const response = await prompts({
        type: "select",
        name: "action",
        message: "What next?",
        choices: [
            { title: "Accept and commit", value: "accept" },
            { title: "Ask for change", value: "revise" },
            { title: "Edit message", value: "edit" },
            { title: "Dry-run message", value: "dry" },
            { title: "Regenerate", value: "regen" },
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
        message: "What should change?"
    });

    const feedback = response.feedback as string | undefined;
    const normalized = feedback?.trim();
    return normalized && normalized.length > 0 ? normalized : null;
}

function printSelectedCandidate(candidate: RankedCandidate): void {
    console.log("\n--- Selected commit message ---\n");
    console.log(candidate.message);
    if (!candidate.validation.ok) {
        console.log(`\nValidation: ${candidate.validation.reason}`);
    }
    console.log("\n-------------------------------\n");
}

function createCandidateFromMessage(base: RankedCandidate, message: string, source?: RankedCandidate["source"]): RankedCandidate {
    const normalized = normalizeMessage(message);
    return {
        ...base,
        message: normalized,
        source: source ?? (normalized === base.message ? base.source : "repaired"),
        validation: validateMessage(normalized)
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
            alternatives
        );
    }

    let finalCandidate = candidate;
    let edited = false;

    if (action === "edit") {
        const editedResponse = await prompts({
            type: "text",
            name: "message",
            message: "Edit commit message",
            initial: candidate.message
        });

        const editedMessage = editedResponse.message as string | undefined;
        if (!editedMessage) {
            return buildSuccessResult(
                candidate.message,
                candidate.source,
                false,
                true,
                context,
                alternatives
            );
        }

        finalCandidate = createCandidateFromMessage(candidate, editedMessage, "repaired");
        edited = true;
    }

    const validation = validateMessage(finalCandidate.message);
    if (action === "accept" && !validation.ok && !options.allowInvalid) {
        console.error(`Cannot commit invalid message: ${validation.reason}`);
        console.error("Use Ask for change/Edit/Regenerate, or rerun with --allow-invalid to override.");
        return finalCandidate;
    }

    if (action === "dry") {
        return buildSuccessResult(
            finalCandidate.message,
            finalCandidate.source,
            false,
            false,
            context,
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
            printSelectedCandidate(current);
            const action = await chooseSingleMessageAction();

            if (action === "regen") break;

            if (action === "revise") {
                const feedback = await promptRevisionFeedback();
                if (!feedback) continue;
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
                    getAlternatives(candidates)
                );
            }
            if (selection === "regen") break;

            printSelectedCandidate(selection);

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
