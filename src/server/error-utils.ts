export type RuntimeError = Error | { code?: string | number; message?: string } | string | number | boolean | null | undefined;

export function getErrorMessage(error: RuntimeError): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null && typeof error.message === "string") {
    return error.message;
  }

  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }

  if (error === null) {
    return "null";
  }

  if (typeof error === "undefined") {
    return "undefined";
  }

  return JSON.stringify(error);
}

export function getErrorCode(error: RuntimeError): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const candidate = error as { code?: string | number };
  if (typeof candidate.code === "string") {
    return candidate.code;
  }

  return typeof candidate.code === "number" ? String(candidate.code) : undefined;
}
