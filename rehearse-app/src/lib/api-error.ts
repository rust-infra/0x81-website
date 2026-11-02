export class ApiError extends Error {
  status: number;
  reason?: string;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    reason?: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
    this.details = details;
  }
}
