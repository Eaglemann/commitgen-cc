import { describe, expect, it } from "vitest";
import type { CandidateDiagnostics, ContextDiagnostics } from "../../src/diagnostics.js";
import type { DoctorResult } from "../../src/doctor.js";
import { createTerminalUi, renderDoctorReport, renderErrorBlock, renderReviewScreen } from "../../src/ui.js";

function baseContext(): ContextDiagnostics {
    return {
        expectedType: {
            value: "feat",
            source: "diff"
        },
        scope: {
            suggested: "cli",
            effective: "cli",
            source: "changed-files"
        },
        ticket: {
            value: "ABC-123",
            source: "branch"
        }
    };
}

function baseCandidate(overrides: Partial<CandidateDiagnostics> = {}): CandidateDiagnostics {
    return {
        message: "feat(cli): add baseline\n\nRefs ABC-123",
        subject: "feat(cli): add baseline",
        source: "repaired",
        final: {
            type: "feat",
            scope: {
                value: "cli",
                source: "changed-files"
            },
            ticket: {
                value: "ABC-123",
                source: "branch"
            }
        },
        validation: {
            ok: true,
            errors: []
        },
        ranking: {
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

describe("ui renderers", () => {
    it("renders the primary review screen as a stable rich-layout snapshot", () => {
        const ui = createTerminalUi({ isTTY: false, columns: 80 }, { forceRichLayout: true });

        expect(renderReviewScreen(ui, baseContext(), baseCandidate(), {
            explain: true,
            alternativesCount: 1
        })).toBe([
            "== Review commit message ==",
            "",
            "== Context ==",
            "  Expected type : feat (diff inference)",
            "  Scope         : cli (changed files)",
            "  Ticket        : ABC-123 (branch inference)",
            "",
            "== Commit preview ==",
            "  [VALID] [REPAIRED] [SCOPE cli] [TICKET ABC-123]",
            "  Subject : feat(cli): add baseline",
            "  Body    :",
            "    Refs ABC-123",
            "",
            "== Why this message ==",
            "  Source          : repaired",
            "  Expected type   : feat (diff inference)",
            "  Selected scope  : cli (changed files)",
            "  Selected ticket : ABC-123 (branch inference)",
            "  Validation      : valid",
            "  Ranking         : 1111100 (valid, subject-fit, type-match, scope-match,",
            "                    ticket-footer)",
            "  Alternatives    : 1"
        ].join("\n"));
    });

    it("renders a representative failure block as a stable snapshot", () => {
        const ui = createTerminalUi({ isTTY: false, columns: 80 }, { forceRichLayout: true });

        expect(renderErrorBlock(
            ui,
            "Generated message failed validation",
            "Scope is required and must be one of: cli.",
            "Revise, edit, regenerate, or rerun with `--allow-invalid` if you want to override."
        )).toBe([
            "== Problem ==",
            "  Problem   : Generated message failed validation",
            "  Why       : Scope is required and must be one of: cli.",
            "  Next step : Revise, edit, regenerate, or rerun with `--allow-invalid` if you",
            "              want to override."
        ].join("\n"));
    });

    it("falls back to plain output when the caller does not request a rich layout", () => {
        const ui = createTerminalUi({ isTTY: false, columns: 80 });

        expect(renderReviewScreen(ui, baseContext(), baseCandidate(), {
            explain: false
        })).toBe("feat(cli): add baseline\n\nRefs ABC-123");
    });

    it("includes doctor sections and next steps in the report", () => {
        const ui = createTerminalUi({ isTTY: false, columns: 80 }, { forceRichLayout: true });
        const result: DoctorResult = {
            ok: false,
            exitCode: 3,
            checks: [
                {
                    section: "Environment",
                    name: "Node.js",
                    ok: true,
                    detail: "Detected 20.12.0"
                },
                {
                    section: "Ollama",
                    name: "Configured model",
                    ok: false,
                    detail: "Model not found",
                    nextStep: "Run `ollama pull gpt-oss:120b-cloud` and retry."
                }
            ]
        };

        const report = renderDoctorReport(ui, result);
        expect(report).toContain("== Doctor ==");
        expect(report).toContain("== Environment ==");
        expect(report).toContain("== Ollama ==");
        expect(report).toContain("next: Run `ollama pull gpt-oss:120b-cloud` and retry.");
    });
});
