// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** File names + paths used across the CLI. */
// Relative to the repo root (the cwd the CLI runs docker from). Compose is
// always invoked with `--project-directory .` so the file's `./packages/...`
// volume mounts still resolve from the root, not from this file's directory.
export const COMPOSE_DEV_FILE = "packages/dev/docker/docker-compose.dev.yml";

// Pre-move location. Older worktrees still have the file here; the CLI falls
// back to it when COMPOSE_DEV_FILE is absent so existing checkouts keep working.
export const COMPOSE_DEV_FILE_LEGACY = "docker-compose.dev.yml";

/** Apps the CLI knows how to spawn through portless. */
export const APP_CHOICES = [
  { value: "erp", label: "ERP", hint: "main app" },
  { value: "mes", label: "MES", hint: "shop floor" },
  {
    value: "assembler",
    label: "Assembler",
    hint: "CAD convert + motion planning"
  },
  {
    value: "email",
    label: "Email previews",
    hint: "react-email server for every email template"
  },
  {
    value: "studio",
    label: "Studio",
    hint: "Supabase dashboard for the local database"
  }
] as const;
export type AppId = (typeof APP_CHOICES)[number]["value"];

/** Compose services that get registered as portless aliases (host TCP). */
export const ALIAS_SERVICES = ["api", "studio", "mail", "inngest"] as const;

/** Minimum portless version that supports bare invocation + package.json config. */
export const PORTLESS_MIN_VERSION = "0.11.0";

/** Hostname TLD portless serves under. */
export const TLD = "dev";
