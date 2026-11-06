// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, symlinkSync, unlinkSync } from "fs";
import { join } from "path";

const ROOT_ENV_PATH = join(process.cwd(), ".env");
const ROOT_ENV_LOCAL_PATH = join(process.cwd(), ".env.local");

// Cloud containers can boot without a `.env` file: `crbn up` writes stack
// configuration to `.env.local`; SESSION_SECRET comes from environment settings.
const CLOUD_DEV = process.env.CARBON_DEV_CLOUD === "1";
if (!existsSync(ROOT_ENV_PATH) && !CLOUD_DEV) {
  throw new Error("No .env file found in root directory");
}

const APPS_DIR = join(process.cwd(), "apps");
const PACKAGES_DIR = join(process.cwd(), "packages");

// List of package folders that need .env symlinks
const PACKAGE_FOLDERS = ["database", "jobs", "kv"];

function createSymlink(targetPath: string, sourcePath: string) {
  try {
    // Remove existing symlink if it exists
    if (existsSync(targetPath)) {
      unlinkSync(targetPath);
    }

    // Create new symlink
    symlinkSync(sourcePath, targetPath);
    console.log(`Created symlink at ${targetPath}`);
  } catch (error) {
    console.error(`Failed to create symlink at ${targetPath}:`, error);
  }
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

// Copy root .env into supabase/functions/.env so edge functions get all env vars
// Must be a copy (not symlink) because edge functions run inside Docker
const supabaseFunctionsDir = join(PACKAGES_DIR, "database", "supabase", "functions");
linkBoth(supabaseFunctionsDir);
console.log("Environment file setup complete!");
