import { describe, expect, it } from "vitest";
import { getScoreBreakdown, rankCandidates, scoreCandidate } from "../../src/ranking.js";

describe("scoreCandidate", () => {
    it("prefers valid, context-matching candidates over generic invalid ones", () => {
        const specific = scoreCandidate("feat(cli): add config support\n\nRefs ABC-123", { ok: true }, {
            expectedType: "feat",
            expectedScope: "cli",
            ticket: "ABC-123",
            subjectMaxLength: 72
        });
        const generic = scoreCandidate("misc changes", { ok: false, reason: "Not Conventional Commits format" }, {
            expectedType: "feat",
            expectedScope: "cli",
            ticket: "ABC-123",
            subjectMaxLength: 72
        });

        expect(specific).toBeGreaterThan(generic);
    });
});

describe("rankCandidates", () => {
    it("orders candidates by score descending", () => {
        const candidates = rankCandidates([
            {
                message: "feat: update files",
                source: "repaired",
                validation: { ok: true }
            },
            {
                message: "feat(cli): add config support\n\nRefs ABC-123",
                source: "model",
                validation: { ok: true }
            }
        ], {
            expectedType: "feat",
            expectedScope: "cli",
            ticket: "ABC-123",
            subjectMaxLength: 72
        });

        expect(candidates[0].message).toBe("feat(cli): add config support\n\nRefs ABC-123");
    });

    it("exposes score breakdown details for explain mode", () => {
        const breakdown = getScoreBreakdown("feat(cli): add config support\n\nRefs ABC-123", { ok: true }, {
            expectedType: "feat",
            expectedScope: "cli",
            ticket: "ABC-123",
            subjectMaxLength: 72
        });

        expect(breakdown.valid).toBe(true);
        expect(breakdown.expectedTypeMatch).toBe(true);
        expect(breakdown.expectedScopeMatch).toBe(true);
        expect(breakdown.ticketFooterPresent).toBe(true);
        expect(breakdown.total).toBe(1_111_100);
    });
});
