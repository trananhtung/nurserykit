# nurserykit

[![All Contributors](https://img.shields.io/badge/all_contributors-1-orange.svg?style=flat-square)](#contributors-)

Structured concurrency for standard async/await — **no generators required**.

`withNursery` (nursery/TaskGroup pattern) · `race` with automatic AbortSignal cancellation · `sleep` · `withTimeout` · `anySignal` · `retry`

[![npm](https://img.shields.io/npm/v/nurserykit)](https://www.npmjs.com/package/nurserykit)
[![npm downloads](https://img.shields.io/npm/dw/nurserykit)](https://www.npmjs.com/package/nurserykit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Why nurserykit?

JavaScript has `Promise.all` and `Promise.race`, but nothing that gives you:

1. **Structured lifetime** — child tasks cannot outlive the scope that created them
2. **Automatic cancellation** — if any task throws, the others are cancelled via AbortSignal
3. **Error aggregation** — collects all errors into `TaskGroupError` (like Python's `ExceptionGroup`)

[Effection](https://frontside.com/effection/) is the closest npm equivalent but requires rewriting all your async functions as generators. `nurserykit` works with standard `async`/`await` and the native AbortSignal API — drop it into any Node.js 18+ codebase with zero changes to existing code.

## Install

```bash
npm install nurserykit
```

## Quick start

```ts
import { withNursery, race, sleep } from "nurserykit";

// Fetch two resources concurrently — if one throws, the other is cancelled
await withNursery(async (nursery) => {
  nursery.spawn(async (signal) => {
    const user = await fetch("/api/user", { signal }).then(r => r.json());
    console.log(user);
  });
  nursery.spawn(async (signal) => {
    const posts = await fetch("/api/posts", { signal }).then(r => r.json());
    console.log(posts);
  });
});

// Race two endpoints — winner resolved, loser cancelled
const { value, index } = await race([
  (signal) => fetch("https://api1.example.com/data", { signal }).then(r => r.json()),
  (signal) => fetch("https://api2.example.com/data", { signal }).then(r => r.json()),
]);

// Cancellable sleep
await sleep(1000, signal);
```

## API

### `withNursery(fn, opts?)`

Run `fn` with a structured concurrency scope. All tasks spawned inside `fn` are awaited before `withNursery` returns.

```ts
async function withNursery<T>(
  fn: (nursery: Nursery) => Promise<T>,
  opts?: {
    signal?: AbortSignal;  // cancel scope from outside
    timeout?: number;      // cancel after N milliseconds
  },
): Promise<T>
```

**Guarantees:**
- All spawned tasks complete (or are cancelled) before the scope exits
- If any task throws → scope AbortSignal is aborted → remaining tasks receive the signal → all errors collected → rethrown as `TaskGroupError`
- If `fn` itself throws → all running tasks are cancelled
- If `signal` fires → all tasks are cancelled → `CancelledError` is thrown

```ts
// Fail-fast: one task fails, other is cancelled
try {
  await withNursery(async (nursery) => {
    nursery.spawn(async (signal) => {
      await fetchData(signal); // this throws
    });
    nursery.spawn(async (signal) => {
      await slowBackup(signal); // this gets AbortSignal abort
    });
  });
} catch (err) {
  // err is the original error from fetchData
}

// Timeout: cancel everything after 5 seconds
await withNursery(
  async (nursery) => {
    nursery.spawn(async (signal) => longOperation(signal));
  },
  { timeout: 5000 },
);

// External cancellation
const controller = new AbortController();
button.onclick = () => controller.abort();

await withNursery(
  async (nursery) => {
    nursery.spawn(async (signal) => streamResults(signal));
  },
  { signal: controller.signal },
);
```

#### `nursery.spawn(task)`

Add a task to the scope. Returns a Promise with the task's result.

```ts
nursery.spawn<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
```

Tasks receive the scope's AbortSignal automatically — pass it to `fetch`, `sleep`, and other cancellable APIs.

#### `nursery.signal`

The scope's AbortSignal. Aborted when any task fails or the scope is cancelled.

---

### `race(tasks, parentSignal?)`

Run tasks concurrently and return the first successful result. Losers are cancelled via AbortSignal.

```ts
async function race<T>(
  tasks: ReadonlyArray<(signal: AbortSignal) => Promise<T>>,
  parentSignal?: AbortSignal,
): Promise<{ value: T; index: number }>
```

- Returns `{ value, index }` from the winning task
- Skips failed tasks and waits for the next success
- Throws `TaskGroupError` only if **all** tasks fail
- Throws `CancelledError` if `parentSignal` is aborted

```ts
// Redundant fetch — use whichever responds first
const { value: data } = await race([
  (signal) => fetch("https://us.api.example.com", { signal }).then(r => r.json()),
  (signal) => fetch("https://eu.api.example.com", { signal }).then(r => r.json()),
]);

// With parent cancellation
const { value } = await race([task1, task2], controller.signal);
```

### `raceSettled(tasks, parentSignal?)`

Like `race` but returns the first task to **settle** (resolve OR reject), regardless of success.

```ts
const result = await raceSettled([task1, task2]);
// result: { status: "fulfilled", value: T, index: number }
//       | { status: "rejected", reason: unknown, index: number }
```

---

### `sleep(ms, signal?)`

Pause for `ms` milliseconds. Rejects with `CancelledError` if `signal` fires.

```ts
await sleep(1000);
await sleep(1000, signal); // cancellable
```

### `withTimeout(promise, ms, signal?)`

Wrap any Promise with a deadline. Throws `TimeoutError` if not settled in time.

```ts
const data = await withTimeout(fetch(url), 5000);
const data = await withTimeout(fetch(url, { signal }), 5000, signal);
```

### `timeoutSignal(ms)`

Create an AbortSignal that fires after `ms` milliseconds.

```ts
const signal = timeoutSignal(5000);
await fetch(url, { signal }); // auto-cancelled after 5s
```

### `anySignal(signals)`

Merge multiple AbortSignals into one that fires when **any** input fires. Polyfills `AbortSignal.any()` for Node 18.

```ts
const signal = anySignal([userSignal, timeoutSignal(5000)]);
await fetch(url, { signal });
```

### `retry(task, opts?)`

Retry a task up to `retries` times with optional delay between attempts.

```ts
const data = await retry(
  async (attempt, signal) => {
    console.log(`Attempt ${attempt}`);
    return fetch(url, { signal }).then(r => r.json());
  },
  { retries: 3, delay: 500, signal },
);
```

---

### Error types

| Class | Extends | When thrown |
|-------|---------|-------------|
| `CancelledError` | `Error` | Scope or task cancelled via AbortSignal |
| `TimeoutError` | `Error` | `withTimeout` or `timeout` option expired |
| `TaskGroupError` | `AggregateError` | Multiple tasks failed simultaneously; `.errors` has all causes |

```ts
import { isCancelled } from "nurserykit";

try {
  await withNursery(/* ... */);
} catch (err) {
  if (isCancelled(err)) return; // ignore user cancellation
  throw err;
}
```

## Comparison

| Feature | nurserykit | Effection | Promise.all |
|---------|-----------|-----------|------------|
| Standard async/await | ✅ | ❌ (generators) | ✅ |
| Auto-cancel on error | ✅ | ✅ | ❌ |
| AbortSignal threading | ✅ | ✅ | ❌ |
| Error aggregation | ✅ | ✅ | partial |
| race() with cancellation | ✅ | ❌ | ❌ |
| Zero dependencies | ✅ | ❌ | — |
| Bundle size | ~2KB | ~50KB | — |

## Contributors ✨

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind are welcome — code, docs, bug reports, ideas, reviews! See the [emoji key](https://allcontributors.org/docs/en/emoji-key) for how each contribution is recognized, and open a PR or issue to get involved.

Thanks goes to these wonderful people:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/trananhtung"><img src="https://avatars.githubusercontent.com/u/30992229?v=4?s=100" width="100px;" alt="Tung Tran"/><br /><sub><b>Tung Tran</b></sub></a><br /><a href="https://github.com/trananhtung/nurserykit/commits?author=trananhtung" title="Code">💻</a> <a href="#maintenance-trananhtung" title="Maintenance">🚧</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## License

MIT
