import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(import.meta.dirname, "..");
const ERP = join(ROOT, "apps", "erp", "app");

function walkDir(dir: string, ext: string[]): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full, ext));
    } else if (entry.isFile() && ext.some((e) => entry.name.endsWith(e))) {
      files.push(full);
    }
  }
  return files;
}

function getFiles(): string[] {
  const files: string[] = [];

  const routesDir = join(ERP, "routes");
  const modulesDir = join(ERP, "modules");
  files.push(...walkDir(routesDir, [".ts", ".tsx"]));
  files.push(...walkDir(modulesDir, [".ts", ".tsx"]));

  const entryServer = join(ERP, "entry.server.tsx");
  if (existsSync(entryServer)) files.push(entryServer);

  const root = join(ERP, "root.tsx");
  if (existsSync(root)) files.push(root);

  return [...new Set(files)];
}

// Pattern A: (serviceRole, ...) → (...), with negative lookbehind for the exception
const PATTERN_A = /(?<!getSupplierApprovalContext)\(\s*serviceRole\s*,\s*/gs;
// Pattern B: (serviceRole) → ()
const PATTERN_B = /(?<!getSupplierApprovalContext)\(\s*serviceRole\s*\)/gs;
// Pattern C: (getCarbonServiceRole(), ...) → (...)
const PATTERN_C = /\(\s*getCarbonServiceRole\(\)\s*,\s*/gs;
// Pattern D: (getCarbonServiceRole()) → ()
const PATTERN_D = /\(\s*getCarbonServiceRole\(\)\s*\)/gs;

function fixFile(filePath: string): boolean {
  const original = readFileSync(filePath, "utf-8");
  let content = original;

  content = content.replace(PATTERN_A, "(");
  content = content.replace(PATTERN_B, "()");
  content = content.replace(PATTERN_C, "(");
  content = content.replace(PATTERN_D, "()");

  if (content !== original) {
    writeFileSync(filePath, content, "utf-8");
    return true;
  }
  return false;
}

function main() {
  const files = getFiles();
  const changed: string[] = [];

  console.log(`Scanning ${files.length} files...`);

  for (const file of files) {
    try {
      if (fixFile(file)) {
        changed.push(relative(ROOT, file));
      }
    } catch (err) {
      console.error(`Error processing ${file}:`, err);
    }
  }

  console.log(`\nChanged ${changed.length} files:\n`);
  for (const file of changed) {
    console.log(`  ${file}`);
  }
}

main();
