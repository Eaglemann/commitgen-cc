import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExitCode } from "../../src/exit-codes.js";
import type { WorkflowOptions } from "../../src/workflow.js";

const gitMock = {
    isGitRepo: vi.fn(),
    hasStagedChanges: vi.fn(),
    getStagedDiff: vi.fn(),
    gitCommit: vi.fn()
};

class MockOllamaError extends Error {
    hint: string | null;

    constructor(message: string, hint?: string) {
        super(message);
        this.name = "OllamaError";
        this.hint = hint ?? null;
    }
}

const ollamaMock = {
    ensureLocalModel: vi.fn(),
    ollamaChat: vi.fn()
};
const promptsMock = vi.fn();

vi.mock("../../src/git.js", () => gitMock);
vi.mock("../../src/ollama.js", () => ({
    ensureLocalModel: ollamaMock.ensureLocalModel,
    ollamaChat: ollamaMock.ollamaChat,
    OllamaError: MockOllamaError
}));
vi.mock("prompts", () => ({
    default: promptsMock
}));

const { runWorkflow } = await import("../../src/workflow.js");

function baseOptions(overrides: Partial<WorkflowOptions> = {}): WorkflowOptions {
    return {
        model: "llama3",
        host: "http://localhost:11434",
        maxChars: 16000,
        type: null,
        scope: null,
        dryRun: false,
        noVerify: false,
        ci: true,
        allowInvalid: false,
        timeoutMs: 60000,
        retries: 2,
        output: "text",
        ...overrides
    };
}

describe("runWorkflow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        gitMock.isGitRepo.mockResolvedValue(true);
        gitMock.hasStagedChanges.mockResolvedValue(true);
        gitMock.getStagedDiff.mockResolvedValue("diff --git a/src/a.ts b/src/a.ts\n+const x = 1;");
        gitMock.gitCommit.mockResolvedValue(undefined);
        ollamaMock.ensureLocalModel.mockResolvedValue(undefined);
        ollamaMock.ollamaChat.mockResolvedValue("{\"message\":\"feat: add baseline\"}");
        promptsMock.mockResolvedValue({ action: "cancel" });
    });

    it("returns git context error when repository is missing", async () => {
        gitMock.isGitRepo.mockResolvedValue(false);

        const result = await runWorkflow(baseOptions());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.exitCode).toBe(ExitCode.GitContextError);
    });

    it("returns git context error when no staged changes exist", async () => {
        gitMock.hasStagedChanges.mockResolvedValue(false);

        const result = await runWorkflow(baseOptions());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.exitCode).toBe(ExitCode.GitContextError);
    });

    it("blocks invalid AI output by default", async () => {
        ollamaMock.ollamaChat.mockResolvedValue("{\"message\":\"this is invalid\"}");

        const result = await runWorkflow(baseOptions());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.exitCode).toBe(ExitCode.InvalidAiOutput);
        expect(gitMock.gitCommit).not.toHaveBeenCalled();
    });

    it("allows invalid output only when --allow-invalid is enabled", async () => {
        ollamaMock.ollamaChat.mockResolvedValue("{\"message\":\"this is invalid\"}");

        const result = await runWorkflow(baseOptions({ allowInvalid: true }));
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.committed).toBe(true);
        expect(gitMock.gitCommit).toHaveBeenCalledTimes(1);
    });

    it("maps Ollama availability failures to exit code 3", async () => {
        ollamaMock.ensureLocalModel.mockRejectedValue(new MockOllamaError("Cannot reach Ollama.", "Run `ollama serve`."));

        const result = await runWorkflow(baseOptions());
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.exitCode).toBe(ExitCode.OllamaError);
            expect(result.hint).toBe("Run `ollama serve`.");
        }
    });

    it("maps commit failures to exit code 5", async () => {
        gitMock.gitCommit.mockRejectedValue(new Error("hook failed"));

        const result = await runWorkflow(baseOptions());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.exitCode).toBe(ExitCode.GitCommitError);
    });

    it("supports non-interactive dry-run without committing", async () => {
        const result = await runWorkflow(baseOptions({ dryRun: true }));
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.committed).toBe(false);
        expect(gitMock.gitCommit).not.toHaveBeenCalled();
    });

    it("marks repaired source when deterministic repair changed the output", async () => {
        gitMock.getStagedDiff.mockResolvedValue("diff --git a/README.md b/README.md\n+updated docs");
        ollamaMock.ollamaChat.mockResolvedValue("{\"message\":\"update readme content.\"}");

        const result = await runWorkflow(baseOptions({ dryRun: true }));
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.source).toBe("repaired");
            expect(result.message).toBe("docs: update readme content");
        }
    });

    it("commits in interactive mode when action is accept", async () => {
        promptsMock.mockResolvedValueOnce({ action: "accept" });

        const result = await runWorkflow(baseOptions({ ci: false }));
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.committed).toBe(true);
            expect(result.cancelled).toBe(false);
        }
        expect(gitMock.gitCommit).toHaveBeenCalledTimes(1);
    });

    it("returns dry-run result in interactive mode", async () => {
        promptsMock.mockResolvedValueOnce({ action: "dry" });

        const result = await runWorkflow(baseOptions({ ci: false }));
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.committed).toBe(false);
            expect(result.cancelled).toBe(false);
        }
    });

    it("supports interactive edit flow and commits edited message", async () => {
        promptsMock
            .mockResolvedValueOnce({ action: "edit" })
            .mockResolvedValueOnce({ message: "fix(core): adjust parser flow" });

        const result = await runWorkflow(baseOptions({ ci: false }));
        expect(result.ok).toBe(true);
        expect(gitMock.gitCommit).toHaveBeenCalledWith("fix(core): adjust parser flow", { noVerify: false });
    });

    it("treats empty edit input as cancellation", async () => {
        promptsMock
            .mockResolvedValueOnce({ action: "edit" })
            .mockResolvedValueOnce({ message: undefined });

        const result = await runWorkflow(baseOptions({ ci: false }));
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.cancelled).toBe(true);
    });

    it("loops when interactive accept is invalid and then allows cancel", async () => {
        ollamaMock.ollamaChat.mockResolvedValue("{\"message\":\"invalid message\"}");
        promptsMock
            .mockResolvedValueOnce({ action: "accept" })
            .mockResolvedValueOnce({ action: "cancel" });

        const result = await runWorkflow(baseOptions({ ci: false }));
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.cancelled).toBe(true);
        expect(gitMock.gitCommit).not.toHaveBeenCalled();
    });

    it("maps unexpected thrown values to internal errors", async () => {
        gitMock.isGitRepo.mockRejectedValue("boom");

        const result = await runWorkflow(baseOptions());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.exitCode).toBe(ExitCode.InternalError);
    });
});
