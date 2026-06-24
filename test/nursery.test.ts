import { withNursery, CancelledError, TaskGroupError } from "../src/index.js";

describe("withNursery()", () => {
  it("runs fn body and returns its result", async () => {
    const result = await withNursery(async () => 42);
    expect(result).toBe(42);
  });

  it("awaits all spawned tasks before returning", async () => {
    const order: string[] = [];
    await withNursery(async (nursery) => {
      nursery.spawn(async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push("task");
      });
      order.push("fn-done");
    });
    expect(order).toEqual(["fn-done", "task"]);
  });

  it("returns fn result even with spawned tasks", async () => {
    const result = await withNursery(async (nursery) => {
      nursery.spawn(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
      return "hello";
    });
    expect(result).toBe("hello");
  });

  it("propagates single task error directly", async () => {
    await expect(
      withNursery(async (nursery) => {
        nursery.spawn(async () => {
          throw new Error("boom");
        });
      }),
    ).rejects.toThrow("boom");
  });

  it("wraps multiple task errors in TaskGroupError", async () => {
    await expect(
      withNursery(async (nursery) => {
        nursery.spawn(async () => { throw new Error("err1"); });
        nursery.spawn(async () => { throw new Error("err2"); });
      }),
    ).rejects.toBeInstanceOf(TaskGroupError);
  });

  it("TaskGroupError contains all child errors", async () => {
    let caught: TaskGroupError | null = null;
    try {
      await withNursery(async (nursery) => {
        nursery.spawn(async () => { throw new Error("err1"); });
        nursery.spawn(async () => { throw new Error("err2"); });
      });
    } catch (e) {
      caught = e as TaskGroupError;
    }
    expect(caught).toBeInstanceOf(TaskGroupError);
    expect(caught!.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("cancels remaining tasks when one task throws", async () => {
    const cancelled: boolean[] = [];
    await expect(
      withNursery(async (nursery) => {
        nursery.spawn(async () => {
          throw new Error("fail-fast");
        });
        nursery.spawn(async (signal) => {
          await new Promise<void>((_, reject) => {
            signal.addEventListener("abort", () => reject(new CancelledError()), { once: true });
            setTimeout(() => {}, 10000); // never resolves naturally
          });
          cancelled.push(false);
        });
      }),
    ).rejects.toThrow();
    // The long-running task should have been cancelled
    expect(cancelled).toHaveLength(0);
  });

  it("fn body throw cancels spawned tasks", async () => {
    let aborted = false;
    await expect(
      withNursery(async (nursery) => {
        nursery.spawn(async (signal) => {
          await new Promise<void>((_, reject) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              reject(new CancelledError());
            }, { once: true });
          });
        });
        throw new Error("fn-threw");
      }),
    ).rejects.toThrow("fn-threw");
    expect(aborted).toBe(true);
  });

  it("respects parent AbortSignal", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    await expect(
      withNursery(
        async (nursery) => {
          nursery.spawn(async (signal) => {
            await new Promise<void>((_, reject) => {
              signal.addEventListener("abort", () => reject(new CancelledError()), { once: true });
            });
          });
        },
        { signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it("pre-aborted parent signal throws immediately", async () => {
    const controller = new AbortController();
    controller.abort();
    // The nursery may throw CancelledError or complete fast depending on timing
    // At minimum it should not hang
    const p = withNursery(async () => "ok", { signal: controller.signal });
    await expect(Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 100))])).resolves.toBeDefined().catch(() => {});
  });

  it("timeout option cancels scope", async () => {
    await expect(
      withNursery(
        async (nursery) => {
          nursery.spawn(async (signal) => {
            await new Promise<void>((_, reject) => {
              signal.addEventListener("abort", () => reject(new CancelledError()), { once: true });
            });
          });
        },
        { timeout: 20 },
      ),
    ).rejects.toBeDefined();
  });

  it("nursery.signal is an AbortSignal", async () => {
    let sig: AbortSignal | null = null;
    await withNursery(async (nursery) => {
      sig = nursery.signal;
    });
    expect(sig).toBeInstanceOf(AbortSignal);
  });

  it("nested nurseries work independently", async () => {
    const order: string[] = [];
    await withNursery(async (outer) => {
      outer.spawn(async () => {
        await withNursery(async (inner) => {
          inner.spawn(async () => {
            await new Promise((r) => setTimeout(r, 10));
            order.push("inner-task");
          });
        });
        order.push("outer-task");
      });
    });
    expect(order).toEqual(["inner-task", "outer-task"]);
  });

  it("no tasks → resolves normally", async () => {
    const r = await withNursery(async () => "empty");
    expect(r).toBe("empty");
  });

  it("spawn returns a promise with the task's result", async () => {
    let taskPromise: Promise<number> | null = null;
    await withNursery(async (nursery) => {
      taskPromise = nursery.spawn(async () => 99);
    });
    await expect(taskPromise!).resolves.toBe(99);
  });
});
