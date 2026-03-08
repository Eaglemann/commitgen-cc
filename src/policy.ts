import type { RepoConfig } from "./config.js";
import { normalizeScopeName } from "./util.js";
import {
    ALLOWED_TYPES,
    DEFAULT_SUBJECT_MAX_LENGTH,
    messageMentionsTicket,
    normalizeMessage,
    parseConventionalSubject,
    validateMessage,
    type AllowedType,
    type ParsedSubject
} from "./validation.js";

export type HookMode = "suggest" | "enforce";

export type CommitPolicy = {
    hookMode: HookMode;
    requireTicket: boolean;
    allowedTypes: AllowedType[];
    requiredScopes: string[];
    scopeMap: Record<string, string>;
    subjectMaxLength: number;
    bodyRequiredTypes: AllowedType[];
};

export type LintMessageResult = {
    ok: boolean;
    normalizedMessage: string;
    subject: string;
    parsedSubject: ParsedSubject | null;
    errors: string[];
    ticket: string | null;
};

function uniqueValues(values: string[]): string[] {
    return [...new Set(values)];
}

function normalizeScopes(scopes: string[] | undefined): string[] {
    return uniqueValues(
        (scopes ?? [])
            .map((scope) => normalizeScopeName(scope))
            .filter((scope): scope is string => Boolean(scope))
    );
}

export function resolveCommitPolicy(config: RepoConfig): CommitPolicy {
    const normalizedScopeMap = Object.fromEntries(
        Object.entries(config.scopeMap ?? {})
            .map(([path, scope]) => [path.trim(), normalizeScopeName(scope)])
            .filter((entry): entry is [string, string] => Boolean(entry[0]) && Boolean(entry[1]))
    );

    return {
        hookMode: config.hookMode ?? "suggest",
        requireTicket: config.requireTicket ?? false,
        allowedTypes: uniqueValues(config.allowedTypes ?? ALLOWED_TYPES) as AllowedType[],
        requiredScopes: normalizeScopes(config.requiredScopes),
        scopeMap: normalizedScopeMap,
        subjectMaxLength: config.subjectMaxLength ?? DEFAULT_SUBJECT_MAX_LENGTH,
        bodyRequiredTypes: uniqueValues(config.bodyRequiredTypes ?? []) as AllowedType[]
    };
}

function getMessageBody(message: string): string {
    return normalizeMessage(message.split("\n").slice(1).join("\n"));
}

function extractTicket(message: string, ticketPattern: string): string | null {
    const match = message.match(new RegExp(ticketPattern));
    if (!match) return null;

    const ticket = match[1] ?? match[0];
    return ticket?.trim() || null;
}

export function lintCommitMessage(
    message: string,
    policy: CommitPolicy,
    ticketPattern: string
): LintMessageResult {
    const normalizedMessage = normalizeMessage(message);
    const subject = normalizedMessage.split("\n")[0]?.trim() ?? "";
    const parsedSubject = parseConventionalSubject(subject);
    const ticket = extractTicket(normalizedMessage, ticketPattern);

    const errors: string[] = [];
    const baseValidation = validateMessage(normalizedMessage, {
        subjectMaxLength: policy.subjectMaxLength,
        allowedTypes: policy.allowedTypes
    });

    if (!baseValidation.ok) {
        errors.push(baseValidation.reason);
    }

    if (policy.requiredScopes.length > 0) {
        const scope = normalizeScopeName(parsedSubject?.scope);
        if (!scope) {
            errors.push(`Scope is required and must be one of: ${policy.requiredScopes.join(", ")}.`);
        } else if (!policy.requiredScopes.includes(scope)) {
            errors.push(`Scope must be one of: ${policy.requiredScopes.join(", ")}.`);
        }
    }

    if (policy.requireTicket && !messageMentionsTicket(normalizedMessage, ticket)) {
        errors.push("Message must reference a ticket.");
    }

    if (parsedSubject && policy.bodyRequiredTypes.includes(parsedSubject.type as AllowedType)) {
        if (!getMessageBody(normalizedMessage)) {
            errors.push(`Type "${parsedSubject.type}" requires a commit body.`);
        }
    }

    return {
        ok: errors.length === 0,
        normalizedMessage,
        subject,
        parsedSubject,
        errors,
        ticket
    };
}
