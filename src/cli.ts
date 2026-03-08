#!/usr/bin/env node
import { Command } from "commander";
import { DEFAULT_RETRIES, DEFAULT_TIMEOUT_MS } from "./config.js";
import { ExitCode } from "./exit-codes.js";
import { getMessageSubject } from "./finalize.js";
import { parseBoundedInteger } from "./util.js";
import { isAllowedType, type AllowedType } from "./validation.js";
import { runWorkflow, type OutputFormat, type WorkflowOptions, type WorkflowResult } from "./workflow.js";

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

function readEnv(name: string): string | null {
    const value = process.env[name]?.trim();
    return value && value.length > 0 ? value : null;
}

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
    return {
        model: raw.model?.trim() ? raw.model.trim() : readEnv("GIT_AI_MODEL"),
        host: raw.host?.trim() ? raw.host.trim() : readEnv("GIT_AI_HOST"),
        maxChars: parseOptionalBoundedInteger(raw.maxChars, "--max-chars", MIN_MAX_CHARS, MAX_MAX_CHARS),
        type: parseType(raw.type),
        scope: raw.scope?.trim() ? raw.scope.trim() : null,
        dryRun: raw.dryRun,
        noVerify: raw.noVerify,
        ci: raw.ci,
        allowInvalid: raw.allowInvalid,
        timeoutMs: parseBoundedInteger(
            raw.timeoutMs ?? readEnv("GIT_AI_TIMEOUT_MS") ?? String(DEFAULT_TIMEOUT_MS),
            "--timeout-ms",
            MIN_TIMEOUT_MS,
            MAX_TIMEOUT_MS
        ),
        retries: parseBoundedInteger(
            raw.retries ?? readEnv("GIT_AI_RETRIES") ?? String(DEFAULT_RETRIES),
            "--retries",
            MIN_RETRIES,
            MAX_RETRIES
        ),
        output: parseOutput((raw.output ?? "text").toLowerCase()),
        configPath: raw.config?.trim() ? raw.config.trim() : null,
        candidates: parseOptionalBoundedInteger(raw.candidates, "--candidates", MIN_CANDIDATES, MAX_CANDIDATES),
        ticket: raw.ticket?.trim() ? raw.ticket.trim() : null,
        history: historyExplicit ? (raw.history ?? null) : null
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

async function main(): Promise<void> {
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
        process.exit(ExitCode.UsageError);
    }

    const result = await runWorkflow(options);
    if (options.output === "json") {
        printJson(result);
    } else {
        printText(result, options);
    }

    process.exit(result.exitCode);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(ExitCode.InternalError);
});
