import { FIXTURE_IDS, type FixtureId } from "@vifx/compat";
import { formatCompatReport, runCompatSuite } from "@vifx/compat-runner";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

const COMPAT_RUN_HELP = `Usage: vifx compat run [--adapter metro|vifx|all] [--report terminal|json|markdown] [--fixture <id>]

Runs first-pass compatibility cases against the available adapters.

Options:
  --adapter  Adapter id. Supports "metro", "vifx", or "all".
  --report   terminal, json, or markdown. Defaults to terminal.
  --fixture  Limit execution to a single fixture id.
  --help     Show this message.
`;

function isFixtureId(value: string): value is FixtureId {
  return FIXTURE_IDS.includes(value as FixtureId);
}

export async function runCompatRunCommand(argv: string[]): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help"],
    stringFlags: ["adapter", "report", "fixture"],
    aliases: {
      "-h": "--help",
    },
  });

  if (parsed.errors.length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: parsed.errors.join("\n"),
    };
  }

  if (parsed.flags.help) {
    return {
      exitCode: 0,
      stdout: COMPAT_RUN_HELP,
      stderr: "",
    };
  }

  const adapter = (parsed.flags.adapter as string | undefined) ?? "vifx";
  if (adapter !== "metro" && adapter !== "vifx" && adapter !== "all") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unsupported adapter "${adapter}".`,
    };
  }

  const reportFormat =
    (parsed.flags.report as "terminal" | "json" | "markdown" | undefined) ?? "terminal";
  const fixtureId = parsed.flags.fixture as string | undefined;
  let fixtureIds: FixtureId[] | undefined;

  if (fixtureId && !isFixtureId(fixtureId)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unknown fixture "${fixtureId}".`,
    };
  }

  if (fixtureId && isFixtureId(fixtureId)) {
    fixtureIds = [fixtureId];
  }

  if (adapter === "all") {
    const reports = await Promise.all(
      (["metro", "vifx"] as const).map((adapterId) =>
        runCompatSuite({
          adapter: adapterId,
          fixtureIds,
        }),
      ),
    );

    return {
      exitCode: 0,
      stdout:
        reportFormat === "json"
          ? JSON.stringify(reports, null, 2)
          : reports.map((report) => formatCompatReport(report, reportFormat)).join("\n\n"),
      stderr: "",
    };
  }

  const report = await runCompatSuite({
    adapter,
    fixtureIds,
  });

  return {
    exitCode: 0,
    stdout: formatCompatReport(report, reportFormat),
    stderr: "",
  };
}
