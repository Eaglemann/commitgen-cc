import { describe, expect, it } from "vitest";
import { buildCandidateDiagnostics, buildWorkflowDiagnostics } from "../../src/diagnostics.js";
import { resolveCommitPolicy } from "../../src/policy.js";
import type { RankedCandidate } from "../../src/ranking.js";
import type { RepoContext, ResolvedWorkflowOptions } from "../../src/workflow.js";

function baseContext(overrides: Partial<RepoContext> = {}): RepoContext {
    return {
        gitDir: "/repo/.git",
        diff: "diff --git a/src/cli.ts b/src/cli.ts\n+const x = 1;",
        files: ["src/cli.ts"],
        branch: "feature/ABC-123-add-baseline",
        suggestedScope: "cli",
        effectiveScope: "cli",
        ticket: "ABC-123",
        recentExamples: [],
        expectedType: "feat",
        historyPath: null,
        ...overrides
    };
}

function baseOptions(overrides: Partial<ResolvedWorkflowOptions> = {}): ResolvedWorkflowOptions {
    return {
        model: "gpt-oss:120b-cloud",
        host: "http://localhost:11434",
        maxChars: 16000,
        type: null,
        scope: null,
        dryRun: true,
        noVerify: false,
        ci: true,
        allowInvalid: false,
        explain: true,
        timeoutMs: 60000,
        retries: 2,
        output: "json",
        candidates: 2,
        ticket: null,
        historyEnabled: false,
        historySampleSize: 5,
        ticketPattern: "([A-Z][A-Z0-9]+-\\d+)",
        defaultScope: null,
        knownScopes: [],
        policy: resolveCommitPolicy({}),
        ...overrides
    };
}

function rankedCandidate(overrides: Partial<RankedCandidate> = {}): RankedCandidate {
    return {
        message: "feat(cli): add baseline\n\nRefs ABC-123",
        source: "repaired",
        validation: { ok: true },
        validationErrors: [],
        score: 1_111_100,
        scoreBreakdown: {
            valid: true,
            validPoints: 1_000_000,
            subjectWithinLimit: true,
            subjectWithinLimitPoints: 100_000,
            expectedTypeMatch: true,
            expectedTypePoints: 10_000,
            expectedScopeMatch: true,
            expectedScopePoints: 1_000,
            ticketFooterPresent: true,
            ticketFooterPoints: 100,
            genericDescriptionPenalty: false,
            genericDescriptionPoints: 0,
            total: 1_111_100
        },
        ...overrides
    };
}

describe("buildWorkflowDiagnostics", () => {
    it("captures context and selected candidate sources", () => {
        const diagnostics = buildWorkflowDiagnostics(
            baseContext(),
            baseOptions(),
            rankedCandidate(),
            [
                rankedCandidate(),
                rankedCandidate({
                    message: "feat(cli): add ranking support\n\nRefs ABC-123",
                    source: "model",
                    score: 1_111_090,
                    scoreBreakdown: {
                        ...rankedCandidate().scoreBreakdown,
                        genericDescriptionPenalty: true,
                        genericDescriptionPoints: -10,
                        total: 1_111_090
                    }
                })
            ]
        );

        expect(diagnostics.context.expectedType).toEqual({
            value: "feat",
            source: "diff"
        });
        expect(diagnostics.context.scope).toEqual({
            suggested: "cli",
            effective: "cli",
            source: "changed-files"
        });
        expect(diagnostics.context.ticket).toEqual({
            value: "ABC-123",
            source: "branch"
        });
        expect(diagnostics.selected?.final.scope).toEqual({
            value: "cli",
            source: "changed-files"
        });
        expect(diagnostics.selected?.final.ticket).toEqual({
            value: "ABC-123",
            source: "branch"
        });
        expect(diagnostics.candidates).toHaveLength(2);
    });

    it("keeps full validation errors for invalid candidates", () => {
        const diagnostics = buildCandidateDiagnostics(
            rankedCandidate({
                message: "bad message",
                validation: { ok: false, reason: "Not Conventional Commits format" },
                validationErrors: [
                    "Not Conventional Commits format",
                    "Scope is required and must be one of: cli.",
                    "Message must reference a ticket."
                ],
                score: 100,
                scoreBreakdown: {
                    valid: false,
                    validPoints: 0,
                    subjectWithinLimit: true,
                    subjectWithinLimitPoints: 100_000,
                    expectedTypeMatch: false,
                    expectedTypePoints: 0,
                    expectedScopeMatch: false,
                    expectedScopePoints: 0,
                    ticketFooterPresent: false,
                    ticketFooterPoints: 0,
                    genericDescriptionPenalty: false,
                    genericDescriptionPoints: 0,
                    total: 100_000
                }
            }),
            baseContext(),
            baseOptions({
                policy: resolveCommitPolicy({
                    requiredScopes: ["cli"],
                    requireTicket: true
                })
            })
        );

        expect(diagnostics.validation.ok).toBe(false);
        expect(diagnostics.validation.errors).toEqual([
            "Not Conventional Commits format",
            "Scope is required and must be one of: cli.",
            "Message must reference a ticket."
        ]);
    });

    it("uses cli context sources and message-derived final values when they differ from inferred context", () => {
        const diagnostics = buildWorkflowDiagnostics(
            baseContext({
                suggestedScope: null,
                effectiveScope: "api",
                ticket: "XYZ-999",
                expectedType: "fix"
            }),
            baseOptions({
                type: "fix",
                scope: "api",
                ticket: "XYZ-999"
            }),
            rankedCandidate({
                message: "fix(core): hand tune copy\n\nRefs DEF-456",
                source: "model"
            })
        );

        expect(diagnostics.context.expectedType.source).toBe("cli");
        expect(diagnostics.context.scope.source).toBe("cli");
        expect(diagnostics.context.ticket.source).toBe("cli");
        expect(diagnostics.selected?.final.scope).toEqual({
            value: "core",
            source: "message"
        });
        expect(diagnostics.selected?.final.ticket).toEqual({
            value: "DEF-456",
            source: "message"
        });
    });

    it("falls back to default-config scope source and recomputes missing validation details", () => {
        const diagnostics = buildWorkflowDiagnostics(
            baseContext({
                suggestedScope: null,
                effectiveScope: "docs",
                ticket: null,
                expectedType: null
            }),
            baseOptions({
                defaultScope: "docs",
                policy: resolveCommitPolicy({
                    requiredScopes: ["docs"],
                    requireTicket: true
                })
            }),
            {
                message: "bad message",
                source: "model",
                validation: { ok: false, reason: "Not Conventional Commits format" },
                score: 0
            } as RankedCandidate
        );

        expect(diagnostics.context.expectedType.source).toBe("none");
        expect(diagnostics.context.scope.source).toBe("default-config");
        expect(diagnostics.context.ticket.source).toBe("none");
        expect(diagnostics.selected?.validation.errors).toContain("Scope is required and must be one of: docs.");
        expect(diagnostics.selected?.validation.errors).toContain("Message must reference a ticket.");
        expect(diagnostics.selected?.ranking.total).toBeGreaterThanOrEqual(0);
    });
});
