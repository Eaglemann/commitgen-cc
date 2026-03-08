import type { AllowedType, ValidationResult } from "./validation.js";
import { normalizeScopeName } from "./util.js";

export type RankedCandidate = {
    message: string;
    source: "model" | "repaired";
    validation: ValidationResult;
    score: number;
};

type ScoreContext = {
    expectedType: AllowedType | null;
    expectedScope: string | null;
    ticket: string | null;
    subjectMaxLength: number;
};

const GENERIC_DESCRIPTION_PATTERNS = [
    /^update files?$/i,
    /^update project files?$/i,
    /^misc(?:ellaneous)? changes?$/i,
    /^misc(?:ellaneous)? updates?$/i,
    /^minor changes?$/i,
    /^small improvements?$/i
];

function getSubject(message: string): string {
    return message.split("\n")[0]?.trim() ?? "";
}

function parseSubject(
    message: string
): { type: string | null; scope: string | null; description: string } {
    const subject = getSubject(message);
    const match = subject.match(/^([a-z]+)(?:\(([^)]+)\))?!?:\s(.+)$/);
    if (!match) {
        return { type: null, scope: null, description: subject };
    }

    return {
        type: match[1] ?? null,
        scope: normalizeScopeName(match[2] ?? null),
        description: (match[3] ?? "").trim()
    };
}

function includesTicketFooter(message: string, ticket: string | null): boolean {
    if (!ticket) return false;
    return message.includes(`Refs ${ticket}`);
}

function isGenericDescription(description: string): boolean {
    return GENERIC_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(description.trim()));
}

export function scoreCandidate(
    message: string,
    validation: ValidationResult,
    context: ScoreContext
): number {
    const parsed = parseSubject(message);
    const subject = getSubject(message);

    let score = validation.ok ? 1_000_000 : 0;
    if (subject.length > 0 && subject.length <= context.subjectMaxLength) score += 100_000;
    if (context.expectedType && parsed.type === context.expectedType) score += 10_000;

    const normalizedExpectedScope = normalizeScopeName(context.expectedScope);
    if (normalizedExpectedScope && parsed.scope === normalizedExpectedScope) score += 1_000;

    if (context.ticket && includesTicketFooter(message, context.ticket)) score += 100;
    if (isGenericDescription(parsed.description)) score -= 10;

    return score;
}

export function rankCandidates(
    candidates: Array<Omit<RankedCandidate, "score">>,
    context: ScoreContext
): RankedCandidate[] {
    return candidates
        .map((candidate) => ({
            ...candidate,
            score: scoreCandidate(candidate.message, candidate.validation, context)
        }))
        .sort((left, right) => right.score - left.score);
}
