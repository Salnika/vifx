// THROWAWAY SPIKE (A4 Variant A). Outside src/. Answers the GO/NO-GO question:
// Does a WARM RolldownBuild reuse a transform cache, and can a re-call of
// generate() pick up a single-file edit and re-serialize ONLY that file's
// subgraph cheaply?
//
// Method: instrument the `transform` hook to count invocations per file.
// 1. rolldown({ input }) -> warm build handle.
// 2. generate() #1  (cold) -> record transform counts + time.
// 3. EDIT one leaf file on disk (b.js).
// 4. generate() #2  on the SAME handle -> does it (a) re-read the edited file?
//    (b) re-run transform for changed file only? (c) reuse cache for unchanged?
//    + time the delta.
// 5. Also test: with experimental.incrementalBuild:true, same probe.

import { rolldown } from "./resolve-rolldown.mjs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const FIX = mkdtempSync(join(tmpdir(), "vifx-a4-warm-")) + "/";
mkdirSync(FIX, { recursive: true });
const A = FIX + "a.js";
const B = FIX + "b.js";
const C = FIX + "c.js";

function resetFixture() {
  writeFileSync(A, `import { b } from "./b.js";\nimport { c } from "./c.js";\nexport const a = () => b() + c() + "v0";\n`);
  writeFileSync(B, `export const b = () => "b";\n`);
  writeFileSync(C, `export const c = () => "c";\n`);
}

function makeCountingPlugin(counts) {
  return {
    name: "spike-transform-counter",
    transform(code, id) {
      if (id.endsWith(".js")) {
        const key = id.split("/").pop();
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return null;
    },
  };
}

async function run(label, { incrementalBuild }) {
  console.log(`\n=== ${label} (incrementalBuild=${!!incrementalBuild}) ===`);
  resetFixture();
  const counts = {};
  const inputOptions = {
    input: A,
    plugins: [makeCountingPlugin(counts)],
    ...(incrementalBuild ? { experimental: { incrementalBuild: true } } : {}),
  };

  let bundle;
  try {
    bundle = await rolldown(inputOptions);
  } catch (e) {
    console.log("  rolldown() threw:", e.message);
    return;
  }

  // generate #1 (cold)
  const t0 = performance.now();
  let out1;
  try {
    out1 = await bundle.generate({ format: "cjs" });
  } catch (e) {
    console.log("  generate#1 threw:", e.message);
    await bundle.close();
    return;
  }
  const t1 = performance.now();
  const code1 = out1.output.find((o) => o.type === "chunk")?.code ?? "";
  console.log(`  generate#1: ${(t1 - t0).toFixed(2)}ms  transformCounts=${JSON.stringify(counts)}`);
  console.log(`  generate#1 contains "v0": ${code1.includes('"v0"')}, contains '"b"': ${code1.includes('() => "b"')}`);

  // EDIT b.js on disk
  writeFileSync(B, `export const b = () => "b-EDITED";\n`);
  for (const k of Object.keys(counts)) counts[k] = 0; // reset counters

  // generate #2 (warm handle, re-call generate)
  const t2 = performance.now();
  let out2;
  try {
    out2 = await bundle.generate({ format: "cjs" });
  } catch (e) {
    console.log("  generate#2 threw:", e.message);
    await bundle.close();
    return;
  }
  const t3 = performance.now();
  const code2 = out2.output.find((o) => o.type === "chunk")?.code ?? "";
  console.log(`  generate#2 (warm, after edit): ${(t3 - t2).toFixed(2)}ms  transformCounts=${JSON.stringify(counts)}`);
  console.log(`  generate#2 picked up edit ("b-EDITED" present): ${code2.includes("b-EDITED")}`);
  console.log(`  generate#2 re-ran ANY transform: ${Object.values(counts).some((v) => v > 0)}`);

  // Probe for any hidden invalidate/rebuild on the handle
  const protoMethods = [];
  let p = Object.getPrototypeOf(bundle);
  while (p && p !== Object.prototype) {
    for (const n of Object.getOwnPropertyNames(p)) protoMethods.push(n);
    p = Object.getPrototypeOf(p);
  }
  const hot = protoMethods.filter((m) => /invalidate|rebuild|hot|update|patch/i.test(m));
  console.log(`  handle methods matching invalidate/rebuild/hot/update/patch: ${JSON.stringify(hot)}`);
  console.log(`  all handle methods: ${JSON.stringify([...new Set(protoMethods)].filter((m) => m !== "constructor"))}`);

  await bundle.close();
}

await run("WARM generate() x2", { incrementalBuild: false });
await run("WARM generate() x2 + incrementalBuild", { incrementalBuild: true });
resetFixture();
console.log("\n[spike] done.");
