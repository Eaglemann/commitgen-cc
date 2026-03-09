import type { CandidateDiagnostics, DiagnosticSource, WorkflowDiagnostics } from "./diagnostics.js";

function describeSource(source: DiagnosticSource): string {
    switch (source) {
        case "cli":
            return "CLI override";
        case "diff":
            return "diff inference";
        case "changed-files":
            return "changed files";
        case "default-config":
            return "repo default";
        case "branch":
            return "branch inference";
        case "message":
            return "message content";
        default:
            return "not set";
    }
}

function formatValueWithSource(value: string | null, source: DiagnosticSource): string {
    if (!value) return "none";
    return `${value} (${describeSource(source)})`;
}

function formatRankingSummary(candidate: CandidateDiagnostics): string {
    const details: string[] = [];
    if (candidate.ranking.valid) details.push("valid");
    if (candidate.ranking.subjectWithinLimit) details.push("subject-fit");
    if (candidate.ranking.expectedTypeMatch) details.push("type-match");
    if (candidate.ranking.expectedScopeMatch) details.push("scope-match");
    if (candidate.ranking.ticketFooterPresent) details.push("ticket-footer");
    if (candidate.ranking.genericDescriptionPenalty) details.push("generic-penalty");

    return `${candidate.ranking.total} (${details.join(", ") || "no bonuses"})`;
}

export function formatMessageCard(candidate: CandidateDiagnostics): string {
    const labels = [
        candidate.validation.ok ? "valid" : "invalid",
        candidate.source === "repaired" ? "repaired" : "model",
        candidate.final.scope.value ? `scope:${candidate.final.scope.value}` : null,
        candidate.final.ticket.value ? `ticket:${candidate.final.ticket.value}` : null
    ]
        .filter((entry): entry is string => Boolean(entry))
        .join(" | ");

    return [
        "Commit message",
        `status: ${labels}`,
        "",
        candidate.message
    ].join("\n");
}

export function formatExplainBlock(
    context: WorkflowDiagnostics["context"],
    candidate: CandidateDiagnostics,
    alternativesCount = 0
): string {
    const lines = [
        "Why this message",
        `- source: ${candidate.source}`,
        `- expected type: ${formatValueWithSource(context.expectedType.value, context.expectedType.source)}`,
        `- selected scope: ${formatValueWithSource(candidate.final.scope.value, candidate.final.scope.source)}`,
        `- selected ticket: ${formatValueWithSource(candidate.final.ticket.value, candidate.final.ticket.source)}`
    ];

    if (candidate.validation.ok) {
        lines.push("- validation: valid");
    } else {
        lines.push("- validation: invalid");
        for (const error of candidate.validation.errors) {
            lines.push(`  - ${error}`);
        }
    }

    lines.push(`- ranking: ${formatRankingSummary(candidate)}`);

    if (alternativesCount > 0) {
        lines.push(`- alternatives: ${alternativesCount}`);
    }

    return lines.join("\n");
}
