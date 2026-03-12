import { describe, expect, it } from "vitest";
import { inferScopeFromFiles, inferTicketFromBranch } from "../../src/context.js";

describe("inferScopeFromFiles", () => {
    it("returns null when top-level dirs are structural noise (src)", () => {
        expect(inferScopeFromFiles([
            "src/cli.ts",
            "src/workflow.ts",
            "README.md"
        ])).toBeNull();
    });

    it("returns stem when source and test files share the same module name", () => {
        expect(inferScopeFromFiles([
            "src/cli.ts",
            "tests/cli.test.ts",
            "README.md"
        ])).toBe("cli");
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

    it("returns file stem for a single test file (strips .test suffix)", () => {
        expect(inferScopeFromFiles([
            "tests/unit/workflow.test.ts"
        ])).toBe("workflow");
    });

    it("returns file stem for a single spec file", () => {
        expect(inferScopeFromFiles([
            "tests/unit/candidates.spec.ts"
        ])).toBe("candidates");
    });

    it("returns parent dir when stems diverge but directory is shared", () => {
        expect(inferScopeFromFiles([
            "src/api/users.ts",
            "src/api/posts.ts"
        ])).toBe("api");
    });

    it("returns parent dir for components with diverging stems", () => {
        expect(inferScopeFromFiles([
            "src/components/Button.tsx",
            "src/components/Modal.tsx"
        ])).toBe("components");
    });

    it("falls back to parent dir when stem is index", () => {
        expect(inferScopeFromFiles([
            "src/dashboard/index.ts"
        ])).toBe("dashboard");
    });

    it("returns null when all dirs are noise and stems diverge", () => {
        expect(inferScopeFromFiles([
            "tests/unit/foo.test.ts",
            "tests/unit/bar.test.ts"
        ])).toBeNull();
    });

    it("returns null for empty file list", () => {
        expect(inferScopeFromFiles([])).toBeNull();
    });

    it("returns null when no threshold is met across scattered files", () => {
        expect(inferScopeFromFiles([
            "src/cli.ts",
            "tests/cli.test.ts",
            "docs/guide.md",
            "README.md"
        ])).toBeNull();
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
