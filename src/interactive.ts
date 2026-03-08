import prompts from "prompts";
import { ExitCode } from "./exit-codes.js";
import { getAlternatives, buildSuccessResult, commitMessage, maybeRecordHistory } from "./finalize.js";
import { type RankedCandidate } from "./ranking.js";
import { normalizeMessage, validateMessage } from "./validation.js";
import { WorkflowError } from "./workflow-errors.js";
import { generateCandidates } from "./candidates.js";
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

function printSelectedCandidate(candidate: RankedCandidate): void {
    console.log("\n--- Selected commit message ---\n");
    console.log(candidate.message);
    if (!candidate.validation.ok) {
        console.log(`\nValidation: ${candidate.validation.reason}`);
    }
    console.log("\n-------------------------------\n");
}

export async function runInteractive(
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
