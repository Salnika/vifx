import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  createBabelWorkerPool,
  resolveBabelWorkerCount,
  type BabelWorkerPool,
} from "../src/babel/worker-pool.ts";

// A stand-in for `@babel/core`: tags its output with the thread it ran on so a
// test can tell a worker transform from an inline one.
const FAKE_BABEL_CORE = `
const { threadId } = require("node:worker_threads");
exports.transformAsync = async (code, options) => {
  if (code.includes("SYNTAX_ERROR")) {
    const error = new SyntaxError("Unexpected token (1:4)");
    error.code = "BABEL_PARSE_ERROR";
    error.loc = { column: 4, line: 1 };
    throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { code: code.toUpperCase() + "/*" + options.filename + "@" + threadId + "*/", map: { version: 3 } };
};
`;

describe("babel worker pool", () => {
  let workDir: string;
  let corePath: string;
  let pool: BabelWorkerPool | null = null;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "vifx-babel-pool-"));
    corePath = path.join(workDir, "fake-babel-core.cjs");
    await writeFile(corePath, FAKE_BABEL_CORE, "utf8");
  });

  afterEach(async () => {
    await pool?.close();
    pool = null;
    await rm(workDir, { force: true, recursive: true });
  });

  const inlineFor = (code: string, filename: string) => async () => ({
    code: `${code.toUpperCase()}/*${filename}@inline*/`,
    map: null,
  });

  test("a lone transform runs on the calling thread and starts no worker", async () => {
    pool = createBabelWorkerPool({ babelCorePath: corePath, maxWorkers: 4 });

    const output = await pool.run("a", { filename: "a.js" }, inlineFor("a", "a.js"));

    expect(output?.code).toBe("A/*a.js@inline*/");
    expect(pool.size()).toBe(0);
  });

  test("concurrent transforms are spread over workers and keep their own results", async () => {
    pool = createBabelWorkerPool({ babelCorePath: corePath, maxWorkers: 3 });
    const names = Array.from({ length: 24 }, (_, index) => `m${String(index)}`);

    const outputs = await Promise.all(
      names.map((name) =>
        pool!.run(name, { filename: `${name}.js` }, async () => {
          // Slow inline path, so the queue builds up and workers take over.
          await new Promise((resolve) => setTimeout(resolve, 40));
          return (await inlineFor(name, `${name}.js`)()) as { code: string; map: null };
        }),
      ),
    );

    for (const [index, name] of names.entries()) {
      expect(outputs[index]?.code?.startsWith(`${name.toUpperCase()}/*${name}.js@`)).toBe(true);
    }
    const onWorkers = outputs.filter((output) => !output?.code?.endsWith("@inline*/"));
    expect(onWorkers.length).toBeGreaterThan(0);
    expect(onWorkers[0]?.map).toStrictEqual({ version: 3 });
    expect(pool.size()).toBeLessThanOrEqual(3);
  });

  test("back-to-back blocking transforms engage the workers even though none overlap", async () => {
    pool = createBabelWorkerPool({ babelCorePath: corePath, maxWorkers: 2 });
    const blockingInline = (name: string) => async () => {
      // Real Babel holds the thread for the whole transform, so the next
      // request never sees one in flight; only elapsed time reveals the load.
      const until = performance.now() + 30;
      while (performance.now() < until) {
        // busy wait
      }
      return (await inlineFor(name, `${name}.js`)()) as { code: string; map: null };
    };

    const pending: Promise<{ code?: string | null } | null>[] = [];
    for (let index = 0; index < 60; index += 1) {
      const name = `m${String(index)}`;
      pending.push(pool.run(name, { filename: `${name}.js` }, blockingInline(name)));
      await new Promise((resolve) => setImmediate(resolve));
    }
    const outputs = await Promise.all(pending);

    expect(outputs[0]?.code).toBe("M0/*m0.js@inline*/");
    expect(outputs.some((output) => !output?.code?.endsWith("@inline*/"))).toBe(true);
    for (const [index, output] of outputs.entries()) {
      expect(output?.code?.startsWith(`M${String(index)}/*m${String(index)}.js@`)).toBe(true);
    }
  });

  test("a Babel error raised in a worker keeps its message, code and location", async () => {
    pool = createBabelWorkerPool({ babelCorePath: corePath, maxWorkers: 2 });
    const slowInline = async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { code: "inline", map: null };
    };

    // Occupy the calling thread so the failing transform lands on a worker.
    const first = pool.run("ok", { filename: "ok.js" }, slowInline);
    const failing = pool.run("SYNTAX_ERROR", { filename: "bad.js" }, async () => {
      const error = new SyntaxError("inline path should not run") as Error & { code?: string };
      error.code = "INLINE";
      throw error;
    });
    const filler = pool.run("x", { filename: "x.js" }, slowInline);

    await expect(failing).rejects.toMatchObject({
      code: "BABEL_PARSE_ERROR",
      loc: { column: 4, line: 1 },
      message: "Unexpected token (1:4)",
      name: "SyntaxError",
    });
    await Promise.all([first, filler]);
  });

  test("a pool whose workers cannot start still completes every transform inline", async () => {
    pool = createBabelWorkerPool({
      babelCorePath: path.join(workDir, "missing-babel-core.cjs"),
      maxWorkers: 2,
    });
    const names = ["a", "b", "c", "d", "e"];

    const outputs = await Promise.all(
      names.map((name) =>
        pool!.run(name, { filename: `${name}.js` }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          return (await inlineFor(name, `${name}.js`)()) as { code: string; map: null };
        }),
      ),
    );

    expect(outputs.map((output) => output?.code)).toStrictEqual(
      names.map((name) => `${name.toUpperCase()}/*${name}.js@inline*/`),
    );
    expect(pool.size()).toBe(0);
  });

  test("the worker count honours VIFX_BABEL_WORKERS and never goes negative", () => {
    expect(resolveBabelWorkerCount({ VIFX_BABEL_WORKERS: "0" })).toBe(0);
    expect(resolveBabelWorkerCount({ VIFX_BABEL_WORKERS: "3" })).toBe(3);
    expect(resolveBabelWorkerCount({ VIFX_BABEL_WORKERS: "nope" })).toBeGreaterThanOrEqual(0);
    expect(resolveBabelWorkerCount({})).toBeLessThanOrEqual(8);
  });
});
