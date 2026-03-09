#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runDoctor } from "./doctor.js";
import { ExitCode } from "./exit-codes.js";
import { getMessageSubject } from "./finalize.js";
import {
    formatHookError,
    formatHookInstallMessage,
    formatHookUninstallMessage,
    installHooks,
    runCommitMsgHook,
    runPrepareCommitMsgHook,
    uninstallHooks
} from "./hooks.js";
import { lintMessageFile, type LintMessageCommandResult } from "./lint-message.js";
import { buildDefaultWorkflowOptions } from "./workflow-options.js";
import { parseBoundedInteger } from "./util.js";
import { isAllowedType, type AllowedType } from "./validation.js";
import { runWorkflow, type OutputFormat, type WorkflowOptions, type WorkflowResult } from "./workflow.js";
import { WorkflowError } from "./workflow-errors.js";

const MIN_MAX_CHARS = 500;
const MAX_MAX_CHARS = 200000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 300000;
const MIN_RETRIES = 0;
const MAX_RETRIES = 5;
const MIN_CANDIDATES = 1;
const MAX_CANDIDATES = 5;

type RawCliOptions = {
    model?: string;
    host?: string;
    maxChars?: string;
    type?: string;
    scope?: string;
    dryRun: boolean;
    noVerify: boolean;
    ci: boolean;
    allowInvalid: boolean;
    timeoutMs?: string;
    retries?: string;
    output?: string;
    config?: string;
    candidates?: string;
    ticket?: string;
    history?: boolean;
};

type RawLintOptions = {
    file: string;
    config?: string;
    output?: string;
};

type RawHookOptions = {
    config?: string;
};

type RawDoctorOptions = {
    model?: string;
    host?: string;
    timeoutMs?: string;
    retries?: string;
    config?: string;
};

function parseOptionalBoundedInteger(
    value: string | undefined,
    name: string,
    min: number,
    max: number
): number | null {
    if (value === undefined) return null;
    return parseBoundedInteger(value, name, min, max);
}

function parseOutput(value: string): OutputFormat {
    if (value === "text" || value === "json") return value;
    throw new Error("--output must be one of: text, json.");
}

function parseType(value: string | undefined): AllowedType | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (!isAllowedType(normalized)) {
        throw new Error("Invalid --type. Must be one of: feat, fix, chore, refactor, docs, test, perf, build, ci.");
    }
    return normalized;
}

function buildOptions(raw: RawCliOptions, historyExplicit: boolean): WorkflowOptions {
    const base = buildDefaultWorkflowOptions();
    return {
        ...base,
        model: raw.model?.trim() ? raw.model.trim() : base.model,
        host: raw.host?.trim() ? raw.host.trim() : base.host,
        maxChars: parseOptionalBoundedInteger(raw.maxChars, "--max-chars", MIN_MAX_CHARS, MAX_MAX_CHARS),
        type: parseType(raw.type),
        scope: raw.scope?.trim() ? raw.scope.trim() : null,
        dryRun: raw.dryRun,
        noVerify: raw.noVerify,
        ci: raw.ci,
        allowInvalid: raw.allowInvalid,
        timeoutMs: raw.timeoutMs
            ? parseBoundedInteger(raw.timeoutMs, "--timeout-ms", MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
            : base.timeoutMs,
        retries: raw.retries
            ? parseBoundedInteger(raw.retries, "--retries", MIN_RETRIES, MAX_RETRIES)
            : base.retries,
        output: parseOutput((raw.output ?? "text").toLowerCase()),
        configPath: raw.config?.trim() ? raw.config.trim() : null,
        candidates: parseOptionalBoundedInteger(raw.candidates, "--candidates", MIN_CANDIDATES, MAX_CANDIDATES),
        ticket: raw.ticket?.trim() ? raw.ticket.trim() : null,
        history: historyExplicit ? (raw.history ?? null) : null
    };
}

function buildDoctorOptions(raw: RawDoctorOptions): WorkflowOptions {
    const base = buildDefaultWorkflowOptions();
    return {
        ...base,
        model: raw.model?.trim() ? raw.model.trim() : base.model,
        host: raw.host?.trim() ? raw.host.trim() : base.host,
        timeoutMs: raw.timeoutMs
            ? parseBoundedInteger(raw.timeoutMs, "--timeout-ms", MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
            : base.timeoutMs,
        retries: raw.retries
            ? parseBoundedInteger(raw.retries, "--retries", MIN_RETRIES, MAX_RETRIES)
            : base.retries,
        configPath: raw.config?.trim() ? raw.config.trim() : null
    };
}

function printJson(result: WorkflowResult): void {
    if (result.ok) {
        const payload: Record<string, unknown> = {
            status: "ok",
            message: result.message,
            source: result.source,
            committed: result.committed
        };

        if (result.scope) payload.scope = result.scope;
        if (result.ticket) payload.ticket = result.ticket;
        if (result.alternatives && result.alternatives.length > 0) {
            payload.alternatives = result.alternatives;
        }

        console.log(JSON.stringify(payload));
        return;
    }

    console.log(JSON.stringify({
        status: "error",
        code: result.code,
        hint: result.hint ?? result.message
    }));
}

function printText(result: WorkflowResult, options: WorkflowOptions): void {
    if (result.ok) {
        if (result.cancelled) {
            console.log("Cancelled.");
            return;
        }

        if (!result.committed) {
            console.log(result.message);
            return;
        }

        if (options.ci) {
            console.log(result.message);
        } else {
            console.log(`Committed: ${getMessageSubject(result.message)}`);
        }
        return;
    }

    console.error(result.message);
    if (result.hint) console.error(result.hint);
}

function printLintResult(result: LintMessageCommandResult, output: OutputFormat): void {
    if (output === "json") {
        if (result.ok) {
            console.log(JSON.stringify({
                status: "ok",
                message: result.message,
                subject: result.subject,
                type: result.type,
                scope: result.scope,
                ticket: result.ticket
            }));
            return;
        }

        console.log(JSON.stringify({
            status: "error",
            code: result.code,
            message: result.message,
            errors: result.errors
        }));
        return;
    }

    if (result.ok) {
        console.log("Commit message is valid.");
        console.log(result.subject);
        return;
    }

    console.error(result.message);
    for (const error of result.errors) {
        console.error(`- ${error}`);
    }
}

function printDoctorResult(result: Awaited<ReturnType<typeof runDoctor>>): void {
    for (const check of result.checks) {
        const label = check.ok ? "OK" : "FAIL";
        console.log(`[${label}] ${check.name}: ${check.detail}`);
    }
}

function getCommandErrorExitCode(error: unknown, fallback: number): number {
    if (error instanceof WorkflowError) return error.exitCode;
    return fallback;
}

function getCliEntrypoint(): string {
    return fileURLToPath(import.meta.url);
}

function getSubcommandArgv(commandName: string): string[] {
    return [process.argv[0] ?? "node", commandName, ...process.argv.slice(3)];
}

async function runGenerateCommand(): Promise<number> {
    const program = new Command();
    program
        .name("commitgen-cc")
        .description("Generate a Conventional Commit message from staged changes using local Ollama")
        .option("-m, --model <name>", "Ollama model name")
        .option("--host <url>", "Ollama host")
        .option("--max-chars <n>", `Max diff characters sent to model (${MIN_MAX_CHARS}-${MAX_MAX_CHARS})`)
        .option("--type <type>", "Force commit type (feat|fix|chore|refactor|docs|test|perf|build|ci)")
        .option("--scope <scope>", "Optional scope, e.g. api, infra")
        .option("--config <path>", "Path to a commitgen config file")
        .option("--candidates <n>", `Generate between ${MIN_CANDIDATES} and ${MAX_CANDIDATES} ranked candidates`)
        .option("--ticket <id>", "Explicit ticket reference, e.g. ABC-123")
        .option("--no-history", "Disable local history examples and persistence")
        .option("--dry-run", "Print message only, do not commit", false)
        .option("--no-verify", "Pass --no-verify to git commit", false)
        .option("--ci", "Non-interactive mode for CI usage", false)
        .option("--allow-invalid", "Allow commit even if validation fails", false)
        .option("--timeout-ms <n>", `Ollama request timeout in milliseconds (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})`)
        .option("--retries <n>", `Retry count for transient Ollama failures (${MIN_RETRIES}-${MAX_RETRIES})`)
        .option("--output <format>", "Output format (text|json)", "text")
        .parse(process.argv);

    let options: WorkflowOptions;
    try {
        const historyExplicit = program.getOptionValueSource("history") === "cli";
        options = buildOptions(program.opts<RawCliOptions>(), historyExplicit);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        return ExitCode.UsageError;
    }

    const result = await runWorkflow(options);
    if (options.output === "json") {
        printJson(result);
    } else {
        printText(result, options);
    }

    return result.exitCode;
}

async function runInstallHookCommand(): Promise<number> {
    const program = new Command();
    program
        .name("commitgen-cc install-hook")
        .description("Install repo-local prepare-commit-msg and commit-msg hooks")
        .option("--config <path>", "Path to a commitgen config file used by the installed hooks")
        .parse(getSubcommandArgv("install-hook"));

    const options = program.opts<RawHookOptions>();

    try {
        const installed = await installHooks(
            getCliEntrypoint(),
            process.execPath,
            options.config?.trim() ? options.config.trim() : null
        );
        console.log(formatHookInstallMessage(installed));
        return ExitCode.Success;
    } catch (error: unknown) {
        console.error(formatHookError(error));
        if (error instanceof WorkflowError && error.hint) console.error(error.hint);
        return getCommandErrorExitCode(error, ExitCode.UsageError);
    }
}

async function runUninstallHookCommand(): Promise<number> {
    const program = new Command();
    program
        .name("commitgen-cc uninstall-hook")
        .description("Remove commitgen-managed local git hooks")
        .parse(getSubcommandArgv("uninstall-hook"));

    try {
        const removed = await uninstallHooks();
        console.log(formatHookUninstallMessage(removed));
        return ExitCode.Success;
    } catch (error: unknown) {
        console.error(formatHookError(error));
        return getCommandErrorExitCode(error, ExitCode.UsageError);
    }
}

async function runLintMessageCommand(): Promise<number> {
    const program = new Command();
    program
        .name("commitgen-cc lint-message")
        .description("Validate a commit message file against Conventional Commits and repo policy")
        .requiredOption("--file <path>", "Path to the commit message file")
        .option("--config <path>", "Path to a commitgen config file")
        .option("--output <format>", "Output format (text|json)", "text")
        .parse(getSubcommandArgv("lint-message"));

    try {
        const options = program.opts<RawLintOptions>();
        const output = parseOutput((options.output ?? "text").toLowerCase());
        const result = await lintMessageFile(options.file, options.config?.trim() ? options.config.trim() : null);
        printLintResult(result, output);
        return result.exitCode;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        return ExitCode.UsageError;
    }
}

async function runDoctorCommand(): Promise<number> {
    const program = new Command();
    program
        .name("commitgen-cc doctor")
        .description("Verify Node, repo, config, Ollama, and model availability")
        .option("-m, --model <name>", "Ollama model name override")
        .option("--host <url>", "Ollama host override")
        .option("--config <path>", "Path to a commitgen config file")
        .option("--timeout-ms <n>", `Ollama request timeout in milliseconds (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})`)
        .option("--retries <n>", `Retry count for transient Ollama failures (${MIN_RETRIES}-${MAX_RETRIES})`)
        .parse(getSubcommandArgv("doctor"));

    try {
        const options = buildDoctorOptions(program.opts<RawDoctorOptions>());
        const result = await runDoctor(options);
        printDoctorResult(result);
        return result.exitCode;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        return ExitCode.UsageError;
    }
}

async function runInternalHookCommand(): Promise<number> {
    const hookName = process.argv[3];
    const configPath = process.env.COMMITGEN_CONFIG_PATH?.trim() || null;

    if (hookName === "prepare-commit-msg") {
        const messageFile = process.argv[4];
        const source = process.argv[5];
        if (!messageFile) {
            console.error("Missing prepare-commit-msg file path.");
            return ExitCode.UsageError;
        }
        return await runPrepareCommitMsgHook(messageFile, configPath, source);
    }

    if (hookName === "commit-msg") {
        const messageFile = process.argv[4];
        if (!messageFile) {
            console.error("Missing commit-msg file path.");
            return ExitCode.UsageError;
        }
        return await runCommitMsgHook(messageFile, configPath);
    }

    console.error(`Unknown internal hook "${hookName ?? ""}".`);
    return ExitCode.UsageError;
}

async function main(): Promise<number> {
    const command = process.argv[2];

    if (command === "install-hook") {
        return await runInstallHookCommand();
    }
    if (command === "uninstall-hook") {
        return await runUninstallHookCommand();
    }
    if (command === "doctor") {
        return await runDoctorCommand();
    }
    if (command === "lint-message") {
        return await runLintMessageCommand();
    }
    if (command === "__internal-hook") {
        return await runInternalHookCommand();
    }

    return await runGenerateCommand();
}

main()
    .then((exitCode) => {
        process.exit(exitCode);
    })
    .catch((error: unknown) => {
        console.error(error instanceof Error ? error.stack : String(error));
        process.exit(ExitCode.InternalError);
    });
