import { execa } from "execa";

function getExitCode(error: unknown): number | null {
    if (!error || typeof error !== "object") return null;
    if (!("exitCode" in error)) return null;

    const value = error.exitCode;
    return typeof value === "number" ? value : null;
}

export async function isGitRepo(): Promise<boolean> {
    try {
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);
        return true;
    } catch {
        return false;
    }
}

export async function hasStagedChanges(): Promise<boolean> {
    // exit code 0 => no diff, 1 => diff exists
    try {
        await execa("git", ["diff", "--staged", "--quiet"]);
        return false;
    } catch (error: unknown) {
        if (getExitCode(error) === 1) return true;
        throw error;
    }
}

export async function getStagedDiff(): Promise<string> {
    const { stdout } = await execa("git", ["diff", "--staged", "--"]);
    return stdout ?? "";
}

export async function gitCommit(message: string, opts: { noVerify?: boolean } = {}): Promise<void> {
    const args = ["commit", "-m", message];
    if (opts.noVerify) args.push("--no-verify");
    await execa("git", args, { stdio: "inherit" });
}
