import { race, raceSettled, TaskGroupError, CancelledError } from "../src/index.js";

describe("race()", () => {
  it("returns first successful result", async () => {
    const result = await race([
      async () => { await new Promise((r) => setTimeout(r, 30)); return "slow"; },
      async () => "fast",
    ]);
    expect(result.value).toBe("fast");
  });

  it("returns winner index", async () => {
    const result = await race([
      async () => { await new Promise((r) => setTimeout(r, 20)); return "a"; },
      async () => "b",
      async () => { await new Promise((r) => setTimeout(r, 40)); return "c"; },
    ]);
    expect(result.index).toBe(1);
  });

  it("skips failures and returns first success", async () => {
    const result = await race([
      async () => { throw new Error("fail"); },
      async () => { await new Promise((r) => setTimeout(r, 10)); return "ok"; },
    ]);
    expect(result.value).toBe("ok");
  });

  it("throws TaskGroupError when all tasks fail", async () => {
    await expect(
      race([
        async () => { throw new Error("e1"); },
        async () => { throw new Error("e2"); },
      ]),
    ).rejects.toBeInstanceOf(TaskGroupError);
  });

  it("TaskGroupError contains all errors when all fail", async () => {
    let err: TaskGroupError | null = null;
    try {
      await race([
        async () => { throw new Error("e1"); },
        async () => { throw new Error("e2"); },
      ]);
    } catch (e) {
      err = e as TaskGroupError;
    }
    expect(err!.errors).toHaveLength(2);
  });

  it("throws RangeError for empty task list", async () => {
    await expect(race([])).rejects.toBeInstanceOf(RangeError);
  });

  it("cancels losers via AbortSignal", async () => {
    const abortedIndices: number[] = [];
    const result = await race([
      async (signal) => {
        await new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => {
            abortedIndices.push(0);
            reject(new CancelledError());
          }, { once: true });
        });
        return "slow";
      },
      async () => "fast",
    ]);
    expect(result.value).toBe("fast");
    // Give slow task time to observe abort
    await new Promise((r) => setTimeout(r, 10));
    expect(abortedIndices).toContain(0);
  });

  it("respects parent AbortSignal", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    await expect(
      race(
        [
          async (signal) =>
            new Promise<string>((_, reject) => {
              signal.addEventListener("abort", () => reject(new CancelledError()), { once: true });
            }),
        ],
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it("single task works", async () => {
    const result = await race([async () => 42]);
    expect(result.value).toBe(42);
    expect(result.index).toBe(0);
  });
});

describe("raceSettled()", () => {
  it("returns first settled result (fulfilled)", async () => {
    const result = await raceSettled([
      async () => "first",
      async () => { await new Promise((r) => setTimeout(r, 20)); return "second"; },
    ]);
    expect(result.status).toBe("fulfilled");
    if (result.status === "fulfilled") expect(result.value).toBe("first");
    expect(result.index).toBe(0);
  });

  it("returns first settled result (rejected)", async () => {
    const result = await raceSettled([
      async () => { throw new Error("fast-fail"); },
      async () => { await new Promise((r) => setTimeout(r, 30)); return "slow"; },
    ]);
    expect(result.status).toBe("rejected");
    expect(result.index).toBe(0);
  });

  it("throws RangeError for empty task list", async () => {
    await expect(raceSettled([])).rejects.toBeInstanceOf(RangeError);
  });
});
