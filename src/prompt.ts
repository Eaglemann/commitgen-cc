import type { ChatMessage } from "./ollama.js";

type AllowedType = "feat" | "fix" | "chore" | "refactor" | "docs" | "test" | "perf" | "build" | "ci";

const SYSTEM = `You write excellent git commit messages.

Rules:
- Output ONLY valid JSON object with exactly one key: { "message": "..." }
- Do not include any keys other than "message".
- NO markdown and NO commentary.
- Use Conventional Commits: type(scope optional): subject
- Allowed types: feat, fix, chore, refactor, docs, test, perf, build, ci
- Subject line: <= 72 chars, imperative mood, present tense, NO trailing period.
- If really useful, add a blank line and a short body explaining "what" and "why".
- If a ticket is provided, prefer a footer line in the form "Refs TICKET-123" rather than adding it to the subject.
- Never mention that you are an AI.
- Keep it short and simple and dont be chatty.
- Do not use "!" (breaking change) unless the diff contains significant breaking changes.`;

export function buildMessages(opts: {
    diff: string;
    files: string[];
    branch: string | null;
    suggestedScope: string | null;
    ticket: string | null;
    recentExamples: string[];
    forcedType: AllowedType | null;
    forcedScope: string | null;
    knownScopes?: string[];
}): ChatMessage[] {
    const constraints = [
        opts.forcedType ? `Forced type: ${opts.forcedType}` : "Choose the best type from allowed list.",
        opts.forcedScope
            ? `Forced scope: ${opts.forcedScope}`
            : opts.suggestedScope
                ? `Suggested scope: ${opts.suggestedScope}`
                : "Use a scope only if it helps; otherwise omit.",
        opts.ticket ? `Associated ticket: ${opts.ticket}` : "No explicit ticket was provided."
    ].join("\n");

    const repoHints = [
        opts.branch ? `Branch: ${opts.branch}` : "Branch: unavailable",
        opts.files.length > 0
            ? `Changed files:\n${opts.files.slice(0, 25).map((file) => `- ${file}`).join("\n")}`
            : "Changed files: unavailable",
        opts.knownScopes && opts.knownScopes.length > 0
            ? `Preferred scopes: ${opts.knownScopes.join(", ")}`
            : null,
        opts.recentExamples.length > 0
            ? `Recent accepted commit examples:\n${opts.recentExamples.map((example, index) => `${index + 1}. ${example}`).join("\n")}`
            : null
    ]
        .filter((entry): entry is string => Boolean(entry))
        .join("\n\n");

    const user = `Task: Generate a specific and concise Conventional Commit message for the following git diff.

Constraints:
${constraints}

Repository Context:
${repoHints}

Input Data:
--- BEGIN DIFF ---
${opts.diff}
--- END DIFF ---

Return JSON only, exactly in this shape: { "message": "..." }.`;

    return [
        { role: "system", content: SYSTEM },
        { role: "user", content: user }
    ];
}
