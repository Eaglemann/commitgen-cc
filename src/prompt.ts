import type { ChatMessage } from "./ollama.js";

type AllowedType = "feat" | "fix" | "chore" | "refactor" | "docs" | "test" | "perf" | "build" | "ci";

const DEFAULT_PROMPT_FILE_HINTS = 10;
const DEFAULT_PROMPT_HISTORY_EXAMPLES = 3;

function buildSystemMessage(candidateCount: number): string {
    const responseRule = candidateCount > 1
        ? `- Output ONLY a valid JSON object with exactly one key: { "messages": ["...", "..."] }
- Return exactly ${candidateCount} commit messages in the "messages" array.`
        : "- Output ONLY a valid JSON object with exactly one key: { \"message\": \"...\" }";

    return `You write excellent git commit messages.

Rules:
${responseRule}
- Do not include any keys other than "message" or "messages".
- NO markdown and NO commentary.
- Use Conventional Commits: type(scope optional): subject
- Allowed types: feat, fix, chore, refactor, docs, test, perf, build, ci
- Subject line: <= 72 chars, imperative mood, present tense, NO trailing period.
- If really useful, add a blank line and a short body explaining "what" and "why".
- If a ticket is provided, prefer a footer line in the form "Refs TICKET-123" rather than adding it to the subject.
- Never mention that you are an AI.
- Keep it short and simple and dont be chatty.
- Do not use "!" (breaking change) unless the diff contains significant breaking changes.`;
}

function formatList(
    label: string,
    items: string[],
    limit: number
): string {
    if (items.length === 0) return `${label}: unavailable`;

    const visible = items.slice(0, limit);
    const suffix = items.length > visible.length
        ? ` (showing ${visible.length} of ${items.length})`
        : "";

    return `${label}${suffix}:\n${visible.map((item) => `- ${item}`).join("\n")}`;
}

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
    candidateCount?: number;
}): ChatMessage[] {
    const candidateCount = Math.max(1, Math.floor(opts.candidateCount ?? 1));
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
        formatList("Changed files", opts.files, DEFAULT_PROMPT_FILE_HINTS),
        opts.knownScopes && opts.knownScopes.length > 0
            ? `Preferred scopes: ${opts.knownScopes.join(", ")}`
            : null,
        opts.recentExamples.length > 0
            ? formatList("Recent accepted commit examples", opts.recentExamples, DEFAULT_PROMPT_HISTORY_EXAMPLES)
            : null
    ]
        .filter((entry): entry is string => Boolean(entry))
        .join("\n\n");

    const batchInstruction = candidateCount > 1
        ? `Generate ${candidateCount} distinct candidate commit messages and keep them concise.`
        : "Generate one specific and concise Conventional Commit message.";
    const responseShape = candidateCount > 1
        ? `Return JSON only, exactly in this shape: { "messages": ["...", "..."] }. Return exactly ${candidateCount} messages.`
        : 'Return JSON only, exactly in this shape: { "message": "..." }.';
    const user = `Task: ${batchInstruction}

Constraints:
${constraints}

Repository Context:
${repoHints}

Input Data:
--- BEGIN DIFF ---
${opts.diff}
--- END DIFF ---

${responseShape}`;

    return [
        { role: "system", content: buildSystemMessage(candidateCount) },
        { role: "user", content: user }
    ];
}
