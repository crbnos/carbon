// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, lstatSync, symlinkSync, unlinkSync } from "fs";
import { join } from "path";

// Both are optional. `.env` holds the developer's own secrets; a local stack
// boots without one, since `crbn up` writes everything it needs to `.env.local`.
const ROOT_ENV_PATH = join(process.cwd(), ".env");
const ROOT_ENV_LOCAL_PATH = join(process.cwd(), ".env.local");

const APPS_DIR = join(process.cwd(), "apps");
const PACKAGES_DIR = join(process.cwd(), "packages");

// List of package folders that need .env symlinks
const PACKAGE_FOLDERS = ["database", "jobs", "kv"];

// `existsSync` is false for a symlink whose target is gone, and a dangling link
// would make `symlinkSync` fail with EEXIST — so look at the link itself.
function removeLink(targetPath: string) {
  try {
    lstatSync(targetPath);
  } catch {
    return;
  }
  unlinkSync(targetPath);
}

function createSymlink(targetPath: string, sourcePath: string) {
  try {
    removeLink(targetPath);
    symlinkSync(sourcePath, targetPath);
    console.log(`Created symlink at ${targetPath}`);
  } catch (error) {
    console.error(`Failed to create symlink at ${targetPath}:`, error);
  }
}

// Link each root env file that exists; drop the link of one that does not, so
// a removed `.env` leaves no dangling symlink behind.
function linkBoth(targetDir: string) {
  for (const [name, source] of [
    [".env", ROOT_ENV_PATH],
    [".env.local", ROOT_ENV_LOCAL_PATH]
  ] as const) {
    const target = join(targetDir, name);
    if (existsSync(source)) createSymlink(target, source);
    else removeLink(target);
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

// Copy root .env into supabase/functions/.env so edge functions get all env vars
// Must be a copy (not symlink) because edge functions run inside Docker
const supabaseFunctionsDir = join(PACKAGES_DIR, "database", "supabase", "functions");
linkBoth(supabaseFunctionsDir);
console.log("Environment file setup complete!");
