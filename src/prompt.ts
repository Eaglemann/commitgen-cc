import type { ChatMessage } from "./ollama.js";
import type { CommitPolicy } from "./policy.js";

type AllowedType = "feat" | "fix" | "chore" | "refactor" | "docs" | "test" | "perf" | "build" | "ci";

const DEFAULT_PROMPT_FILE_HINTS = 10;
const DEFAULT_PROMPT_HISTORY_EXAMPLES = 3;

function buildSystemMessage(candidateCount: number, policy: CommitPolicy): string {
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
- Allowed types: ${policy.allowedTypes.join(", ")}
- Subject line: <= ${policy.subjectMaxLength} chars, imperative mood, present tense, NO trailing period.
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
    policy: CommitPolicy;
    revisionRequest?: {
        currentMessage: string;
        feedback: string;
    };
}): ChatMessage[] {
    const candidateCount = Math.max(1, Math.floor(opts.candidateCount ?? 1));
    const constraints = [
        opts.forcedType ? `Forced type: ${opts.forcedType}` : `Choose the best type from: ${opts.policy.allowedTypes.join(", ")}.`,
        opts.forcedScope
            ? `Forced scope: ${opts.forcedScope}`
            : opts.suggestedScope
                ? `Suggested scope: ${opts.suggestedScope}`
                : "Use a scope only if it helps; otherwise omit.",
        opts.policy.requiredScopes.length > 0
            ? `Scope is required and must be one of: ${opts.policy.requiredScopes.join(", ")}.`
            : "Scope is optional unless it adds clarity.",
        opts.ticket
            ? `Associated ticket: ${opts.ticket}`
            : opts.policy.requireTicket
                ? "A ticket reference is required if one can be inferred. Do not invent a fake ticket."
                : "No explicit ticket was provided.",
        opts.policy.bodyRequiredTypes.length > 0
            ? `Add a short body when the type is: ${opts.policy.bodyRequiredTypes.join(", ")}.`
            : "Body is optional unless it adds useful context."
    ].join("\n");

    const repoHints = [
        opts.branch ? `Branch: ${opts.branch}` : "Branch: unavailable",
        formatList("Changed files", opts.files, DEFAULT_PROMPT_FILE_HINTS),
        opts.knownScopes && opts.knownScopes.length > 0
            ? `Preferred scopes: ${opts.knownScopes.join(", ")}`
            : null,
        Object.keys(opts.policy.scopeMap).length > 0
            ? `Scope map: ${Object.entries(opts.policy.scopeMap).map(([path, scope]) => `${path} -> ${scope}`).join(", ")}`
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
    const taskInstruction = opts.revisionRequest
        ? "Revise the existing commit message based on the user feedback while preserving the repository intent and constraints."
        : batchInstruction;
    const responseShape = candidateCount > 1
        ? `Return JSON only, exactly in this shape: { "messages": ["...", "..."] }. Return exactly ${candidateCount} messages.`
        : 'Return JSON only, exactly in this shape: { "message": "..." }.';
    const revisionContext = opts.revisionRequest
        ? `Current Message:
${opts.revisionRequest.currentMessage}

Revision Feedback:
${opts.revisionRequest.feedback}

`
        : "";
    const user = `Task: ${taskInstruction}

Constraints:
${constraints}

Repository Context:
${repoHints}

Input Data:
--- BEGIN DIFF ---
${opts.diff}
--- END DIFF ---

${revisionContext}${responseShape}`;

    return [
        { role: "system", content: buildSystemMessage(candidateCount, opts.policy) },
        { role: "user", content: user }
    ];
}
