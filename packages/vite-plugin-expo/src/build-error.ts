/**
 * The part of a build failure a developer acts on.
 *
 * A bundler error nests the real cause (a Babel syntax error with its code
 * frame, say) under layers of wrappers, each followed by a stack trace through
 * vifx's and the bundler's internals: dozens of lines of which a handful
 * matter. This keeps the innermost cause and drops the stack frames, which
 * leaves a syntax error in the exact shape Babel and Metro print it:
 *
 *     SyntaxError: /app/index.tsx: Unexpected token (45:17)
 *
 *       44 |   const [feed, setFeed] = useState("top");
 *     > 45 |   const broken = ;
 *          |                  ^
 *
 * React Native's LogBox recognizes that shape and shows it as a syntax error
 * with its code frame.
 */
export function summarizeBuildError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const lines = text.split("\n");

  let start = 0;
  for (const [index, line] of lines.entries()) {
    if (CAUSED_BY_LINE.test(line)) {
      start = index + 1;
    }
  }

  const kept = lines.slice(start).filter((line) => !STACK_FRAME_LINE.test(line));
  while (kept.length > 0 && (kept.at(-1) ?? "").trim() === "") {
    kept.pop();
  }
  while (kept.length > 0 && (kept[0] ?? "").trim() === "") {
    kept.shift();
  }

  // A nested cause is printed indented under its "Caused by:" line.
  const indent = Math.min(
    ...kept.filter((line) => line.trim() !== "").map((line) => /^ */u.exec(line)?.[0].length ?? 0),
  );
  const summary = kept
    .map((line) => (Number.isFinite(indent) ? line.slice(indent) : line))
    .join("\n");

  return summary === "" ? text.trim() : summary;
}

const CAUSED_BY_LINE = /^\s*Caused by:\s*$/u;
/** `    at name (file:line:col)` / `    at file:line:col`. */
const STACK_FRAME_LINE = /^\s+at .*(?:\)|:\d+:\d+)\s*$/u;

/** Whether a summarized build error is a compile error of the user's source. */
export function isSourceCompileError(summary: string): boolean {
  return /^(?:SyntaxError|ReferenceError): /u.test(summary);
}
