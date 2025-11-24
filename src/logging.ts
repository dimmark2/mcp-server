import { randomUUID } from "node:crypto";

type LogStage = "input" | "output" | "error";

function serializeForLog(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function formatError(err: unknown) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }

  return err;
}

function logToolEvent(toolName: string, callId: string, stage: LogStage, payload: unknown) {
  const prefix = `[tool:${toolName}][${callId}][${stage}]`;
  const body = serializeForLog(payload);

  if (stage === "error") {
    // eslint-disable-next-line no-console
    console.error(prefix, body);
  } else {
    // eslint-disable-next-line no-console
    console.log(prefix, body);
  }
}

export function withToolLogging<TArgs, TResult>(
  toolName: string,
  handler: (args: TArgs) => Promise<TResult>,
) {
  return async (args: TArgs): Promise<TResult> => {
    const callId = randomUUID();

    logToolEvent(toolName, callId, "input", args);

    try {
      const result = await handler(args);
      logToolEvent(toolName, callId, "output", result);
      return result;
    } catch (err) {
      logToolEvent(toolName, callId, "error", formatError(err));
      throw err;
    }
  };
}
