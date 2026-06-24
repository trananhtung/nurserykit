/**
 * Thrown when a nursery scope is cancelled via its AbortSignal.
 */
export class CancelledError extends Error {
  readonly name = "CancelledError";
  constructor(message = "Scope was cancelled") {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when one or more tasks in a nursery fail.
 * Contains all errors from failed tasks (like Python's ExceptionGroup).
 */
export class TaskGroupError extends AggregateError {
  readonly name = "TaskGroupError";
  declare readonly errors: unknown[];
  constructor(errors: unknown[], message = `${errors.length} task(s) failed`) {
    super(errors, message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a timeout deadline is exceeded.
 */
export class TimeoutError extends Error {
  readonly name = "TimeoutError";
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Check if an error is a cancellation (CancelledError or AbortError). */
export function isCancelled(err: unknown): boolean {
  if (err instanceof CancelledError) return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}
