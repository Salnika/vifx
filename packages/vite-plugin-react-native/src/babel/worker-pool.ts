import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

/**
 * Runs the project's Babel on worker threads.
 *
 * Babel is single-threaded and is the dominant cost of a cold build (every
 * project file plus the packages that ship untranspiled source). Metro spreads
 * that work over worker processes; this pool does the same with threads, each
 * loading the project's own `@babel/core` so plugin versions are unchanged.
 *
 * The pool only engages under load. A lone transform (a file saved in the dev
 * server, a warm build with a handful of cache misses) runs on the calling
 * thread, so no worker is ever started for it. Workers are spawned as the
 * queue grows, exit after a few idle seconds, and never keep the process alive.
 *
 * Failure policy: a worker that cannot start or dies takes nothing with it —
 * its tasks are re-run on the calling thread and the pool stops spawning.
 */

export interface BabelTransformOutput {
  code?: string | null;
  map?: unknown;
}

export type InlineBabelTransform = () => Promise<BabelTransformOutput | null>;

export interface BabelWorkerPoolOptions {
  /** Absolute path of the project's `@babel/core` entry. */
  babelCorePath: string;
  /** Milliseconds an idle worker is kept before it is terminated. */
  idleTimeoutMs?: number;
  /** Upper bound on worker threads. `0` disables the pool. */
  maxWorkers?: number;
}

export interface BabelWorkerPool {
  /**
   * Transforms `code` with `options`. `inline` performs the same transform on
   * the calling thread; the pool uses it when a worker is not worth starting
   * and as the fallback when a worker fails.
   */
  run(
    code: string,
    options: Record<string, unknown>,
    inline: InlineBabelTransform,
  ): Promise<BabelTransformOutput | null>;
  /** Terminates every worker. Pending tasks are completed inline. */
  close(): Promise<void>;
  /** Number of live worker threads (observability and tests). */
  size(): number;
}

interface PoolTask {
  code: string;
  id: number;
  inline: InlineBabelTransform;
  options: Record<string, unknown>;
  reject: (error: unknown) => void;
  resolve: (output: BabelTransformOutput | null) => void;
}

interface PoolWorker {
  idleTimer: NodeJS.Timeout | null;
  ready: boolean;
  task: PoolTask | null;
  thread: Worker;
}

interface WorkerReply {
  code?: string | null;
  error?: SerializedBabelError;
  id?: number;
  map?: unknown;
  ok?: boolean;
  ready?: boolean;
}

interface SerializedBabelError {
  code?: unknown;
  loc?: unknown;
  message: string;
  name: string;
  reasonCode?: unknown;
  stack?: string;
}

const DEFAULT_IDLE_TIMEOUT_MS = 5000;
const MAX_DEFAULT_WORKERS = 8;
/** Inline Babel time, net of idle time, after which workers are started. */
const ENGAGE_AFTER_INLINE_MS = 300;
/** Milliseconds of inline load forgiven per millisecond spent on other work. */
const INLINE_LOAD_DRAIN = 0.5;

// Self-contained on purpose: started with `eval`, it needs no file next to the
// built package and behaves the same from source, from `dist`, and in tests.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const babel = require(workerData.babelCorePath);

function serializeError(error) {
  if (error === null || typeof error !== "object") {
    return { message: String(error), name: "Error" };
  }
  return {
    code: error.code,
    loc: error.loc,
    message: String(error.message),
    name: String(error.name || "Error"),
    reasonCode: error.reasonCode,
    stack: typeof error.stack === "string" ? error.stack : undefined,
  };
}

parentPort.on("message", (task) => {
  Promise.resolve()
    .then(() => babel.transformAsync(task.code, task.options))
    .then(
      (output) => {
        parentPort.postMessage({
          code: output && output.code != null ? output.code : null,
          id: task.id,
          map: output && output.map != null ? output.map : null,
          ok: true,
        });
      },
      (error) => {
        parentPort.postMessage({ error: serializeError(error), id: task.id, ok: false });
      },
    );
});

parentPort.postMessage({ ready: true });
`;

/** Worker count for this machine: leave a core for the bundler's own threads. */
export function resolveBabelWorkerCount(
  env: Record<string, string | undefined> = process.env,
): number {
  const configured = env.VIFX_BABEL_WORKERS;
  if (configured !== undefined && configured.trim() !== "") {
    const parsed = Number.parseInt(configured, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return Math.max(0, Math.min(availableParallelism() - 1, MAX_DEFAULT_WORKERS));
}

function reviveError(serialized: SerializedBabelError): Error {
  const error = new Error(serialized.message) as Error & Record<string, unknown>;
  error.name = serialized.name;
  if (serialized.stack !== undefined) {
    error.stack = serialized.stack;
  }
  if (serialized.code !== undefined) {
    error.code = serialized.code;
  }
  if (serialized.loc !== undefined) {
    error.loc = serialized.loc;
  }
  if (serialized.reasonCode !== undefined) {
    error.reasonCode = serialized.reasonCode;
  }
  return error;
}

export function createBabelWorkerPool(options: BabelWorkerPoolOptions): BabelWorkerPool {
  const maxWorkers = options.maxWorkers ?? resolveBabelWorkerCount();
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const workers = new Set<PoolWorker>();
  const queue: PoolTask[] = [];
  let nextTaskId = 0;
  let inlineActive = 0;
  // Set once a worker fails: from then on everything runs inline.
  let disabled = maxWorkers <= 0;
  let closed = false;

  // Babel runs synchronously inside its promise, so the calling thread never
  // sees two transforms "in flight": the next request only arrives once the
  // previous one has returned. Load is therefore measured in time, not in
  // queue depth: `inlineLoadMs` grows by what each inline transform cost and
  // drains while the thread is doing anything else.
  let inlineLoadMs = 0;
  let inlineLoadUpdatedAt = performance.now();

  const drainInlineLoad = (): void => {
    const now = performance.now();
    inlineLoadMs = Math.max(0, inlineLoadMs - (now - inlineLoadUpdatedAt) * INLINE_LOAD_DRAIN);
    inlineLoadUpdatedAt = now;
  };

  const runInline = async (task: PoolTask): Promise<void> => {
    inlineActive += 1;
    const startedAt = performance.now();
    try {
      task.resolve(await task.inline());
    } catch (error) {
      task.reject(error);
    } finally {
      inlineActive -= 1;
      const finishedAt = performance.now();
      inlineLoadMs += finishedAt - startedAt;
      inlineLoadUpdatedAt = finishedAt;
      pump();
    }
  };

  const hasReadyWorker = (): boolean => {
    for (const worker of workers) {
      if (worker.ready) {
        return true;
      }
    }
    return false;
  };

  const retire = (worker: PoolWorker): void => {
    if (worker.idleTimer !== null) {
      clearTimeout(worker.idleTimer);
      worker.idleTimer = null;
    }
    workers.delete(worker);
    void worker.thread.terminate();
  };

  /** A worker failed: stop using workers and finish its work on this thread. */
  const failWorker = (worker: PoolWorker): void => {
    if (!workers.has(worker)) {
      return;
    }
    disabled = true;
    const orphan = worker.task;
    worker.task = null;
    retire(worker);
    if (orphan) {
      queue.unshift(orphan);
    }
    pump();
  };

  const spawn = (): void => {
    let thread: Worker;
    try {
      thread = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { babelCorePath: options.babelCorePath },
      });
    } catch {
      disabled = true;
      return;
    }

    const worker: PoolWorker = { idleTimer: null, ready: false, task: null, thread };
    workers.add(worker);
    // A build that has finished must not be held open by idle workers.
    thread.unref();

    thread.on("message", (reply: WorkerReply) => {
      if (reply.ready === true) {
        worker.ready = true;
        pump();
        return;
      }

      const task = worker.task;
      if (!task || reply.id !== task.id) {
        return;
      }
      worker.task = null;
      if (reply.ok === true) {
        task.resolve({ code: reply.code ?? null, map: reply.map ?? null });
      } else {
        task.reject(reviveError(reply.error ?? { message: "Babel worker failed.", name: "Error" }));
      }
      pump();
    });
    thread.on("error", () => failWorker(worker));
    thread.on("exit", () => failWorker(worker));
  };

  function pump(): void {
    if (closed) {
      return;
    }

    if (disabled) {
      // One at a time: Babel occupies the thread for the whole transform.
      if (inlineActive === 0) {
        const task = queue.shift();
        if (task) {
          void runInline(task);
        }
      }
      return;
    }

    for (const worker of workers) {
      if (queue.length === 0) {
        break;
      }
      if (!worker.ready || worker.task !== null) {
        continue;
      }
      const task = queue.shift();
      if (!task) {
        break;
      }
      if (worker.idleTimer !== null) {
        clearTimeout(worker.idleTimer);
        worker.idleTimer = null;
      }
      worker.task = task;
      worker.thread.postMessage({ code: task.code, id: task.id, options: task.options });
    }

    // Grow while work is waiting. Sustained inline load means the whole build
    // is queued behind this thread, so the pool starts at full size; otherwise
    // each waiting task justifies at most one worker.
    let starting = 0;
    for (const worker of workers) {
      if (!worker.ready) {
        starting += 1;
      }
    }
    const wanted = inlineLoadMs >= ENGAGE_AFTER_INLINE_MS ? maxWorkers : queue.length;
    while (workers.size < maxWorkers && starting < wanted && queue.length > 0 && !disabled) {
      spawn();
      starting += 1;
    }

    // Until a worker is up, this thread keeps the build moving.
    if (queue.length > 0 && inlineActive === 0 && !hasReadyWorker()) {
      const task = queue.shift();
      if (task) {
        void runInline(task);
      }
    }

    for (const worker of workers) {
      if (worker.ready && worker.task === null && worker.idleTimer === null) {
        worker.idleTimer = setTimeout(() => {
          if (worker.task === null) {
            retire(worker);
          }
        }, idleTimeoutMs);
        worker.idleTimer.unref();
      }
    }
  }

  return {
    run(code, runOptions, inline) {
      return new Promise<BabelTransformOutput | null>((resolve, reject) => {
        const task: PoolTask = {
          code,
          id: (nextTaskId += 1),
          inline,
          options: runOptions,
          reject,
          resolve,
        };

        // Workers engage once they are already warm, when transforms visibly
        // overlap, or when this thread has been doing little else than Babel.
        // Short of that, starting a thread would cost more than the transform.
        drainInlineLoad();
        const engaged =
          workers.size > 0 ||
          queue.length > 0 ||
          inlineActive > 0 ||
          inlineLoadMs >= ENGAGE_AFTER_INLINE_MS;
        if (closed || disabled || !engaged) {
          void runInline(task);
          return;
        }

        queue.push(task);
        pump();
      });
    },
    async close() {
      closed = true;
      const pending = queue.splice(0);
      const orphans: PoolTask[] = [];
      for (const worker of workers) {
        if (worker.task) {
          orphans.push(worker.task);
          worker.task = null;
        }
        if (worker.idleTimer !== null) {
          clearTimeout(worker.idleTimer);
        }
        worker.thread.removeAllListeners("exit");
        worker.thread.removeAllListeners("error");
      }
      const threads = [...workers].map((worker) => worker.thread);
      workers.clear();
      await Promise.all(threads.map((thread) => thread.terminate()));
      for (const task of [...orphans, ...pending]) {
        await runInline(task);
      }
    },
    size() {
      return workers.size;
    },
  };
}

const sharedPools = new Map<string, BabelWorkerPool>();

/** One pool per `@babel/core` installation, shared by every build in the process. */
export function getSharedBabelWorkerPool(babelCorePath: string): BabelWorkerPool {
  let pool = sharedPools.get(babelCorePath);
  if (!pool) {
    pool = createBabelWorkerPool({ babelCorePath });
    sharedPools.set(babelCorePath, pool);
  }
  return pool;
}

/** Terminates every shared pool (tests, and callers that want a clean exit). */
export async function closeSharedBabelWorkerPools(): Promise<void> {
  const pools = [...sharedPools.values()];
  sharedPools.clear();
  await Promise.all(pools.map((pool) => pool.close()));
}
