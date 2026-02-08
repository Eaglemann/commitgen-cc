import { describe, expect, it } from "vitest";
import { buildMessages } from "../../src/prompt.js";

describe("buildMessages", () => {
    it("includes forced type and scope constraints when provided", () => {
        const messages = buildMessages({
            diff: "diff --git a/src/a.ts b/src/a.ts",
            forcedType: "fix",
            scope: "api"
        });

        expect(messages).toHaveLength(2);
        expect(messages[1].content).toContain("Forced type: fix");
        expect(messages[1].content).toContain("Use scope: api");
    });

    it("includes default constraints when type and scope are not provided", () => {
        const messages = buildMessages({
            diff: "diff --git a/src/a.ts b/src/a.ts",
            forcedType: null,
            scope: null
        });

        expect(messages[1].content).toContain("Choose the best type from allowed list.");
        expect(messages[1].content).toContain("Use a scope only if it helps; otherwise omit.");
    });
});
