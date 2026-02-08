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
- Never mention that you are an AI.
- Keep it short and simple and dont be chatty.
- Do not use "!" (breaking change) unless the diff contains significant breaking changes.`;

export function buildMessages(opts: {
    diff: string;
    forcedType: AllowedType | null;
    scope: string | null;
}): ChatMessage[] {
    const constraints = [
        opts.forcedType ? `Forced type: ${opts.forcedType}` : "Choose the best type from allowed list.",
        opts.scope ? `Use scope: ${opts.scope}` : "Use a scope only if it helps; otherwise omit."
    ].join("\n");

    const user = `Task: Generate a specific and concise Conventional Commit message for the following git diff.

Constraints:
${constraints}

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
