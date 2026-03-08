import { ollamaChat } from "./ollama.js";
import { buildMessages } from "./prompt.js";
import { rankCandidates, type RankedCandidate } from "./ranking.js";
import {
    extractMessageFromModelOutput,
    extractMessageListFromModelOutput,
    normalizeMessage,
    repairMessage,
    validateMessage
} from "./validation.js";
import type { RepoContext, ResolvedWorkflowOptions } from "./workflow.js";

type CandidateDraft = Omit<RankedCandidate, "score">;

function toCandidateDraft(
    rawMessage: string,
    context: RepoContext,
    options: ResolvedWorkflowOptions
): CandidateDraft {
    const repaired = repairMessage({
        message: rawMessage,
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

async function requestModelOutput(
    context: RepoContext,
    options: ResolvedWorkflowOptions,
    candidateCount: number,
    revisionRequest?: {
        currentMessage: string;
        feedback: string;
    }
): Promise<string> {
    const messages = buildMessages({
        diff: context.diff,
        files: context.files,
        branch: context.branch,
        suggestedScope: context.effectiveScope,
        ticket: context.ticket,
        recentExamples: context.recentExamples,
        forcedType: options.type,
        forcedScope: options.scope,
        knownScopes: options.knownScopes,
        candidateCount,
        revisionRequest
    });

    return (await ollamaChat({
        host: options.host,
        model: options.model,
        messages,
        json: true,
        timeoutMs: options.timeoutMs,
        retries: options.retries
    })).trim();
}

async function generateSingleCandidate(
    context: RepoContext,
    options: ResolvedWorkflowOptions
): Promise<CandidateDraft> {
    const raw = await requestModelOutput(context, options, 1);
    return toCandidateDraft(extractMessageFromModelOutput(raw), context, options);
}

async function generateBatchCandidates(
    context: RepoContext,
    options: ResolvedWorkflowOptions
): Promise<CandidateDraft[]> {
    const raw = await requestModelOutput(context, options, options.candidates);
    const messages = extractMessageListFromModelOutput(raw);
    if (!messages || messages.length === 0) return [];

    return messages.map((message) => toCandidateDraft(message, context, options));
}

function pushUniqueCandidate(
    candidate: CandidateDraft,
    uniqueMessages: Set<string>,
    candidates: CandidateDraft[]
): void {
    if (uniqueMessages.has(candidate.message)) return;
    uniqueMessages.add(candidate.message);
    candidates.push(candidate);
}

export async function generateCandidates(
    context: RepoContext,
    options: ResolvedWorkflowOptions
): Promise<RankedCandidate[]> {
    const attempts = Math.max(options.candidates, 1) * 3;
    const uniqueMessages = new Set<string>();
    const candidates: CandidateDraft[] = [];

    if (options.candidates > 1) {
        const batchCandidates = await generateBatchCandidates(context, options);
        for (const candidate of batchCandidates) {
            pushUniqueCandidate(candidate, uniqueMessages, candidates);
            if (candidates.length >= options.candidates) break;
        }
    }

    for (let attempt = 0; attempt < attempts && candidates.length < options.candidates; attempt += 1) {
        const candidate = await generateSingleCandidate(context, options);
        pushUniqueCandidate(candidate, uniqueMessages, candidates);
    }

    return rankCandidates(candidates, {
        expectedType: context.expectedType,
        expectedScope: context.effectiveScope,
        ticket: context.ticket
    });
}

export async function reviseCandidate(
    context: RepoContext,
    options: ResolvedWorkflowOptions,
    currentMessage: string,
    feedback: string
): Promise<RankedCandidate> {
    const raw = await requestModelOutput(context, options, 1, {
        currentMessage,
        feedback
    });
    const candidate = toCandidateDraft(extractMessageFromModelOutput(raw), context, options);
    return {
        ...candidate,
        score: rankCandidates([candidate], {
            expectedType: context.expectedType,
            expectedScope: context.effectiveScope,
            ticket: context.ticket
        })[0]?.score ?? 0
    };
}
