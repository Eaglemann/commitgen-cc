import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ExitCode } from "../../src/exit-codes.js";
import { stripCommentLines } from "../../src/lint-message.js";

const isGitRepoMock = vi.fn().mockResolvedValue(true);
const loadRepoConfigMock = vi.fn().mockResolvedValue({});

vi.mock("../../src/git.js", () => ({
    isGitRepo: (...args: unknown[]) => isGitRepoMock(...args),
    getRepoRoot: vi.fn().mockResolvedValue("/fake/repo")
}));
vi.mock("../../src/config.js", () => ({
    loadRepoConfig: (...args: unknown[]) => loadRepoConfigMock(...args)
}));

const { lintMessageFile } = await import("../../src/lint-message.js");

describe("stripCommentLines", () => {
    it("removes lines starting with #", () => {
        const result = stripCommentLines("feat: add thing\n# comment\nbody line");
        expect(result).toBe("feat: add thing\nbody line");
    });

    it("removes lines with leading whitespace before #", () => {
        const result = stripCommentLines("feat: add thing\n  # indented comment");
        expect(result).toBe("feat: add thing");
    });

    it("preserves non-comment lines", () => {
        const result = stripCommentLines("fix(api): correct error code\n\nBroken change.");
        expect(result).toBe("fix(api): correct error code\n\nBroken change.");
    });

    it("handles Windows-style CRLF line endings", () => {
        const result = stripCommentLines("feat: thing\r\n# comment\r\nbody");
        expect(result).toBe("feat: thing\nbody");
    });

    it("returns empty string when all lines are comments", () => {
        const result = stripCommentLines("# one\n# two");
        expect(result).toBe("");
    });
});

describe("lintMessageFile", () => {
    it("returns ok:true for a valid conventional commit message", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commitgen-lint-"));
        const filePath = join(dir, "COMMIT_EDITMSG");
        await writeFile(filePath, "feat(api): add user endpoint\n", "utf8");

        const result = await lintMessageFile(filePath, null);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.exitCode).toBe(ExitCode.Success);
            expect(result.subject).toBe("feat(api): add user endpoint");
            expect(result.type).toBe("feat");
            expect(result.scope).toBe("api");
        }
    });

    it("returns ok:false with errors for an invalid message", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commitgen-lint-"));
        const filePath = join(dir, "COMMIT_EDITMSG");
        await writeFile(filePath, "this is not a conventional commit\n", "utf8");

        const result = await lintMessageFile(filePath, null);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.exitCode).toBe(ExitCode.InvalidAiOutput);
            expect(result.errors.length).toBeGreaterThan(0);
        }
    });

    it("returns an error result for a missing file", async () => {
        const result = await lintMessageFile("/nonexistent/path/COMMIT_EDITMSG", null);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.exitCode).toBe(ExitCode.UsageError);
            expect(result.code).toBe("USAGE_ERROR");
            expect(result.errors.length).toBeGreaterThan(0);
        }
    });

    it("strips comment lines before linting", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commitgen-lint-"));
        const filePath = join(dir, "COMMIT_EDITMSG");
        await writeFile(filePath, "fix(cli): handle edge case\n# Please enter the commit message\n", "utf8");

        const result = await lintMessageFile(filePath, null);

        expect(result.ok).toBe(true);
    });

    it("returns GitContextError when not in a git repository", async () => {
        isGitRepoMock.mockResolvedValueOnce(false);
        const result = await lintMessageFile("/some/file", null);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.exitCode).toBe(ExitCode.GitContextError);
        }
    });

    it("returns ok:true with null scope for a scopeless conventional message", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commitgen-lint-"));
        const filePath = join(dir, "COMMIT_EDITMSG");
        await writeFile(filePath, "fix: correct return value\n", "utf8");

        const result = await lintMessageFile(filePath, null);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.type).toBe("fix");
            expect(result.scope).toBeNull();
        }
    });

    it("returns an error result when config loading throws a non-WorkflowError", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commitgen-lint-"));
        const filePath = join(dir, "COMMIT_EDITMSG");
        await writeFile(filePath, "feat: something\n", "utf8");

        loadRepoConfigMock.mockRejectedValueOnce(new Error("EACCES: permission denied"));

        const result = await lintMessageFile(filePath, null);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe("USAGE_ERROR");
            expect(result.errors.length).toBeGreaterThan(0);
        }
    });
});
