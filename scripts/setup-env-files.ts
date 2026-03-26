import {
  copyFileSync,
  existsSync,
  lstatSync,
  rmSync,
  symlinkSync
} from "fs";
import { join } from "path";

const ROOT_ENV_PATH = join(process.cwd(), ".env");

if (!existsSync(ROOT_ENV_PATH)) {
  throw new Error("No .env file found in root directory");
}

const APPS_DIR = join(process.cwd(), "apps");
const PACKAGES_DIR = join(process.cwd(), "packages");

// List of package folders that need .env symlinks
const PACKAGE_FOLDERS = ["database", "jobs", "kv"];

function createSymlink(targetPath: string, sourcePath: string) {
  try {
    // Clear any existing file or link before recreating it.
    if (existsSync(targetPath)) {
      const stat = lstatSync(targetPath);
      rmSync(targetPath, {
        force: true,
        recursive: stat.isDirectory() && !stat.isSymbolicLink()
      });
    }

    // Prefer symlinks so local changes to the root env file are reflected
    // immediately across apps and packages.
    symlinkSync(sourcePath, targetPath);
    console.log(`Created symlink at ${targetPath}`);
  } catch (error) {
    console.warn(`Failed to create symlink at ${targetPath}, copying .env instead.`);
    try {
      copyFileSync(sourcePath, targetPath);
      console.log(`Copied .env to ${targetPath}`);
    } catch (copyError) {
      console.error(`Failed to copy .env to ${targetPath}:`, copyError);
    }
  }
}

// Create symlinks in apps directory
if (existsSync(APPS_DIR)) {
  const apps = ["erp", "mes", "academy", "starter"];
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
