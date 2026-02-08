export type AllowedType = "feat" | "fix" | "chore" | "refactor" | "docs" | "test" | "perf" | "build" | "ci";

export const ALLOWED_TYPES: AllowedType[] = ["feat", "fix", "chore", "refactor", "docs", "test", "perf", "build", "ci"];
export const ALLOWED_TYPES_SET = new Set<AllowedType>(ALLOWED_TYPES);

export type ValidationResult = { ok: true } | { ok: false, reason: string };

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

function parseMessageFromJson(input: string): string | null {
    try {
        const parsed = JSON.parse(input) as unknown;
        if (!parsed || typeof parsed !== "object") return null;
        if (!("message" in parsed)) return null;

        const value = parsed.message;
        return typeof value === "string" ? value : null;
    } catch {
        return null;
    }
}

function parseMessageFromEmbeddedJson(input: string): string | null {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start < 0 || end <= start) return null;

    const block = input.slice(start, end + 1);
    return parseMessageFromJson(block);
}

export function extractMessageFromModelOutput(raw: string): string {
    const noFence = stripWrappingCodeFence(raw ?? "");
    const jsonMessage = parseMessageFromJson(noFence) ?? parseMessageFromEmbeddedJson(noFence);
    const candidate = jsonMessage ?? noFence;
    return normalizeMessage(stripWrappingCodeFence(candidate));
}

export function validateMessage(message: string): ValidationResult {
    const normalized = normalizeMessage(message);
    if (!normalized) return { ok: false, reason: "Message is empty" };
    if (normalized.includes("```")) return { ok: false, reason: "No markdown/code fences" };

    const subject = normalized.split("\n")[0].trim();
    if (!subject) return { ok: false, reason: "Subject line is empty" };
    if (subject.length > 72) return { ok: false, reason: "Subject line > 72 chars" };
    if (subject.endsWith(".")) return { ok: false, reason: "Subject should not end with a period" };

    const conventional = subject.match(SUBJECT_REGEX);
    if (!conventional) return { ok: false, reason: "Not Conventional Commits format" };

    const type = conventional[1];
    if (!isAllowedType(type)) {
        return { ok: false, reason: `Type must be one of: ${ALLOWED_TYPES.join(", ")}` };
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
};

export type RepairResult = {
    message: string;
    didRepair: boolean;
};

function normalizeScope(scope: string | null): string | null {
    if (!scope) return null;
    const compact = scope.trim().replace(/\s+/g, "-").replace(/[()]/g, "");
    return compact || null;
}

function parseTypedSubject(subject: string): { type: string, scope: string | null, description: string } | null {
    const typed = subject.match(/^([A-Za-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
    if (!typed) return null;
    return {
        type: typed[1].toLowerCase(),
        scope: typed[2] ? typed[2].trim() : null,
        description: typed[3].trim()
    };
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
    const normalizedScope = normalizeScope(options.scope);
    const inferredType = forcedType ?? inferTypeFromDiff(options.diff);

    let selectedType: AllowedType | null = null;
    let selectedScope: string | null = null;
    let description = originalSubject;

    const typed = parseTypedSubject(originalSubject);
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

    const repaired = normalizeMessage(`${repairedSubject}${bodyBlock}`);
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
