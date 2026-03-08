import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
    DEFAULT_CONFIG_FILE,
    DEFAULT_HOST,
    DEFAULT_MODEL,
    loadRepoConfig
} from "./config.js";
import { ExitCode } from "./exit-codes.js";
import { getRepoRoot, isGitRepo } from "./git.js";
import { ensureLocalModel, listLocalModels } from "./ollama.js";
import { resolveWorkflowOptions, type WorkflowOptions } from "./workflow.js";

export type DoctorCheck = {
    name: string;
    ok: boolean;
    detail: string;
};

export type DoctorResult = {
    ok: boolean;
    exitCode: Exclude<ExitCode, ExitCode.Success> | ExitCode.Success;
    checks: DoctorCheck[];
};

async function configExists(repoRoot: string, configPath: string | null): Promise<boolean> {
    const targetPath = configPath ? resolve(process.cwd(), configPath) : join(repoRoot, DEFAULT_CONFIG_FILE);
    try {
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}

function parseNodeMajor(): number {
    return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
}

export async function runDoctor(options: WorkflowOptions): Promise<DoctorResult> {
    const checks: DoctorCheck[] = [];

    const nodeMajor = parseNodeMajor();
    checks.push({
        name: "Node.js",
        ok: nodeMajor >= 20,
        detail: `Detected ${process.versions.node}${nodeMajor >= 20 ? "" : " (require >= 20)"}`
    });
    if (nodeMajor < 20) {
        return { ok: false, exitCode: ExitCode.UsageError, checks };
    }

    if (!(await isGitRepo())) {
        checks.push({
            name: "Git repository",
            ok: false,
            detail: "Not inside a git repository."
        });
        return { ok: false, exitCode: ExitCode.GitContextError, checks };
    }

    const repoRoot = await getRepoRoot();
    checks.push({
        name: "Git repository",
        ok: true,
        detail: repoRoot
    });

    let repoConfig;
    try {
        repoConfig = await loadRepoConfig(repoRoot, options.configPath);
        const exists = await configExists(repoRoot, options.configPath);
        checks.push({
            name: "Repo config",
            ok: true,
            detail: exists
                ? (options.configPath ? resolve(process.cwd(), options.configPath) : join(repoRoot, DEFAULT_CONFIG_FILE))
                : "No repo config found; using defaults."
        });
    } catch (error: unknown) {
        checks.push({
            name: "Repo config",
            ok: false,
            detail: error instanceof Error ? error.message : String(error)
        });
        return { ok: false, exitCode: ExitCode.UsageError, checks };
    }

    const resolvedOptions = resolveWorkflowOptions(options, repoConfig);
    checks.push({
        name: "Resolved model",
        ok: true,
        detail: resolvedOptions.model || DEFAULT_MODEL
    });
    checks.push({
        name: "Resolved host",
        ok: true,
        detail: resolvedOptions.host || DEFAULT_HOST
    });

    try {
        const models = await listLocalModels(resolvedOptions.host, Math.min(resolvedOptions.timeoutMs, 5_000));
        checks.push({
            name: "Ollama",
            ok: true,
            detail: `Reachable with ${models.length} local model${models.length === 1 ? "" : "s"}.`
        });
    } catch (error: unknown) {
        checks.push({
            name: "Ollama",
            ok: false,
            detail: error instanceof Error ? error.message : String(error)
        });
        return { ok: false, exitCode: ExitCode.OllamaError, checks };
    }

    try {
        await ensureLocalModel(
            resolvedOptions.host,
            resolvedOptions.model,
            Math.min(resolvedOptions.timeoutMs, 5_000)
        );
        checks.push({
            name: "Configured model",
            ok: true,
            detail: resolvedOptions.model
        });
    } catch (error: unknown) {
        checks.push({
            name: "Configured model",
            ok: false,
            detail: error instanceof Error ? error.message : String(error)
        });
        return { ok: false, exitCode: ExitCode.OllamaError, checks };
    }

    return { ok: true, exitCode: ExitCode.Success, checks };
}
