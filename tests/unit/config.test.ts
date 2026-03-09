import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRepoConfig } from "../../src/config.js";

describe("loadRepoConfig", () => {
    it("returns an empty object when the default repo config is missing", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "commitgen-config-"));
        await expect(loadRepoConfig(repoDir, null)).resolves.toEqual({});
    });

    it("loads and validates a repo config file", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "commitgen-config-"));
        const configPath = join(repoDir, ".commitgen.json");

        await writeFile(configPath, JSON.stringify({
            model: "repo-model",
            host: "http://repo-host",
            maxChars: 12000,
            defaultScope: "cli",
            scopes: ["cli", "workflow"],
            ticketPattern: "([A-Z]+-\\d+)",
            historyEnabled: false,
            historySampleSize: 4,
            hookMode: "enforce",
            requireTicket: true,
            allowedTypes: ["feat", "fix"],
            requiredScopes: ["cli", "workflow"],
            scopeMap: {
                "src/cli": "cli"
            },
            subjectMaxLength: 60,
            bodyRequiredTypes: ["feat"]
        }));

        await expect(loadRepoConfig(repoDir, null)).resolves.toEqual({
            model: "repo-model",
            host: "http://repo-host",
            maxChars: 12000,
            defaultScope: "cli",
            scopes: ["cli", "workflow"],
            ticketPattern: "([A-Z]+-\\d+)",
            historyEnabled: false,
            historySampleSize: 4,
            hookMode: "enforce",
            requireTicket: true,
            allowedTypes: ["feat", "fix"],
            requiredScopes: ["cli", "workflow"],
            scopeMap: {
                "src/cli": "cli"
            },
            subjectMaxLength: 60,
            bodyRequiredTypes: ["feat"]
        });
    });

    it("ignores legacy interactiveCandidates config", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "commitgen-config-"));
        const configPath = join(repoDir, ".commitgen.json");

        await writeFile(configPath, JSON.stringify({
            interactiveCandidates: 5
        }));

        await expect(loadRepoConfig(repoDir, null)).resolves.not.toHaveProperty("interactiveCandidates");
    });

    it("throws when an explicit config path is missing", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "commitgen-config-"));
        const missingPath = join(repoDir, "missing.json");

        await expect(loadRepoConfig(repoDir, missingPath))
            .rejects
            .toThrow(`Config file not found: ${missingPath}`);
    });

    it("throws for invalid config content", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "commitgen-config-"));
        const configPath = join(repoDir, ".commitgen.json");
        await writeFile(configPath, JSON.stringify({
            scopes: [123]
        }));

        await expect(loadRepoConfig(repoDir, null))
            .rejects
            .toThrow("must contain only non-empty strings");
    });

    it("throws for invalid ticket regex patterns", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "commitgen-config-"));
        const configPath = join(repoDir, ".commitgen.json");
        await writeFile(configPath, JSON.stringify({
            ticketPattern: "[unterminated"
        }));

        await expect(loadRepoConfig(repoDir, null))
            .rejects
            .toThrow("ticketPattern");
    });

    it("throws for invalid allowedTypes values", async () => {
        const repoDir = await mkdtemp(join(tmpdir(), "commitgen-config-"));
        const configPath = join(repoDir, ".commitgen.json");
        await writeFile(configPath, JSON.stringify({
            allowedTypes: ["feat", "shipit"]
        }));

        await expect(loadRepoConfig(repoDir, null))
            .rejects
            .toThrow("allowedTypes");
    });
});
