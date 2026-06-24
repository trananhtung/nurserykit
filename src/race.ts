import { CancelledError, TaskGroupError } from "./errors.js";

export interface RaceResult<T> {
  /** The value from the winning task. */
  value: T;
  /** Index of the winning task (0-based). */
  index: number;
}

/**
 * Run multiple tasks concurrently and return the result of the first one to
 * resolve successfully. All other tasks receive an AbortSignal abort when the
 * winner is found.
 *
 * Like Go's `select` or Python's `asyncio.wait(return_when=FIRST_COMPLETED)`,
 * but with automatic cancellation of losers.
 *
 * @throws {TaskGroupError} if ALL tasks fail.
 * @throws {CancelledError} if the parent signal is aborted before any task succeeds.
 *
 * @example
 * const { value } = await race([
 *   (signal) => fetch("https://api1.example.com", { signal }).then(r => r.json()),
 *   (signal) => fetch("https://api2.example.com", { signal }).then(r => r.json()),
 * ]);
 */
export async function race<T>(
  tasks: ReadonlyArray<(signal: AbortSignal) => Promise<T>>,
  parentSignal?: AbortSignal,
): Promise<RaceResult<T>> {
  if (tasks.length === 0) throw new RangeError("race() requires at least one task");

  const controller = new AbortController();

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener("abort", () => controller.abort(parentSignal.reason), { once: true });
    }
  }

  const errors: unknown[] = [];
  let settled = 0;

  return new Promise<RaceResult<T>>((resolve, reject) => {
    let done = false;

    tasks.forEach((task, index) => {
      Promise.resolve().then(() => task(controller.signal)).then(
        (value) => {
          if (!done) {
            done = true;
            controller.abort(); // cancel remaining tasks
            resolve({ value, index });
          }
        },
        (err) => {
          errors.push(err);
          settled++;
          if (settled === tasks.length && !done) {
            reject(new TaskGroupError(errors, `All ${tasks.length} tasks failed`));
          }
        },
      );
    });

    controller.signal.addEventListener("abort", () => {
      if (!done) {
        done = true;
        reject(new CancelledError());
      }
    }, { once: true });
  });
}

/**
 * Run multiple tasks and return the result of the FIRST to finish (resolve OR reject).
 * Equivalent to native `Promise.race` but with automatic AbortSignal cancellation.
 */
export async function raceSettled<T>(
  tasks: ReadonlyArray<(signal: AbortSignal) => Promise<T>>,
  parentSignal?: AbortSignal,
): Promise<PromiseSettledResult<T> & { index: number }> {
  if (tasks.length === 0) throw new RangeError("raceSettled() requires at least one task");

  const controller = new AbortController();

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener("abort", () => controller.abort(parentSignal.reason), { once: true });
    }
  }

  return new Promise((resolve) => {
    let done = false;
    tasks.forEach((task, index) => {
      Promise.resolve().then(() => task(controller.signal)).then(
        (value) => {
          if (!done) { done = true; controller.abort(); resolve({ status: "fulfilled", value, index }); }
        },
        (reason) => {
          if (!done) { done = true; controller.abort(); resolve({ status: "rejected", reason, index }); }
        },
      );
    });
  });
}
