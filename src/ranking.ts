import type { AllowedType, ValidationResult } from "./validation.js";
import { normalizeScopeName } from "./util.js";

export type RankedCandidate = {
    message: string;
    source: "model" | "repaired";
    validation: ValidationResult;
    validationErrors?: string[];
    score: number;
    scoreBreakdown: ScoreBreakdown;
};

export type ScoreContext = {
    expectedType: AllowedType | null;
    expectedScope: string | null;
    ticket: string | null;
    subjectMaxLength: number;
};

export type ScoreBreakdown = {
    valid: boolean;
    validPoints: number;
    subjectWithinLimit: boolean;
    subjectWithinLimitPoints: number;
    expectedTypeMatch: boolean;
    expectedTypePoints: number;
    expectedScopeMatch: boolean;
    expectedScopePoints: number;
    ticketFooterPresent: boolean;
    ticketFooterPoints: number;
    genericDescriptionPenalty: boolean;
    genericDescriptionPoints: number;
    total: number;
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

export function parseRankedMessage(
    message: string
): { subject: string; type: string | null; scope: string | null; description: string } {
    const subject = getSubject(message);
    const match = subject.match(/^([a-z]+)(?:\(([^)]+)\))?!?:\s(.+)$/);
    if (!match) {
        return { subject, type: null, scope: null, description: subject };
    }

    return {
        subject,
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

export function getScoreBreakdown(
    message: string,
    validation: ValidationResult,
    context: ScoreContext
): ScoreBreakdown {
    const parsed = parseRankedMessage(message);
    const normalizedExpectedScope = normalizeScopeName(context.expectedScope);

    const validPoints = validation.ok ? 1_000_000 : 0;
    const subjectWithinLimit = parsed.subject.length > 0 && parsed.subject.length <= context.subjectMaxLength;
    const subjectWithinLimitPoints = subjectWithinLimit ? 100_000 : 0;
    const expectedTypeMatch = Boolean(context.expectedType && parsed.type === context.expectedType);
    const expectedTypePoints = expectedTypeMatch ? 10_000 : 0;
    const expectedScopeMatch = Boolean(normalizedExpectedScope && parsed.scope === normalizedExpectedScope);
    const expectedScopePoints = expectedScopeMatch ? 1_000 : 0;
    const ticketFooterPresent = Boolean(context.ticket && includesTicketFooter(message, context.ticket));
    const ticketFooterPoints = ticketFooterPresent ? 100 : 0;
    const genericDescriptionPenalty = isGenericDescription(parsed.description);
    const genericDescriptionPoints = genericDescriptionPenalty ? -10 : 0;

    return {
        valid: validation.ok,
        validPoints,
        subjectWithinLimit,
        subjectWithinLimitPoints,
        expectedTypeMatch,
        expectedTypePoints,
        expectedScopeMatch,
        expectedScopePoints,
        ticketFooterPresent,
        ticketFooterPoints,
        genericDescriptionPenalty,
        genericDescriptionPoints,
        total: validPoints
            + subjectWithinLimitPoints
            + expectedTypePoints
            + expectedScopePoints
            + ticketFooterPoints
            + genericDescriptionPoints
    };
}

export function scoreCandidate(
    message: string,
    validation: ValidationResult,
    context: ScoreContext
): number {
    return getScoreBreakdown(message, validation, context).total;
}

export function rankCandidates(
    candidates: Array<Pick<RankedCandidate, "message" | "source" | "validation" | "validationErrors">>,
    context: ScoreContext
): RankedCandidate[] {
    return candidates
        .map((candidate) => {
            const scoreBreakdown = getScoreBreakdown(candidate.message, candidate.validation, context);
            return {
                ...candidate,
                score: scoreBreakdown.total,
                scoreBreakdown
            };
        })
        .sort((left, right) => right.score - left.score);
}
