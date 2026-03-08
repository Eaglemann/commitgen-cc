import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExitCode } from "../../src/exit-codes.js";
import type { WorkflowOptions } from "../../src/workflow.js";

const gitMock = {
    isGitRepo: vi.fn(),
    getRepoRoot: vi.fn()
};

const ollamaMock = {
    listLocalModels: vi.fn(),
    ensureLocalModel: vi.fn()
};

vi.mock("../../src/git.js", () => gitMock);
vi.mock("../../src/ollama.js", () => ({
    listLocalModels: ollamaMock.listLocalModels,
    ensureLocalModel: ollamaMock.ensureLocalModel
}));

const { runDoctor } = await import("../../src/doctor.js");

function baseOptions(overrides: Partial<WorkflowOptions> = {}): WorkflowOptions {
    return {
        model: null,
        host: null,
        maxChars: null,
        type: null,
        scope: null,
        dryRun: false,
        noVerify: false,
        ci: false,
        allowInvalid: false,
        timeoutMs: 60000,
        retries: 2,
        output: "text",
        configPath: null,
        candidates: null,
        ticket: null,
        history: null,
        ...overrides
    };
}

describe("runDoctor", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        gitMock.isGitRepo.mockResolvedValue(true);
        gitMock.getRepoRoot.mockResolvedValue("/repo");
        ollamaMock.listLocalModels.mockResolvedValue(["gpt-oss:120b-cloud:latest"]);
        ollamaMock.ensureLocalModel.mockResolvedValue(undefined);
    });

    it("reports git-context failures outside a repository", async () => {
        gitMock.isGitRepo.mockResolvedValue(false);

        const result = await runDoctor(baseOptions());

        expect(result.ok).toBe(false);
        expect(result.exitCode).toBe(ExitCode.GitContextError);
        expect(result.checks.some((check) => check.name === "Git repository" && !check.ok)).toBe(true);
    });

    it("fails when the repo config file is invalid", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "commitgen-doctor-"));
        await writeFile(join(repoDir, ".commitgen.json"), "{invalid");
        gitMock.getRepoRoot.mockResolvedValue(repoDir);

        const result = await runDoctor(baseOptions());

        expect(result.ok).toBe(false);
        expect(result.exitCode).toBe(ExitCode.UsageError);
        expect(result.checks.some((check) => check.name === "Repo config" && !check.ok)).toBe(true);
    });

    it("fails when the configured model is unavailable", async () => {
        ollamaMock.ensureLocalModel.mockRejectedValue(new Error("Model not found"));

        const result = await runDoctor(baseOptions());

        expect(result.ok).toBe(false);
        expect(result.exitCode).toBe(ExitCode.OllamaError);
        expect(result.checks.some((check) => check.name === "Configured model" && !check.ok)).toBe(true);
    });
});
