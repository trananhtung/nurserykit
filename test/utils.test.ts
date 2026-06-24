import { sleep, withTimeout, timeoutSignal, anySignal, retry, CancelledError, TimeoutError, TaskGroupError } from "../src/index.js";

describe("sleep()", () => {
  it("resolves after ms", async () => {
    const start = Date.now();
    await sleep(30);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });

  it("rejects with CancelledError when signal aborts", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    await expect(sleep(1000, controller.signal)).rejects.toBeInstanceOf(CancelledError);
  });

  it("rejects immediately if signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(100, controller.signal)).rejects.toBeInstanceOf(CancelledError);
  });

  it("no signal → just resolves", async () => {
    await expect(sleep(10)).resolves.toBeUndefined();
  });
});

describe("withTimeout()", () => {
  it("resolves if promise settles in time", async () => {
    const result = await withTimeout(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it("rejects with TimeoutError if too slow", async () => {
    const never = new Promise<never>(() => {});
    await expect(withTimeout(never, 20)).rejects.toBeInstanceOf(TimeoutError);
  });

  it("TimeoutError message includes ms", async () => {
    const never = new Promise<never>(() => {});
    let err: TimeoutError | null = null;
    try {
      await withTimeout(never, 20);
    } catch (e) {
      err = e as TimeoutError;
    }
    expect(err!.message).toContain("20");
  });

  it("passes through rejection from promise", async () => {
    await expect(withTimeout(Promise.reject(new Error("original")), 1000)).rejects.toThrow("original");
  });

  it("rejects with CancelledError if signal aborts before timeout", async () => {
    const controller = new AbortController();
    const never = new Promise<never>(() => {});
    setTimeout(() => controller.abort(), 10);
    await expect(withTimeout(never, 5000, controller.signal)).rejects.toBeInstanceOf(CancelledError);
  });
});

describe("timeoutSignal()", () => {
  it("returns an AbortSignal", () => {
    const sig = timeoutSignal(1000);
    expect(sig).toBeInstanceOf(AbortSignal);
    expect(sig.aborted).toBe(false);
  });

  it("aborts after ms", async () => {
    const sig = timeoutSignal(20);
    await sleep(30);
    expect(sig.aborted).toBe(true);
  });
});

describe("anySignal()", () => {
  it("aborts when first signal aborts", async () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const combined = anySignal([c1.signal, c2.signal]);
    expect(combined.aborted).toBe(false);
    c1.abort();
    expect(combined.aborted).toBe(true);
  });

  it("aborts immediately if any input is already aborted", () => {
    const c1 = new AbortController();
    c1.abort();
    const c2 = new AbortController();
    const combined = anySignal([c1.signal, c2.signal]);
    expect(combined.aborted).toBe(true);
  });

  it("works with single signal", async () => {
    const c = new AbortController();
    const combined = anySignal([c.signal]);
    c.abort();
    expect(combined.aborted).toBe(true);
  });

  it("empty list → never aborts", () => {
    const sig = anySignal([]);
    expect(sig.aborted).toBe(false);
  });
});

describe("retry()", () => {
  it("returns result on first success", async () => {
    const result = await retry(async () => "ok");
    expect(result).toBe("ok");
  });

  it("retries on failure and eventually succeeds", async () => {
    let attempts = 0;
    const result = await retry(async () => {
      attempts++;
      if (attempts < 3) throw new Error("not yet");
      return "done";
    }, { retries: 3 });
    expect(result).toBe("done");
    expect(attempts).toBe(3);
  });

  it("throws last error after exhausting retries", async () => {
    await expect(
      retry(async () => { throw new Error("always-fail"); }, { retries: 2 }),
    ).rejects.toThrow("always-fail");
  });

  it("attempt number increments correctly", async () => {
    const attempts: number[] = [];
    try {
      await retry(async (n) => { attempts.push(n); throw new Error("x"); }, { retries: 2 });
    } catch {}
    expect(attempts).toEqual([0, 1, 2]);
  });

  it("stops immediately if signal aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      retry(async () => "ok", { retries: 3, signal: controller.signal }),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it("default retries is 3", async () => {
    let count = 0;
    try {
      await retry(async () => { count++; throw new Error("x"); });
    } catch {}
    expect(count).toBe(4); // 1 initial + 3 retries
  });

  it("respects delay between retries", async () => {
    const times: number[] = [];
    try {
      await retry(async () => { times.push(Date.now()); throw new Error("x"); }, { retries: 2, delay: 30 });
    } catch {}
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(25);
  });
});

describe("error types", () => {
  it("CancelledError has correct name", () => {
    const e = new CancelledError();
    expect(e.name).toBe("CancelledError");
    expect(e).toBeInstanceOf(Error);
  });

  it("TimeoutError has correct name and message", () => {
    const e = new TimeoutError(500);
    expect(e.name).toBe("TimeoutError");
    expect(e.message).toContain("500");
    expect(e).toBeInstanceOf(Error);
  });

  it("TaskGroupError has correct name and errors", () => {
    const e = new TaskGroupError([new Error("a"), new Error("b")]);
    expect(e.name).toBe("TaskGroupError");
    expect(e.errors).toHaveLength(2);
    expect(e).toBeInstanceOf(AggregateError);
  });
});
