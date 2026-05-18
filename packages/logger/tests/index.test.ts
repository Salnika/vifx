import { expect, test } from "vite-plus/test";
import { VifxError } from "@vifx/errors";
import { createLogger } from "../src/index.ts";

function createMemoryStream() {
  const chunks: string[] = [];

  return {
    chunks,
    stream: {
      write(chunk: string) {
        chunks.push(chunk);
      },
    },
  };
}

test("pretty logging stays concise by default", () => {
  const { chunks, stream } = createMemoryStream();
  const logger = createLogger({
    name: "vifx",
    stream,
    errorStream: stream,
  });

  logger.info("Inspecting Expo project", { cwd: "/repo" });

  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toContain("[INFO] vifx Inspecting Expo project");
  expect(chunks[0]).not.toContain("Context:");
});

test("json logging produces machine-readable error records", () => {
  const { chunks, stream } = createMemoryStream();
  const logger = createLogger({
    name: "vifx",
    json: true,
    stream,
    errorStream: stream,
  });

  logger.error(
    new VifxError({
      code: "VIFX_CONFIG_INVALID",
      message: "The configured platforms list is empty.",
      hint: 'Provide at least one platform such as "ios".',
    }),
    { filePath: "/repo/vifx.config.ts" },
  );

  const record = JSON.parse(chunks[0]);
  expect(record.level).toBe("error");
  expect(record.logger).toBe("vifx");
  expect(record.error.code).toBe("VIFX_CONFIG_INVALID");
  expect(record.context.filePath).toBe("/repo/vifx.config.ts");
});

test("silent mode suppresses non-critical logs", () => {
  const { chunks, stream } = createMemoryStream();
  const logger = createLogger({
    silent: true,
    stream,
    errorStream: stream,
  });

  logger.info("This should not be emitted");
  logger.error("This should still be emitted");

  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toContain("This should still be emitted");
});

test("environment variables override defaults", () => {
  const { chunks, stream } = createMemoryStream();

  const originalVerbose = process.env.VIFX_VERBOSE;
  const originalDebug = process.env.VIFX_DEBUG;

  try {
    process.env.VIFX_VERBOSE = "true";
    process.env.VIFX_DEBUG = "true";

    const logger = createLogger({
      name: "vifx",
      stream,
      errorStream: stream,
    });

    expect(logger.level).toBe("debug");

    logger.debug("Debug message", { detail: "something" });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("[DEBUG] vifx Debug message");
    expect(chunks[0]).toContain("Context: {");
    expect(chunks[0]).toContain('"detail": "something"');
  } finally {
    process.env.VIFX_VERBOSE = originalVerbose;
    process.env.VIFX_DEBUG = originalDebug;
  }
});
