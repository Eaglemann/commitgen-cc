import { describe, expect, it } from "vitest";
import { inferScopeFromFiles, inferTicketFromBranch } from "../../src/context.js";

describe("inferScopeFromFiles", () => {
    it("returns the dominant top-level directory when it covers at least 60 percent", () => {
        expect(inferScopeFromFiles([
            "src/cli.ts",
            "src/workflow.ts",
            "README.md"
        ])).toBe("src");
    });

    it("returns null when no top-level directory reaches the threshold", () => {
        expect(inferScopeFromFiles([
            "src/cli.ts",
            "tests/cli.test.ts",
            "README.md"
        ])).toBeNull();
    });

    it("prefers configured scope mappings when they cover the threshold", () => {
        expect(inferScopeFromFiles([
            "src/cli/index.ts",
            "src/cli/install.ts",
            "README.md"
        ], {
            "src/cli": "cli"
        })).toBe("cli");
    });
});

describe("inferTicketFromBranch", () => {
    it("extracts the first matching ticket from the branch name", () => {
        expect(inferTicketFromBranch(
            "feature/ABC-123-improve-cli",
            "([A-Z][A-Z0-9]+-\\d+)"
        )).toBe("ABC-123");
    });

    it("returns null when the branch does not contain a ticket", () => {
        expect(inferTicketFromBranch(
            "feature/improve-cli",
            "([A-Z][A-Z0-9]+-\\d+)"
        )).toBeNull();
    });
});
