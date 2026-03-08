export function inferScopeFromFiles(files: string[]): string | null {
    if (files.length === 0) return null;

    const counts = new Map<string, number>();
    for (const file of files) {
        const normalized = file.trim().replace(/^\.?\//, "");
        const slashIndex = normalized.indexOf("/");
        if (slashIndex <= 0) continue;

        const scope = normalized.slice(0, slashIndex);
        counts.set(scope, (counts.get(scope) ?? 0) + 1);
    }

    let bestScope: string | null = null;
    let bestCount = 0;
    for (const [scope, count] of counts.entries()) {
        if (count > bestCount) {
            bestScope = scope;
            bestCount = count;
        }
    }

    if (!bestScope) return null;
    return bestCount / files.length >= 0.6 ? bestScope : null;
}

export function inferTicketFromBranch(
    branch: string | null,
    pattern: string
): string | null {
    if (!branch) return null;

    const match = branch.match(new RegExp(pattern));
    if (!match) return null;

    const ticket = match[1] ?? match[0];
    return ticket.trim() || null;
}
