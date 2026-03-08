import { escapeRegExp, normalizeScopeName } from "./util.js";

export type AllowedType = "feat" | "fix" | "chore" | "refactor" | "docs" | "test" | "perf" | "build" | "ci";

export const ALLOWED_TYPES: AllowedType[] = ["feat", "fix", "chore", "refactor", "docs", "test", "perf", "build", "ci"];
export const ALLOWED_TYPES_SET = new Set<AllowedType>(ALLOWED_TYPES);
export const DEFAULT_SUBJECT_MAX_LENGTH = 72;

export type ValidationResult = { ok: true } | { ok: false, reason: string };
export type ParsedSubject = { type: string, scope: string | null, description: string };
type ValidationOptions = {
    subjectMaxLength?: number;
    allowedTypes?: readonly string[];
};

const SUBJECT_REGEX = /^([a-z]+)(\([^)]+\))?!?:\s(.+)$/;

export function isAllowedType(value: string): value is AllowedType {
    return ALLOWED_TYPES_SET.has(value as AllowedType);
}

export function normalizeMessage(input: string): string {
    const lines = (input ?? "")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/g, ""));

    while (lines.length > 0 && lines[0] === "") lines.shift();
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    return lines.join("\n");
}

function stripWrappingCodeFence(input: string): string {
    const trimmed = (input ?? "").trim();
    const match = trimmed.match(/^```(?:json|txt|text)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : trimmed;
}

function parseJsonPayload(input: string): unknown | null {
    try {
        return JSON.parse(input) as unknown;
    } catch {
        return null;
    }
}

function parseEmbeddedJsonPayload(input: string): unknown | null {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start >= 0 && end > start) {
        return parseJsonPayload(input.slice(start, end + 1));
    }

    const arrayStart = input.indexOf("[");
    const arrayEnd = input.lastIndexOf("]");
    if (arrayStart < 0 || arrayEnd <= arrayStart) return null;

    return parseJsonPayload(input.slice(arrayStart, arrayEnd + 1));
}

function parseMessageFromPayload(payload: unknown): string | null {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    if (!("message" in payload)) return null;

    const value = payload.message;
    return typeof value === "string" ? value : null;
}

function normalizeMessageList(messages: string[]): string[] {
    return messages
        .map((message) => normalizeMessage(stripWrappingCodeFence(message)))
        .filter((message) => message.length > 0);
}

function parseMessageListFromPayload(payload: unknown): string[] | null {
    if (Array.isArray(payload)) {
        if (payload.every((entry) => typeof entry === "string")) {
            return normalizeMessageList(payload);
        }
        return null;
    }

    if (!payload || typeof payload !== "object") return null;
    if (!("messages" in payload)) return null;

    const value = payload.messages;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return null;

    return normalizeMessageList(value as string[]);
}

export function extractMessageFromModelOutput(raw: string): string {
    const noFence = stripWrappingCodeFence(raw ?? "");
    const payload = parseJsonPayload(noFence) ?? parseEmbeddedJsonPayload(noFence);
    const jsonMessage = parseMessageFromPayload(payload);
    const candidate = jsonMessage ?? noFence;
    return normalizeMessage(stripWrappingCodeFence(candidate));
}

export function extractMessageListFromModelOutput(raw: string): string[] | null {
    const noFence = stripWrappingCodeFence(raw ?? "");
    const payload = parseJsonPayload(noFence) ?? parseEmbeddedJsonPayload(noFence);
    const messages = parseMessageListFromPayload(payload);
    return messages && messages.length > 0 ? messages : null;
}

export function validateMessage(message: string, opts: ValidationOptions = {}): ValidationResult {
    const normalized = normalizeMessage(message);
    if (!normalized) return { ok: false, reason: "Message is empty" };
    if (normalized.includes("```")) return { ok: false, reason: "No markdown/code fences" };

    const subject = normalized.split("\n")[0].trim();
    const subjectMaxLength = opts.subjectMaxLength ?? DEFAULT_SUBJECT_MAX_LENGTH;
    const allowedTypes = opts.allowedTypes ?? ALLOWED_TYPES;
    if (!subject) return { ok: false, reason: "Subject line is empty" };
    if (subject.length > subjectMaxLength) return { ok: false, reason: `Subject line > ${subjectMaxLength} chars` };
    if (subject.endsWith(".")) return { ok: false, reason: "Subject should not end with a period" };

    const conventional = subject.match(SUBJECT_REGEX);
    if (!conventional) return { ok: false, reason: "Not Conventional Commits format" };

    const type = conventional[1];
    if (!allowedTypes.includes(type)) {
        return { ok: false, reason: `Type must be one of: ${allowedTypes.join(", ")}` };
    }

    return { ok: true };
}

export function inferTypeFromDiff(diff: string): AllowedType | null {
    const filePattern = /^diff --git a\/(.+?) b\/(.+)$/gm;
    const files: string[] = [];
    for (const match of diff.matchAll(filePattern)) {
        const file = match[2]?.trim();
        if (file) files.push(file.toLowerCase());
    }

    if (files.length === 0) return null;

    if (files.every(isDocumentationFile)) return "docs";
    if (files.every(isTestFile)) return "test";
    if (files.every(isCiFile)) return "ci";
    if (files.every(isBuildFile)) return "build";

    return null;
}

type RepairOptions = {
    message: string;
    diff: string;
    forcedType: AllowedType | null;
    scope: string | null;
    ticket?: string | null;
};

export type RepairResult = {
    message: string;
    didRepair: boolean;
};

export function parseConventionalSubject(subject: string): ParsedSubject | null {
    const typed = subject.match(/^([A-Za-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
    if (!typed) return null;
    return {
        type: typed[1].toLowerCase(),
        scope: typed[2] ? normalizeScopeName(typed[2]) : null,
        description: typed[3].trim()
    };
}

export function messageMentionsTicket(message: string, ticket: string | null): boolean {
    if (!ticket) return false;
    return new RegExp(`\\b${escapeRegExp(ticket)}\\b`).test(message);
}

export function appendTicketFooter(message: string, ticket: string | null): string {
    const normalized = normalizeMessage(message);
    if (!ticket || !normalized || messageMentionsTicket(normalized, ticket)) {
        return normalized;
    }

    return normalizeMessage(`${normalized}\n\nRefs ${ticket}`);
}

function parseLooseTypedSubject(subject: string): { type: string, description: string } | null {
    const loose = subject.match(/^([A-Za-z]+)\s*[-:]\s*(.+)$/);
    if (!loose) return null;
    return {
        type: loose[1].toLowerCase(),
        description: loose[2].trim()
    };
}

function normalizeDescription(description: string): string {
    const cleaned = description
        .trim()
        .replace(/\.$/, "")
        .replace(/\s+/g, " ");
    return cleaned || "update project files";
}

export function repairMessage(options: RepairOptions): RepairResult {
    const original = normalizeMessage(stripWrappingCodeFence(options.message));
    if (!original) return { message: original, didRepair: false };

    const lines = original.split("\n");
    const originalSubject = lines[0].trim().replace(/^["'`]+|["'`]+$/g, "").trim();
    const body = normalizeMessage(lines.slice(1).join("\n"));
    const bodyBlock = body ? `\n\n${body}` : "";

    const forcedType = options.forcedType;
    const normalizedScope = normalizeScopeName(options.scope);
    const inferredType = forcedType ?? inferTypeFromDiff(options.diff);

    let selectedType: AllowedType | null = null;
    let selectedScope: string | null = null;
    let description = originalSubject;

    const typed = parseConventionalSubject(originalSubject);
    if (typed) {
        if (isAllowedType(typed.type)) selectedType = typed.type;
        selectedScope = typed.scope;
        description = typed.description;
    } else {
        const loose = parseLooseTypedSubject(originalSubject);
        if (loose && isAllowedType(loose.type)) {
            selectedType = loose.type;
            description = loose.description;
        }
    }

    if (forcedType) selectedType = forcedType;
    if (!selectedType && inferredType) selectedType = inferredType;
    if (normalizedScope) selectedScope = normalizedScope;

    description = normalizeDescription(description);

    let repairedSubject: string;
    if (selectedType) {
        const scopePart = selectedScope ? `(${selectedScope})` : "";
        repairedSubject = `${selectedType}${scopePart}: ${description}`;
    } else {
        repairedSubject = description;
    }

    const repaired = appendTicketFooter(`${repairedSubject}${bodyBlock}`, options.ticket ?? null);
    return {
        message: repaired,
        didRepair: repaired !== original
    };
}

function isDocumentationFile(path: string): boolean {
    return path.startsWith("docs/")
        || path.endsWith(".md")
        || path.endsWith(".mdx")
        || path.endsWith(".rst")
        || path.includes("/docs/");
}

function isTestFile(path: string): boolean {
    return path.includes("/test/")
        || path.includes("/tests/")
        || path.includes("__tests__")
        || path.endsWith(".spec.ts")
        || path.endsWith(".test.ts")
        || path.endsWith(".spec.js")
        || path.endsWith(".test.js");
}

function isCiFile(path: string): boolean {
    return path.startsWith(".github/workflows/")
        || path.startsWith(".gitlab-ci")
        || path.startsWith(".circleci/")
        || path.startsWith("azure-pipelines");
}

function isBuildFile(path: string): boolean {
    return path === "package-lock.json"
        || path === "yarn.lock"
        || path === "pnpm-lock.yaml"
        || path === "package.json"
        || path.endsWith("/dockerfile")
        || path.endsWith("/docker-compose.yml");
}
