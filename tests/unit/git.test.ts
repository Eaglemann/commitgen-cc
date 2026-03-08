import { beforeEach, describe, expect, it, vi } from "vitest";

const execaMock = vi.fn();

vi.mock("execa", () => ({
    execa: execaMock
}));

const {
    getCurrentBranch,
    getGitDir,
    getRepoRoot,
    getStagedDiff,
    getStagedFiles,
    gitCommit,
    hasStagedChanges,
    isGitRepo
} = await import("../../src/git.js");

describe("git helpers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("detects whether the current directory is inside a git repo", async () => {
        execaMock.mockResolvedValueOnce({});
        await expect(isGitRepo()).resolves.toBe(true);

        execaMock.mockRejectedValueOnce(new Error("not a repo"));
        await expect(isGitRepo()).resolves.toBe(false);
    });

    it("detects staged changes from git diff exit codes", async () => {
        execaMock.mockResolvedValueOnce({});
        await expect(hasStagedChanges()).resolves.toBe(false);

        execaMock.mockRejectedValueOnce({ exitCode: 1 });
        await expect(hasStagedChanges()).resolves.toBe(true);
    });

    it("propagates unexpected git diff failures", async () => {
        execaMock.mockRejectedValueOnce({ exitCode: 2, message: "boom" });
        await expect(hasStagedChanges()).rejects.toMatchObject({ exitCode: 2 });
    });

    it("reads staged diff and file lists", async () => {
        execaMock
            .mockResolvedValueOnce({ stdout: "diff --git a/src/a.ts b/src/a.ts" })
            .mockResolvedValueOnce({ stdout: "src/a.ts\nREADME.md\n" });

        await expect(getStagedDiff()).resolves.toBe("diff --git a/src/a.ts b/src/a.ts");
        await expect(getStagedFiles()).resolves.toEqual(["src/a.ts", "README.md"]);
    });

    it("reads repo root, git dir, and branch name", async () => {
        execaMock
            .mockResolvedValueOnce({ stdout: "/repo" })
            .mockResolvedValueOnce({ stdout: "/repo/.git" })
            .mockResolvedValueOnce({ stdout: "feature/ABC-123" })
            .mockResolvedValueOnce({ stdout: "" });

        await expect(getRepoRoot()).resolves.toBe("/repo");
        await expect(getGitDir()).resolves.toBe("/repo/.git");
        await expect(getCurrentBranch()).resolves.toBe("feature/ABC-123");
        await expect(getCurrentBranch()).resolves.toBeNull();
    });

    it("passes the commit message and no-verify flag through to git commit", async () => {
        execaMock.mockResolvedValue({});

        await gitCommit("feat: add cli", { noVerify: true });

        expect(execaMock).toHaveBeenCalledWith("git", ["commit", "-m", "feat: add cli", "--no-verify"], {
            stdio: "inherit"
        });
    });
});
