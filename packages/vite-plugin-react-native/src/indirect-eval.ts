import MagicString from "magic-string";
import type { Plugin } from "vite";

// Direct `eval` used as a call: preceded by a non-member, non-identifier char
// (so `foo.eval(` and `globalEval(` are left alone) and followed by `(`.
const DIRECT_EVAL_CALL = /(^|[^.\w$])eval(?=\s*\()/g;

/**
 * Rewrites direct `eval(` calls to indirect `(0, eval)(` in the bundled output.
 *
 * Why: a single direct `eval` anywhere in a bundle forces the minifier to keep
 * every identifier in scope — oxc-minify disables identifier mangling globally
 * when it sees direct eval (it cannot prove the eval won't reference a local by
 * name). React Native ships exactly one (the fallback in
 * `Libraries/Core/Devtools/loadBundleFromServer.js`), and that lone call is
 * enough to leave the entire native release bundle un-mangled — ~8% larger than
 * Metro, whose terser-based minifier scopes the restriction to the containing
 * function instead.
 *
 * Indirect eval evaluates its argument in the global scope, which is exactly the
 * semantics these call sites want (they eval a fetched bundle/script, and on
 * Hermes the `globalEvalWithSourceUrl` branch is taken anyway), so the rewrite
 * is behavior-preserving. It runs in `renderChunk` — before the toolchain's
 * integrated minify — so the minifier then mangles the whole bundle. magic-string
 * keeps the source map accurate.
 *
 * Production-only: there is no point paying the scan in development (no minify),
 * and it keeps the validated dev output untouched.
 */
export function createIndirectEvalPlugin(): Plugin {
  return {
    name: "vifx:indirect-eval",
    renderChunk(code) {
      DIRECT_EVAL_CALL.lastIndex = 0;
      if (!DIRECT_EVAL_CALL.test(code)) {
        return null;
      }

      const magicString = new MagicString(code);
      DIRECT_EVAL_CALL.lastIndex = 0;
      for (
        let match = DIRECT_EVAL_CALL.exec(code);
        match !== null;
        match = DIRECT_EVAL_CALL.exec(code)
      ) {
        const prefixLength = match[1]?.length ?? 0;
        const evalStart = match.index + prefixLength;
        magicString.overwrite(evalStart, evalStart + "eval".length, "(0,eval)");
      }

      return { code: magicString.toString(), map: magicString.generateMap({ hires: true }) };
    },
  };
}
