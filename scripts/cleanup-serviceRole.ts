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
  files.push(...walkDir(join(ERP, "routes"), [".ts", ".tsx"]));
  files.push(...walkDir(join(ERP, "modules"), [".ts", ".tsx"]));
  const entryServer = join(ERP, "entry.server.tsx");
  if (existsSync(entryServer)) files.push(entryServer);
  const root = join(ERP, "root.tsx");
  if (existsSync(root)) files.push(root);
  return [...new Set(files)];
}

const DECLARATION_RE = /^\s*const\s+serviceRole\s*=\s*(await\s+)?getCarbonServiceRole\(\);?/;
const IMPORT_RE = /^import\s*\{\s*getCarbonServiceRole\s*\}\s*from\s*["']@carbon\/auth\/client\.server["'];?/;
// Matches multiline imports like:
// import { ..., getCarbonServiceRole, ... } from "@carbon/auth/client.server";
const MULTILINE_IMPORT_RE = /^import\s*\{[^}]*getCarbonServiceRole[^}]*\}\s*from\s*["']@carbon\/auth\/client\.server["'];?/;

// Check if serviceRole is used after the given line index, stopping at the next declaration
// (since a subsequent `const serviceRole = getCarbonServiceRole()` shadows the current one)
function hasServiceRoleAfterLine(lines: string[], declLineIndex: number, allDeclLines: Set<number>): boolean {
  for (let i = declLineIndex + 1; i < lines.length; i++) {
    if (allDeclLines.has(i)) break; // next declaration shadows this one — stop
    const line = lines[i];
    if (/\bserviceRole\b/.test(line)) {
      return true;
    }
  }
  return false;
}

function hasGetCarbonServiceRoleReference(lines: string[], importLineIndex: number): boolean {
  for (let i = 0; i < lines.length; i++) {
    if (i === importLineIndex) continue;
    const line = lines[i];
    if (/\bgetCarbonServiceRole\b/.test(line)) {
      return true;
    }
  }
  return false;
}

function findImportLine(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (MULTILINE_IMPORT_RE.test(lines[i]) || IMPORT_RE.test(lines[i])) {
      return i;
    }
  }
  return -1;
}

function findDeclarationLines(lines: string[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (DECLARATION_RE.test(lines[i])) {
      result.push(i);
    }
  }
  return result;
}

function fixFile(filePath: string): string[] {
  const original = readFileSync(filePath, "utf-8");
  const lines = original.split("\n");
  const changes: string[] = [];

  const declLines = findDeclarationLines(lines);

  // Remove unused declarations (reverse order to preserve indices)
  // Check each declaration independently — only look for usages AFTER the declaration line
  if (declLines.length > 0) {
    const declSet = new Set(declLines);
    const linesToRemove: number[] = [];
    for (const idx of declLines) {
      if (!hasServiceRoleAfterLine(lines, idx, declSet)) {
        linesToRemove.push(idx);
      }
    }

    if (linesToRemove.length > 0) {
      const sorted = [...linesToRemove].sort((a, b) => b - a);
      for (const idx of sorted) {
        const line = lines[idx].trim();
        changes.push(`  removed declaration: "${line}"`);
        lines.splice(idx, 1);
      }
    }
  }

  // Check if we should also remove the import (even if there were no declarations)
  const importLine = findImportLine(lines);
  if (importLine >= 0) {
    if (!hasGetCarbonServiceRoleReference(lines, importLine)) {
      const line = lines[importLine].trim();
      changes.push(`  removed import: "${line}"`);
      lines.splice(importLine, 1);
    }
  }

  const result = lines.join("\n");
  if (result !== original) {
    writeFileSync(filePath, result, "utf-8");
  }

  return changes;
}

function main() {
  const files = getFiles();
  let totalFilesChanged = 0;
  let totalDeclarationsRemoved = 0;
  let totalImportsRemoved = 0;

  console.log(`Scanning ${files.length} files...\n`);

  for (const file of files) {
    try {
      const changes = fixFile(file);
      if (changes.length > 0) {
        totalFilesChanged++;
        console.log(`${relative(ROOT, file)}:`);
        for (const change of changes) {
          console.log(change);
          if (change.includes("declaration")) totalDeclarationsRemoved++;
          if (change.includes("import")) totalImportsRemoved++;
        }
        console.log();
      }
    } catch (err) {
      console.error(`Error processing ${file}:`, err);
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Files changed: ${totalFilesChanged}`);
  console.log(`  Declarations removed: ${totalDeclarationsRemoved}`);
  console.log(`  Imports removed: ${totalImportsRemoved}`);
}

main();
