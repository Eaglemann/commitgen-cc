#!/usr/bin/env node
import { Command } from "commander";
import { ExitCode } from "./exit-codes.js";
import { parseBoundedInteger } from "./util.js";
import { isAllowedType, type AllowedType } from "./validation.js";
import { runWorkflow, type OutputFormat, type WorkflowOptions, type WorkflowResult } from "./workflow.js";

const MIN_MAX_CHARS = 500;
const MAX_MAX_CHARS = 200000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 300000;
const MIN_RETRIES = 0;
const MAX_RETRIES = 5;

type RawCliOptions = {
    model: string;
    host: string;
    maxChars: string;
    type?: string;
    scope?: string;
    dryRun: boolean;
    noVerify: boolean;
    ci: boolean;
    allowInvalid: boolean;
    timeoutMs: string;
    retries: string;
    output: string;
};

function readEnv(name: string, fallback: string): string {
    const value = process.env[name]?.trim();
    return value && value.length > 0 ? value : fallback;
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

function buildOptions(raw: RawCliOptions): WorkflowOptions {
    const model = raw.model.trim();
    if (!model) throw new Error("--model must be a non-empty string.");

    const host = raw.host.trim();
    if (!host) throw new Error("--host must be a non-empty URL.");

    return {
        model,
        host,
        maxChars: parseBoundedInteger(raw.maxChars, "--max-chars", MIN_MAX_CHARS, MAX_MAX_CHARS),
        type: parseType(raw.type),
        scope: raw.scope?.trim() ? raw.scope.trim() : null,
        dryRun: raw.dryRun,
        noVerify: raw.noVerify,
        ci: raw.ci,
        allowInvalid: raw.allowInvalid,
        timeoutMs: parseBoundedInteger(raw.timeoutMs, "--timeout-ms", MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
        retries: parseBoundedInteger(raw.retries, "--retries", MIN_RETRIES, MAX_RETRIES),
        output: parseOutput(raw.output.toLowerCase())
    };
}

function printJson(result: WorkflowResult): void {
    if (result.ok) {
        console.log(JSON.stringify({
            status: "ok",
            message: result.message,
            source: result.source,
            committed: result.committed
        }));
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
            console.log("Committed.");
        }
        return;
    }

    console.error(result.message);
    if (result.hint) console.error(result.hint);
}

async function main(): Promise<void> {
    const program = new Command();
    program
        .name("git-ai-commit")
        .description("Generate a Conventional Commit message from staged changes using local Ollama")
        .option("-m, --model <name>", "Ollama model name", readEnv("GIT_AI_MODEL", "llama3"))
        .option("--host <url>", "Ollama host", readEnv("GIT_AI_HOST", "http://localhost:11434"))
        .option("--max-chars <n>", `Max diff characters sent to model (${MIN_MAX_CHARS}-${MAX_MAX_CHARS})`, "16000")
        .option("--type <type>", "Force commit type (feat|fix|chore|refactor|docs|test|perf|build|ci)")
        .option("--scope <scope>", "Optional scope, e.g. api, infra")
        .option("--dry-run", "Print message only, do not commit", false)
        .option("--no-verify", "Pass --no-verify to git commit", false)
        .option("--ci", "Non-interactive mode for CI usage", false)
        .option("--allow-invalid", "Allow commit even if validation fails", false)
        .option("--timeout-ms <n>", `Ollama request timeout in milliseconds (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})`, readEnv("GIT_AI_TIMEOUT_MS", "60000"))
        .option("--retries <n>", `Retry count for transient Ollama failures (${MIN_RETRIES}-${MAX_RETRIES})`, readEnv("GIT_AI_RETRIES", "2"))
        .option("--output <format>", "Output format (text|json)", "text")
        .parse(process.argv);

    let options: WorkflowOptions;
    try {
        options = buildOptions(program.opts<RawCliOptions>());
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
