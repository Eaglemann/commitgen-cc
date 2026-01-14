#!/usr/bin/env node
import { Command } from "commander";
import prompts from "prompts";
import { isGitRepo, hasStagedChanges, getStagedDiff, gitCommit } from "./git.js";
import { ollamaChat, checkOllamaConnection } from "./ollama.js";
import { buildMessages } from "./prompt.js";
import { clampDiff } from "./util.js";

type AllowedType = "feat" | "fix" | "chore" | "refactor" | "docs" | "test" | "perf" | "build" | "ci";
const ALLOWED_TYPES = new Set<AllowedType>(["feat", "fix", "chore", "refactor", "docs", "test", "perf", "build", "ci"]);


function validateMessage(msg: string): { ok: true } | { ok: false, reason: string } {
    const s = (msg ?? "").trim();
    if (!s) return { ok: false, reason: "Message is empty" };
    if (s.length > 72) return { ok: false, reason: "Message is too long" };
    if (s.includes("```")) return { ok: false, reason: "No markdown/code fences" };

    const firtstLine = s.split("\n")[0].trim();
    const cc = /^([a-z]+)(\([^)]+\))?!?:\s.+$/;
    if (!cc.test(firtstLine)) return { ok: false, reason: "Not Conventional Commits format" };

    const type = firtstLine.match(/^([a-z]+)\b/)?.[1] as AllowedType | undefined;
    if (!type || !ALLOWED_TYPES.has(type)) {
        return { ok: false, reason: `Type must be one of: ${[...ALLOWED_TYPES].join(", ")}` };
    }

    if (firtstLine.length > 72) return { ok: false, reason: "Subject line > 72 chars" };
    if (firtstLine.endsWith(".")) return { ok: false, reason: "Subject should not end with a period" };

    return { ok: true };
}



async function main() {
    // ... (keep program definition)
    const program = new Command();

    program
        .name("git-ai-commit")
        // ... (keep options)
        .description("Generate a Conventional Commit message from staged changes using local Ollama")
        .option("-m, --model <name>", "Ollama model name", "llama3")
        .option("--host <url>", "Ollama host", "http://localhost:11434")
        .option("--max-chars <n>", "Max diff characters sent to model", (v) => parseInt(v, 10), 16000)
        .option("--type <type>", "Force commit type (feat|fix|chore|refactor|docs|test|perf|build|ci)")
        .option("--scope <scope>", "Optional scope, e.g. api, infra")
        .option("--dry-run", "Print message only, do not commit", false)
        .option("--no-verify", "Pass --no-verify to git commit", false)
        .parse(process.argv);

    const opts = program.opts<{
        model: string;
        host: string;
        maxChars: number;
        type?: string;
        scope?: string;
        dryRun: boolean;
        noVerify: boolean;
    }>();

    if (!(await isGitRepo())) {
        console.error("Not a git repository.");
        process.exit(1);
    }

    if (!(await hasStagedChanges())) {
        console.error("No staged changes. Stage files first: git add <files>.");
        process.exit(1);
    }

    // Check Ollama connection first
    const isUp = await checkOllamaConnection(opts.host);
    if (!isUp) {
        console.error(`Cannot reach Ollama at ${opts.host}. Is it running?`);
        console.error("Try running 'ollama list' or 'ollama serve' in another terminal.");
        process.exit(1);
    }

    if (opts.type && !ALLOWED_TYPES.has(opts.type as AllowedType)) {
        console.error(`Invalid --type. Must be one of: ${[...ALLOWED_TYPES].join(", ")}`);
        process.exit(1);
    }

    const stagedDiff = await getStagedDiff();
    const diff = clampDiff(stagedDiff, opts.maxChars);

    while (true) {
        const messages = buildMessages({
            diff,
            forcedType: (opts.type as AllowedType) ?? null,
            scope: opts.scope ?? null
        });

        process.stdout.write("⏳ Generating commit message... ");

        let suggestion = "";
        try {
            const raw = (await ollamaChat({
                host: opts.host,
                model: opts.model,
                messages,
                json: true
            })).trim();

            try {
                const parsed = JSON.parse(raw);
                suggestion = parsed.message ?? raw;
            } catch {
                // Fallback if model ignored json mode (rare)
                suggestion = raw;
            }

            // Auto-fix: remove trailing period
            if (suggestion.endsWith(".")) {
                suggestion = suggestion.slice(0, -1);
            }

            process.stdout.write("Done!\n");
        } catch (e) {
            process.stdout.write("Failed.\n");
            console.error(e instanceof Error ? e.message : String(e));
            process.exit(1);
        }

        const v = validateMessage(suggestion);
        if (!v.ok) console.warn(`AI output validation failed: ${v.reason}`);

        console.log("\n--- Suggested commit message ---\n");
        console.log(suggestion);
        console.log("\n-------------------------------\n");

        const { action } = await prompts({
            type: "select",
            name: "action",
            message: "What next?",
            choices: [
                { title: "✅ Accept and commit", value: "accept" },
                { title: "✏️  Edit", value: "edit" },
                { title: "🔁 Regenerate", value: "regen" },
                { title: "🧪 Dry-run (print only)", value: "dry" },
                { title: "❌ Cancel", value: "cancel" }
            ],
            initial: 0
        });

        // ... (keep rest of loop)
        if (!action || action === "cancel") {
            console.log("Cancelled.");
            process.exit(0);
        }
        if (action === "regen") continue;

        let finalMsg = suggestion;

        if (action === "edit") {
            const { msg } = await prompts({
                type: "text",
                name: "msg",
                message: "Edit commit message",
                initial: finalMsg
            });
            if (!msg) {
                console.log("Cancelled.");
                process.exit(0);
            }
            finalMsg = String(msg).trim();
        }

        if (action === "dry" || opts.dryRun) {
            console.log(finalMsg);
            process.exit(0);
        }

        const v2 = validateMessage(finalMsg);
        if (!v2.ok) {
            const { yes } = await prompts({
                type: "confirm",
                name: "yes",
                message: `Still fails validation (${v2.reason}). Commit anyway?`,
                initial: false
            });
            if (!yes) continue;
        }

        await gitCommit(finalMsg, { noVerify: opts.noVerify });
        console.log("Committed.");
        process.exit(0);
    }
}

main().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
});