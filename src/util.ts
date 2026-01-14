export function clampDiff(diff: string, maxChars: number): string {
    const s = diff ?? "";
    if (s.length <= maxChars) return s;

    const head = Math.floor(maxChars * 0.7);
    const tail = maxChars - head - 200;

    return (
        s.slice(0, head) +
        "\n\n--- DIFF TRUNCATED ---\n\n" +
        s.slice(Math.max(0, s.length - tail))
    );
}
