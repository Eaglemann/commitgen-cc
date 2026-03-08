import { describe, expect, it } from "vitest";
import { rankCandidates, scoreCandidate } from "../../src/ranking.js";

describe("scoreCandidate", () => {
    it("prefers valid, context-matching candidates over generic invalid ones", () => {
        const specific = scoreCandidate("feat(cli): add config support\n\nRefs ABC-123", { ok: true }, {
            expectedType: "feat",
            expectedScope: "cli",
            ticket: "ABC-123"
        });
        const generic = scoreCandidate("misc changes", { ok: false, reason: "Not Conventional Commits format" }, {
            expectedType: "feat",
            expectedScope: "cli",
            ticket: "ABC-123"
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
            ticket: "ABC-123"
        });

        expect(candidates[0].message).toBe("feat(cli): add config support\n\nRefs ABC-123");
    });
});
