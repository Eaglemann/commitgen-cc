const NOISE_DIRS = new Set([
    "src", "lib", "dist",
    "tests", "test", "__tests__", "__test__",
    "spec", "specs", "source",
    "unit", "integration", "e2e",
]);

const NOISE_STEMS = new Set(["index", "main", "app", "mod", "readme", "changelog", "license"]);

function normalizePathPrefix(value: string): string {
    return value.trim().replace(/^\.?\//, "").replace(/\/+$/, "");
}

function findMappedScope(
    file: string,
    scopeMap: Record<string, string>
): string | null {
    const normalizedFile = normalizePathPrefix(file);
    let bestMatch: string | null = null;
    let bestMatchRaw: string | null = null;

    for (const rawPrefix of Object.keys(scopeMap)) {
        const prefix = normalizePathPrefix(rawPrefix);
        if (!prefix) continue;
        if (normalizedFile !== prefix && !normalizedFile.startsWith(`${prefix}/`)) continue;
        if (!bestMatch || prefix.length > bestMatch.length) {
            bestMatch = prefix;
            bestMatchRaw = rawPrefix;
        }
    }

    return bestMatchRaw ? scopeMap[bestMatchRaw] ?? null : null;
}

function extractFileStem(fileName: string): string | null {
    const dotIdx = fileName.indexOf(".");
    const stem = (dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName).toLowerCase();
    return NOISE_STEMS.has(stem) ? null : stem || null;
}

function pickBest(counts: Map<string, number>, total: number, threshold: number): string | null {
    let best: string | null = null;
    let bestCount = 0;
    for (const [scope, count] of counts.entries()) {
        if (count > bestCount) {
            best = scope;
            bestCount = count;
        }
    }
    return best && bestCount / total >= threshold ? best : null;
}

export function inferScopeFromFiles(files: string[], scopeMap: Record<string, string> = {}): string | null {
    if (files.length === 0) return null;

    if (Object.keys(scopeMap).length > 0) {
        const mappedCounts = new Map<string, number>();
        for (const file of files) {
            const scope = findMappedScope(file, scopeMap);
            if (!scope) continue;
            mappedCounts.set(scope, (mappedCounts.get(scope) ?? 0) + 1);
        }

        const best = pickBest(mappedCounts, files.length, 0.6);
        if (best) return best;
    }

    const stemCounts = new Map<string, number>();
    const parentCounts = new Map<string, number>();
    const rootCounts = new Map<string, number>();

    for (const file of files) {
        const parts = normalizePathPrefix(file).split("/").filter(Boolean);
        const fileName = parts[parts.length - 1] ?? "";
        const dirs = parts.slice(0, -1);

        const stem = extractFileStem(fileName);
        if (stem) stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);

        const parentDir = dirs[dirs.length - 1];
        if (parentDir && !NOISE_DIRS.has(parentDir)) {
            parentCounts.set(parentDir, (parentCounts.get(parentDir) ?? 0) + 1);
        }

        const rootDir = dirs[0];
        if (rootDir && !NOISE_DIRS.has(rootDir)) {
            rootCounts.set(rootDir, (rootCounts.get(rootDir) ?? 0) + 1);
        }
    }

    for (const counts of [stemCounts, parentCounts, rootCounts]) {
        const best = pickBest(counts, files.length, 0.6);
        if (best) return best;
    }

    return null;
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
