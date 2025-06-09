import * as dotenv from "dotenv";
import {
  existsSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";

const ROOT_ENV_PATH = join(process.cwd(), ".env");

if (!existsSync(ROOT_ENV_PATH)) {
  throw new Error("No .env file found in root directory");
}

// Load and parse .env file
dotenv.config();
const DEFAULT_EMAIL = process.env.DEFAULT_EMAIL_ADDRESS;

if (!DEFAULT_EMAIL) {
  throw new Error("DEFAULT_EMAIL_ADDRESS not found in .env file");
}

const APPS_DIR = join(process.cwd(), "apps");
const PACKAGES_DIR = join(process.cwd(), "packages");
const SEED_SQL_PATH = join(PACKAGES_DIR, "database", "supabase", "seed.sql");

// List of package folders that need .env symlinks
const PACKAGE_FOLDERS = ["database", "kv"];

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

// Update seed.sql with new email
if (existsSync(SEED_SQL_PATH)) {
  try {
    const content = readFileSync(SEED_SQL_PATH, "utf8");
    const updatedContent = content.replace(
      /brad@carbonos\.dev/g,
      DEFAULT_EMAIL
    );
    writeFileSync(SEED_SQL_PATH, updatedContent);
    console.log(`Updated email in seed.sql`);
  } catch (error) {
    console.error(`Failed to update seed.sql:`, error);
  }
}

// Create symlinks in apps directory
if (existsSync(APPS_DIR)) {
  const apps = ["erp", "mes", "starter"];
  apps.forEach((app) => {
    const appEnvPath = join(APPS_DIR, app, ".env");
    createSymlink(appEnvPath, ROOT_ENV_PATH);
  });
}

// Create symlinks in selected packages
if (existsSync(PACKAGES_DIR)) {
  PACKAGE_FOLDERS.forEach((pkg) => {
    const pkgEnvPath = join(PACKAGES_DIR, pkg, ".env");
    createSymlink(pkgEnvPath, ROOT_ENV_PATH);
  });
}

console.log("Environment file setup complete!");
