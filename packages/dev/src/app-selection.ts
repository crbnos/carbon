import { APP_CHOICES, type AppId } from "./constants.js";

/**
 * Which apps `crbn up` should spawn, decided from the flags alone.
 *
 * - `none` — services-only boot (`--no-apps`).
 * - `all` — every app (`--all`), minus the assembler when its OCCT build is
 *   missing (that leniency belongs to `--all` only; see `up.ts`).
 * - `explicit` — the exact set the user named (`--app`). An app named here is
 *   spawned or the boot fails; nothing is silently dropped.
 * - `prompt` — no app flag given: the interactive picker, or `CARBON_DEV_APPS`,
 *   or the non-TTY default (`pickApps`).
 */
export type AppSelection =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "explicit"; apps: AppId[] }
  | { kind: "prompt" };

const APP_IDS: readonly AppId[] = APP_CHOICES.map((c) => c.value);
const VALID_IDS = APP_IDS.join(", ");

/**
 * Parse `--app` into app ids. Accepts repetition (`--app erp --app mes`), commas
 * (`--app erp,mes`), or both — citty hands repeated string flags over as an array.
 *
 * Deliberately strict, unlike the `CARBON_DEV_APPS` path in `pickApps`, which
 * silently drops unknown entries: a typo in a flag that decides what boots must
 * fail loudly rather than quietly bring up half a stack.
 */
export function parseAppIds(raw: string | string[]): AppId[] {
  const tokens = (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => String(value).split(","))
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    throw new Error(
      `--app needs at least one app id (${VALID_IDS}).\n` +
        `  for a services-only boot use \`crbn up --no-apps\` instead.`
    );
  }

  const unknown = tokens.filter((t) => !isAppId(t));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown app${unknown.length > 1 ? "s" : ""} for --app: ${unknown.join(", ")}\n` +
        `  valid ids: ${VALID_IDS}`
    );
  }

  // Dedupe, preserving the order the user asked for.
  return [...new Set(tokens as AppId[])];
}

/**
 * Fold the three app-selecting flags into one decision, rejecting the
 * combinations that contradict each other rather than silently letting one win
 * — a contradictory flag pair in a CI invocation is a mistake worth surfacing.
 *
 * Every other `up` flag (`--borrow`, `--run`, `--minimal`, `--no-portless`,
 * `--thumbnails`, …) is orthogonal to this and composes freely.
 */
export function resolveAppSelection(flags: {
  /** False only when `--no-apps` was passed. */
  apps?: boolean;
  all?: boolean;
  app?: string | string[];
}): AppSelection {
  const named = flags.app !== undefined;
  const noApps = flags.apps === false;
  const all = flags.all === true;

  if (named && noApps) {
    throw new Error(
      "--app and --no-apps contradict each other.\n" +
        "  --app names apps to spawn; --no-apps spawns none. Pass one."
    );
  }
  if (named && all) {
    throw new Error(
      "--app and --all contradict each other.\n" +
        "  --all already selects every app. Pass one."
    );
  }
  if (all && noApps) {
    throw new Error(
      "--all and --no-apps contradict each other.\n" +
        "  --all selects every app; --no-apps spawns none. Pass one."
    );
  }

  if (noApps) return { kind: "none" };
  if (flags.app !== undefined) {
    return { kind: "explicit", apps: parseAppIds(flags.app) };
  }
  if (all) return { kind: "all" };
  return { kind: "prompt" };
}

function isAppId(value: string): value is AppId {
  return (APP_IDS as readonly string[]).includes(value);
}
