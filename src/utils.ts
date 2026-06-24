import { CancelledError, TimeoutError } from "./errors.js";

/**
 * Sleep for `ms` milliseconds. Rejects with CancelledError if the signal fires.
 *
 * @example
 * await sleep(1000, signal); // cancellable sleep
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new CancelledError());
    }

    const timer = setTimeout(resolve, ms);
    (timer as unknown as { unref?: () => void }).unref?.();

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new CancelledError());
      },
      { once: true },
    );
  });
}

/**
 * Wrap a promise with a timeout. Rejects with TimeoutError if not settled in time.
 * If signal is provided, also rejects with CancelledError if aborted.
 *
 * @example
 * const data = await withTimeout(fetch(url), 5000, signal);
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new CancelledError());
    }

    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    (timer as unknown as { unref?: () => void }).unref?.();

    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (v) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

/**
 * Create an AbortSignal that fires after `ms` milliseconds.
 *
 * @example
 * const signal = timeoutSignal(5000);
 * await fetch(url, { signal });
 */
export function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new TimeoutError(ms)), ms);
  (t as unknown as { unref?: () => void }).unref?.();
  return controller.signal;
}

/**
 * Combine multiple AbortSignals into one that aborts when ANY of the inputs abort.
 * Like `AbortSignal.any()` (available in Node 20+), but works on Node 18+.
 *
 * @example
 * const combined = anySignal([userSignal, timeoutSignal(5000)]);
 */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  // Use native implementation if available (Node 20+)
  if (typeof (AbortSignal as { any?: (...args: unknown[]) => AbortSignal }).any === "function") {
    return (AbortSignal as { any: (s: AbortSignal[]) => AbortSignal }).any(signals);
  }

  const controller = new AbortController();

  const abort = (reason: unknown) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };

  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      break;
    }
    sig.addEventListener("abort", () => abort(sig.reason), { once: true });
  }

  return controller.signal;
}

/**
 * Run `task` and retry up to `retries` times on failure, with optional delay between attempts.
 * The task receives the current attempt number (0-indexed) and an AbortSignal.
 *
 * @example
 * const data = await retry((n, signal) => fetch(url, { signal }), { retries: 3, delay: 500 });
 */
export async function retry<T>(
  task: (attempt: number, signal: AbortSignal) => Promise<T>,
  opts: { retries?: number; delay?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const { retries = 3, delay = 0, signal } = opts;
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    if (signal?.aborted) throw new CancelledError();
    try {
      return await task(i, signal ?? new AbortController().signal);
    } catch (err) {
      lastError = err;
      if (i < retries && delay > 0) await sleep(delay, signal);
    }
  }
  throw lastError;
}
