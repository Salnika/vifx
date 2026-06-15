// THROWAWAY SPIKE part 2. Isolate: is generate#2 fast because of a TRANSFORM
// CACHE, or just JIT warmup on a tiny graph? Generate a LARGER fixture
// (N modules) where transform cost dominates, run generate() many times,
// edit one leaf between some of them, and watch transform counts + timing.
//
// If generate() reuses a transform cache: after the first generate, the
// transform hook should fire ONLY for the edited file (and dependents),
// and timing should drop proportionally. If it re-transforms everything
// every call, the warm handle saves NOTHING -> NO-GO for Variant A.

import { rolldown } from "./resolve-rolldown.mjs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const DIR = join(mkdtempSync(join(tmpdir(), "vifx-a4-big-")), "biggen");
const N = 400; // 400 leaf modules

function genFixture() {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  // Each leaf has a non-trivial body so transform isn't free.
  for (let i = 0; i < N; i++) {
    const body = Array.from({ length: 20 }, (_, k) => `  const x${k} = (${i} + ${k}) * 3 - ${k};`).join("\n");
    writeFileSync(`${DIR}/mod${i}.js`, `export function mod${i}() {\n${body}\n  return x0 + x19 + ${i};\n}\n`);
  }
  const imports = Array.from({ length: N }, (_, i) => `import { mod${i} } from "./mod${i}.js";`).join("\n");
  const calls = Array.from({ length: N }, (_, i) => `mod${i}()`).join(" + ");
  writeFileSync(`${DIR}/entry.js`, `${imports}\nexport const total = () => ${calls};\n`);
}

function editLeaf(version) {
  // Edit mod0.js, SAME line height (so the "easy case" line-offset invariant holds).
  const body = Array.from({ length: 20 }, (_, k) => `  const x${k} = (${0} + ${k}) * 3 - ${k} + ${version};`).join("\n");
  writeFileSync(`${DIR}/mod0.js`, `export function mod0() {\n${body}\n  return x0 + x19 + 0;\n}\n`);
}

function counter() {
  const counts = { total: 0, files: new Set() };
  return {
    plugin: {
      name: "count",
      transform(_code, id) {
        if (id.endsWith(".js") && id.includes("biggen")) {
          counts.total++;
          counts.files.add(id.split("/").pop());
        }
        return null;
      },
    },
    counts,
    reset() {
      counts.total = 0;
      counts.files = new Set();
    },
  };
}

async function main() {
  genFixture();
  const { plugin, counts, reset } = counter();
  const bundle = await rolldown({ input: `${DIR}/entry.js`, plugins: [plugin] });

  // Warmup + cold generate
  let t = performance.now();
  await bundle.generate({ format: "cjs" });
  console.log(`generate#1 (cold): ${(performance.now() - t).toFixed(1)}ms  transforms=${counts.total} files=${counts.files.size}`);

  // generate again with NO edit (control: pure re-generate cost on warm handle)
  reset();
  t = performance.now();
  await bundle.generate({ format: "cjs" });
  console.log(`generate#2 (NO edit): ${(performance.now() - t).toFixed(1)}ms  transforms=${counts.total} files=${counts.files.size}  <-- if cache, transforms≈0`);

  // edit ONE leaf, regenerate
  editLeaf(1);
  reset();
  t = performance.now();
  await bundle.generate({ format: "cjs" });
  console.log(`generate#3 (1 leaf edited): ${(performance.now() - t).toFixed(1)}ms  transforms=${counts.total} files=${counts.files.size}  <-- if incremental, transforms≈1`);

  // edit same leaf again
  editLeaf(2);
  reset();
  t = performance.now();
  const out = await bundle.generate({ format: "cjs" });
  console.log(`generate#4 (1 leaf edited again): ${(performance.now() - t).toFixed(1)}ms  transforms=${counts.total} files=${counts.files.size}`);
  const code = out.output.find((o) => o.type === "chunk")?.code ?? "";
  console.log(`generate#4 picked up edit (" + 2" present in mod0): ${code.includes("* 3 - 19 + 2")}`);

  await bundle.close();
  rmSync(DIR, { recursive: true, force: true });
}

await main();
