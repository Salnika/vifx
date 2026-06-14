import { expect, test } from "vite-plus/test";
import { createIndirectEvalPlugin } from "../src/indirect-eval.ts";

function renderChunk(code: string): { code: string } | null {
  const plugin = createIndirectEvalPlugin();
  const hook = plugin.renderChunk;
  const handler = typeof hook === "function" ? hook : hook?.handler;
  if (typeof handler !== "function") {
    throw new Error("renderChunk hook is not a function");
  }
  // The hook only reads its first argument (the chunk code); the Rollup plugin
  // context and the remaining chunk/options/meta arguments are unused.
  const renderChunkCode = handler as (code: string) => { code: string } | null;
  return renderChunkCode(code);
}

test("rewrites direct eval calls to indirect eval", () => {
  const result = renderChunk("function f(body){ return eval(body); }");
  expect(result?.code).toBe("function f(body){ return (0,eval)(body); }");
});

test("leaves member access and similar identifiers untouched", () => {
  const code = "g.eval(a); globalEval(b); myeval(c); evaluate(d);";
  const result = renderChunk(code);
  // None of these are a direct `eval(` call, so the chunk is unchanged.
  expect(result).toBeNull();
});

test("converts every direct eval and keeps the rest of the code intact", () => {
  const result = renderChunk("var x = eval(a); obj.eval(b); var y =eval (c);");
  expect(result?.code).toBe("var x = (0,eval)(a); obj.eval(b); var y =(0,eval) (c);");
});
