import { execa } from "execa";

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
    } catch (e) {
        if (typeof (e as any)?.exitCode === "number" && (e as any).exitCode === 1) return true;
        throw e;
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
