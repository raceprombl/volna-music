import type { Settings } from "./types";
const ranks = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };
export function log(
  settings: Settings,
  level: "error" | "warn" | "info" | "debug",
  action: string,
  details: Record<string, string | number> = {},
) {
  if (ranks[settings.logLevel ?? "off"] < ranks[level]) return;
  console[level]("[VOLNA]", action, details);
}
