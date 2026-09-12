import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderGapsMarkdown } from "../src/gaps/markdown.ts";

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "GAPS.md");
writeFileSync(target, renderGapsMarkdown(), "utf8");
console.log(`Wrote ${target}`);
