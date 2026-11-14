import { styleText } from "node:util";

type Style = Parameters<typeof styleText>[0];

/**
 * Colors text for the terminal. The text stays plain when stdout is not a
 * color terminal or when NO_COLOR (or FORCE_COLOR=0) is set, so pipes, logs
 * and `--json` output carry no escape codes.
 */
export function paint(style: Style, text: string): string {
  return styleText(style, text, { stream: process.stdout });
}

const LABEL_STYLES: Record<string, Style> = {
  ACTION: ["bold", "blue"],
  ERROR: ["bold", "red"],
  FIXED: ["bold", "green"],
  INFO: ["bold", "cyan"],
  MANUAL: ["bold", "yellow"],
  OK: ["bold", "green"],
  UNSUP: ["bold", "magenta"],
  WARN: ["bold", "yellow"],
};

/** A report label such as `WARN`, padded to `width` and colored by severity. */
export function severityLabel(label: string, width: number): string {
  return paint(LABEL_STYLES[label] ?? "bold", label.padEnd(width));
}
