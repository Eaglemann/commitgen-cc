import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            thresholds: {
                lines: 80,
                branches: 80,
                functions: 80,
                statements: 80
            }
        }
    }
});
