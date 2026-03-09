import { chmod, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ExitCode } from "./exit-codes.js";
import { getGitDir, getRepoRoot, isGitRepo } from "./git.js";
import { lintMessageFile } from "./lint-message.js";
import { resolveCommitPolicy } from "./policy.js";
import { buildDefaultWorkflowOptions } from "./workflow-options.js";
import { runWorkflow } from "./workflow.js";
import { loadRepoConfig } from "./config.js";
import { normalizeErrorMessage } from "./util.js";
import { WorkflowError } from "./workflow-errors.js";

const MANAGED_MARKER = "# commitgen-cc managed hook";
const MANAGED_HOOKS = ["prepare-commit-msg", "commit-msg"] as const;

function quoteShell(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildHookScript(
    hookName: typeof MANAGED_HOOKS[number],
    nodePath: string,
    cliPath: string,
    configPath: string | null
): string {
    const configExport = configPath
        ? `COMMITGEN_CONFIG_PATH=${quoteShell(configPath)}
export COMMITGEN_CONFIG_PATH
`
        : "";
    return `#!/bin/sh
${MANAGED_MARKER}
set -eu
NODE_BIN=${quoteShell(nodePath)}
CLI_PATH=${quoteShell(cliPath)}
${configExport}\
exec "$NODE_BIN" "$CLI_PATH" __internal-hook ${hookName} "$@"
`;
}

async function ensureManagedOrMissing(path: string): Promise<void> {
    try {
        const current = await readFile(path, "utf8");
        if (!current.includes(MANAGED_MARKER)) {
            throw new WorkflowError(
                ExitCode.UsageError,
                `Refusing to overwrite unmanaged hook: ${path}`,
                { hint: "Rename or merge the existing hook, then rerun install-hook." }
            );
        }
    } catch (error: unknown) {
        if (error instanceof WorkflowError) throw error;
    }
}

export async function installHooks(cliPath: string, nodePath: string, configPath: string | null): Promise<string[]> {
    if (!(await isGitRepo())) {
        throw new WorkflowError(ExitCode.GitContextError, "Not a git repository.");
    }

    const gitDir = await getGitDir();
    const installed: string[] = [];
    const resolvedConfigPath = configPath ? resolve(process.cwd(), configPath) : null;

    for (const hookName of MANAGED_HOOKS) {
        const hookPath = join(gitDir, "hooks", hookName);
        await ensureManagedOrMissing(hookPath);
        await writeFile(hookPath, buildHookScript(hookName, nodePath, cliPath, resolvedConfigPath), "utf8");
        await chmod(hookPath, 0o755);
        installed.push(hookPath);
    }

    return installed;
}

export async function uninstallHooks(): Promise<string[]> {
    if (!(await isGitRepo())) {
        throw new WorkflowError(ExitCode.GitContextError, "Not a git repository.");
    }

    const gitDir = await getGitDir();
    const removed: string[] = [];

    for (const hookName of MANAGED_HOOKS) {
        const hookPath = join(gitDir, "hooks", hookName);
        try {
            const current = await readFile(hookPath, "utf8");
            if (!current.includes(MANAGED_MARKER)) continue;
            await unlink(hookPath);
            removed.push(hookPath);
        } catch {
            // Missing hooks are fine.
        }
    }

    return removed;
}

function shouldSkipPrepareHook(source: string | undefined): boolean {
    if (!source) return false;
    return ["message", "template", "merge", "squash", "commit"].includes(source);
}

export async function runPrepareCommitMsgHook(
    messageFile: string,
    configPath: string | null,
    source?: string
): Promise<number> {
    try {
        if (shouldSkipPrepareHook(source)) return ExitCode.Success;

        const current = await readFile(messageFile, "utf8").catch(() => "");
        if (current.trim().length > 0) return ExitCode.Success;

        const result = await runWorkflow(buildDefaultWorkflowOptions({
            configPath,
            ci: true,
            dryRun: true
        }));

        if (!result.ok) {
            console.error(`commitgen-cc: prepare-commit-msg skipped: ${result.message}`);
            if (result.hint) console.error(result.hint);
            return ExitCode.Success;
        }

        if (!result.message.trim()) return ExitCode.Success;
        await writeFile(messageFile, `${result.message}\n`, "utf8");
    } catch (error: unknown) {
        console.error(`commitgen-cc: prepare-commit-msg skipped: ${normalizeErrorMessage(error, "Unknown error.")}`);
    }
    return ExitCode.Success;
}

export async function runCommitMsgHook(messageFile: string, configPath: string | null): Promise<number> {
    try {
        if (!(await isGitRepo())) {
            console.error("commitgen-cc: Not a git repository.");
            return ExitCode.GitContextError;
        }

        const repoRoot = await getRepoRoot();
        const repoConfig = await loadRepoConfig(repoRoot, configPath);
        const policy = resolveCommitPolicy(repoConfig);
        if (policy.hookMode !== "enforce") {
            return ExitCode.Success;
        }

        const result = await lintMessageFile(messageFile, configPath);
        if (result.ok) return ExitCode.Success;

        console.error(result.message);
        for (const error of result.errors) {
            console.error(`- ${error}`);
        }
        return result.exitCode;
    } catch (error: unknown) {
        console.error(`commitgen-cc: ${normalizeErrorMessage(error, "commit-msg hook failed.")}`);
        return ExitCode.UsageError;
    }
}

export function formatHookInstallMessage(paths: string[]): string {
    if (paths.length === 0) return "No hooks were installed.";
    return `Installed hooks:\n${paths.map((path) => `- ${path}`).join("\n")}`;
}

export function formatHookUninstallMessage(paths: string[]): string {
    if (paths.length === 0) return "No managed hooks were removed.";
    return `Removed hooks:\n${paths.map((path) => `- ${path}`).join("\n")}`;
}

export function formatHookError(error: unknown): string {
    return normalizeErrorMessage(error, "Hook operation failed.");
}
