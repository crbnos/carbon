// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, rmSync, symlinkSync } from "fs";
import { join } from "path";

const ROOT_ENV_PATH = join(process.cwd(), ".env");
const ROOT_ENV_LOCAL_PATH = join(process.cwd(), ".env.local");

// `crbn up` writes the stack's own values to `.env.local`; the one secret it
// cannot make is SESSION_SECRET, which `.env` or the environment (a cloud
// container's secret settings) has to give.
if (!existsSync(ROOT_ENV_PATH) && !process.env.SESSION_SECRET) {
  throw new Error(
    "No .env file found in root directory, and SESSION_SECRET is not set: copy .env.example to .env, or set SESSION_SECRET in the environment"
  );
}

const APPS_DIR = join(process.cwd(), "apps");
const PACKAGES_DIR = join(process.cwd(), "packages");

// List of package folders that need .env symlinks
const PACKAGE_FOLDERS = ["database", "jobs", "kv"];

function createSymlink(targetPath: string, sourcePath: string) {
  // force: also a dangling link (a moved worktree's), which existsSync misses.
  rmSync(targetPath, { force: true });
  symlinkSync(sourcePath, targetPath);
  console.log(`Created symlink at ${targetPath}`);
}

function linkBoth(targetDir: string) {
  if (existsSync(ROOT_ENV_PATH)) {
    createSymlink(join(targetDir, ".env"), ROOT_ENV_PATH);
  }
  if (existsSync(ROOT_ENV_LOCAL_PATH)) {
    createSymlink(join(targetDir, ".env.local"), ROOT_ENV_LOCAL_PATH);
  }
}

// Create symlinks in apps directory
if (existsSync(APPS_DIR)) {
  const apps = ["erp", "mes", "academy", "starter"];
  apps.forEach((app) => linkBoth(join(APPS_DIR, app)));
}

// Create symlinks in selected packages
if (existsSync(PACKAGES_DIR)) {
  PACKAGE_FOLDERS.forEach((pkg) => linkBoth(join(PACKAGES_DIR, pkg)));
}

// The edge functions read supabase/functions/.env.
const supabaseFunctionsDir = join(PACKAGES_DIR, "database", "supabase", "functions");
linkBoth(supabaseFunctionsDir);
console.log("Environment file setup complete!");
