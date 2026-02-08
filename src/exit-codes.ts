export enum ExitCode {
    Success = 0,
    UsageError = 1,
    GitContextError = 2,
    OllamaError = 3,
    InvalidAiOutput = 4,
    GitCommitError = 5,
    InternalError = 6
}

export const EXIT_CODE_LABEL: Record<ExitCode, string> = {
    [ExitCode.Success]: "SUCCESS",
    [ExitCode.UsageError]: "USAGE_ERROR",
    [ExitCode.GitContextError]: "GIT_CONTEXT_ERROR",
    [ExitCode.OllamaError]: "OLLAMA_ERROR",
    [ExitCode.InvalidAiOutput]: "INVALID_AI_OUTPUT",
    [ExitCode.GitCommitError]: "GIT_COMMIT_ERROR",
    [ExitCode.InternalError]: "INTERNAL_ERROR"
};
