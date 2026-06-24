import { CancelledError, TaskGroupError, isCancelled } from "./errors.js";

export interface NurseryOptions {
  /** Abort an external AbortSignal to cancel the entire scope from outside. */
  signal?: AbortSignal;
  /** Cancel the scope after this many milliseconds. */
  timeout?: number;
}

export interface Nursery {
  /** The AbortSignal for this scope — pass to child tasks so they can observe cancellation. */
  readonly signal: AbortSignal;
  /**
   * Spawn a new child task in this scope.
   * The task receives the scope's AbortSignal automatically.
   * If the task throws, the scope is cancelled and the error is collected.
   */
  spawn<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
}

/**
 * Run an async function with a structured concurrency scope (nursery).
 *
 * The scope guarantees:
 * 1. All spawned tasks complete (or are cancelled) before `withNursery` returns.
 * 2. If any task throws, the scope's AbortSignal is aborted and remaining tasks
 *    receive the abort signal. All errors are collected and re-thrown as TaskGroupError.
 * 3. If `fn` itself throws, all running tasks are cancelled.
 * 4. If the parent's `signal` is aborted, all tasks are cancelled and CancelledError is thrown.
 *
 * Like Python's `asyncio.TaskGroup` / Trio nursery, but works with standard async/await.
 *
 * @example
 * const result = await withNursery(async (nursery) => {
 *   nursery.spawn(async (signal) => fetchUser(userId, { signal }));
 *   nursery.spawn(async (signal) => fetchPosts(userId, { signal }));
 * });
 */
export async function withNursery<T>(
  fn: (nursery: Nursery) => Promise<T>,
  opts: NurseryOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const { signal } = controller;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  // Wire up parent signal
  if (opts.signal) {
    if (opts.signal.aborted) {
      controller.abort(opts.signal.reason);
    } else {
      opts.signal.addEventListener("abort", () => controller.abort(opts.signal!.reason), { once: true });
    }
  }

  // Wire up timeout
  if (opts.timeout !== undefined) {
    timeoutId = setTimeout(() => {
      controller.abort(new Error(`Timed out after ${opts.timeout}ms`));
    }, opts.timeout);
    (timeoutId as unknown as { unref?: () => void }).unref?.();
  }

  const tasks: Promise<unknown>[] = [];
  const errors: unknown[] = [];

  const nursery: Nursery = {
    get signal() {
      return signal;
    },
    spawn<R>(task: (signal: AbortSignal) => Promise<R>): Promise<R> {
      const p = Promise.resolve().then(() => task(signal)).then(
        (v) => v,
        (err) => {
          // Don't collect cancellation errors caused by our own abort
          if (!isCancelled(err) || !signal.aborted) {
            errors.push(err);
          }
          // Cancel all other tasks on first error
          if (!signal.aborted) {
            controller.abort(err instanceof Error ? err : new Error(String(err)));
          }
          return undefined as unknown as R;
        },
      );
      tasks.push(p);
      return p;
    },
  };

  let fnResult: T;
  let fnError: unknown;
  let fnThrew = false;

  try {
    fnResult = await fn(nursery);
  } catch (err) {
    fnThrew = true;
    fnError = err;
    if (!signal.aborted) {
      controller.abort(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // Wait for all spawned tasks to settle (timeout must stay active until here)
  await Promise.allSettled(tasks);

  // Only clear the timeout after all tasks have settled
  clearTimeout(timeoutId);

  // Collect any remaining errors (tasks that finished after fn threw)
  // errors array is already populated by task rejection handlers above

  if (fnThrew && !isCancelled(fnError)) {
    errors.unshift(fnError);
  }

  if (errors.length > 0) {
    if (errors.length === 1) {
      throw errors[0];
    }
    throw new TaskGroupError(errors);
  }

  // If scope was cancelled by parent signal (not by a task error)
  if (signal.aborted && errors.length === 0 && !fnThrew) {
    throw new CancelledError();
  }

  if (fnThrew) throw fnError;

  return fnResult!;
}
