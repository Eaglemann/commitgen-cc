const DIFF_TRUNCATION_MARKER = "\n\n--- DIFF TRUNCATED ---\n\n";

export function clampDiff(diff: string, maxChars: number): string {
    const source = diff ?? "";
    const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0;

    if (limit === 0) return "";
    if (source.length <= limit) return source;

    if (limit <= DIFF_TRUNCATION_MARKER.length + 20) {
        return source.slice(0, limit);
    }

    const available = limit - DIFF_TRUNCATION_MARKER.length;
    const headSize = Math.max(1, Math.floor(available * 0.7));
    const tailSize = Math.max(1, available - headSize);

    return `${source.slice(0, headSize)}${DIFF_TRUNCATION_MARKER}${source.slice(source.length - tailSize)}`;
}

export function parseBoundedInteger(value: string, name: string, min: number, max: number): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        throw new Error(`${name} must be a number.`);
    }

    if (parsed < min || parsed > max) {
        throw new Error(`${name} must be between ${min} and ${max}.`);
    }

    return parsed;
}

export function normalizeErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return fallback;
}
