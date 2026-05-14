#!/usr/bin/env node
// Normalize .po files before commit. Strips two churn sources:
//
//   1. `POT-Creation-Date` header — wall clock at extract time, produces a
//      1-line diff per file on every run even when nothing changed.
//   2. `#: path:lineno` origin refs — shift on any upstream code edit, the
//      biggest PR-conflict source.
//
// `pnpm run translate` deliberately runs `lingui:extract` BEFORE invoking
// linguito so origins exist while linguito resolves source files for LLM
// context. After commit they're stripped here.
import { readFileSync, writeFileSync } from "node:fs";
import { glob } from "node:fs/promises";

const CATALOG_GLOB = "packages/locale/locales/*/*.po";
const STRIP_DATE = /^"POT-Creation-Date: .*\\n"\n/m;
const STRIP_ORIGIN = /^#:.*\n/gm;

let touched = 0;
for await (const path of glob(CATALOG_GLOB)) {
  const src = readFileSync(path, "utf8");
  const out = src.replace(STRIP_DATE, "").replace(STRIP_ORIGIN, "");
  if (out !== src) {
    writeFileSync(path, out);
    touched += 1;
  }
}
console.log(`strip-po-headers: ${touched} file(s) normalized`);
