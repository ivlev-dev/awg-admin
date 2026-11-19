import { ApiError } from "./errors";

export function isUnsupportedEndpoint(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 404 || error.status === 405 || error.status === 501)
  );
}
