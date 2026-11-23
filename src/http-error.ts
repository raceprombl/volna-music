export class HttpError extends Error {
  constructor(
    public status: number,
    public retryAfter?: number,
  ) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}
