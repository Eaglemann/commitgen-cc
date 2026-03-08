import { inferScopeFromFiles, inferTicketFromBranch } from "./context.js";
import { getCurrentBranch, getStagedDiff, getStagedFiles } from "./git.js";
import { readHistory, resolveHistoryPath } from "./history.js";
import { clampDiff } from "./util.js";
import { inferTypeFromDiff } from "./validation.js";
import type { RepoContext, ResolvedWorkflowOptions } from "./workflow.js";

export async function loadRepoContext(
    gitDir: string,
    options: ResolvedWorkflowOptions
): Promise<RepoContext> {
    const stagedDiff = await getStagedDiff();
    const files = await getStagedFiles();
    const branch = await getCurrentBranch();
    const suggestedScope = inferScopeFromFiles(files);
    const effectiveScope = options.scope ?? suggestedScope ?? options.defaultScope;
    const ticket = options.ticket ?? inferTicketFromBranch(branch, options.ticketPattern);
    const historyPath = options.historyEnabled ? resolveHistoryPath(gitDir) : null;
    const recentExamples = historyPath
        ? (await readHistory(historyPath, options.historySampleSize)).map((entry) => entry.message)
        : [];

    return {
        gitDir,
        diff: clampDiff(stagedDiff, options.maxChars),
        files,
        branch,
        suggestedScope,
        effectiveScope,
        ticket,
        recentExamples,
        expectedType: options.type ?? inferTypeFromDiff(stagedDiff),
        historyPath
    };
}
