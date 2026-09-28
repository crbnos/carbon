import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import toolMetadataJson from "../app/routes/api+/mcp+/lib/tool-metadata.json";


const MODULES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../app/modules");

interface Tool {
  name: string;
  module: string;
  serviceParams: string[];
  injectAuth: string[];
}

const tools = (toolMetadataJson as unknown as { tools: Tool[] }).tools;

const sourceCache = new Map<string, string>();
function serviceSources(module: string): string {
  const cached = sourceCache.get(module);
  if (cached !== undefined) return cached;
  const dir = join(MODULES_DIR, module);
  let joined = "";
  try {
    joined = readdirSync(dir)
      .filter((f) => f.endsWith(".service.ts") || f.endsWith(".mcp.server.ts"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
  } catch {
    joined = "";
  }
  sourceCache.set(module, joined);
  return joined;
}

function signatureOf(source: string, fn: string): string | null {
  const match = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${fn}\\s*\\(`
  ).exec(source);
  if (!match) return null;
  const start = match.index + match[0].length;
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if ("([{<".includes(ch)) depth++;
    else if (")]}>".includes(ch)) {
      depth--;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return null;
}

function splitParams(signature: string): string[] {
  const params: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of signature) {
    if ("([{<".includes(ch)) depth++;
    else if (")]}>".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      params.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) params.push(current);
  return params;
}

const PAYLOAD_USER_ID = /(^|[{;,\s])userId\s*\??\s*:/;

function payloadDeclaresUserId(signature: string): boolean {
  return splitParams(signature).some((param) => {
    const colon = param.indexOf(":");
    if (colon < 0) return false;
    const name = param.slice(0, colon).trim().replace(/\?$/, "");
    if (name === "userId") return false;
    return PAYLOAD_USER_ID.test(param.slice(colon + 1));
  });
}

describe("payload userId injection", () => {
  it("marks every tool whose service payload declares a userId", () => {
    const missing = tools
      .filter((tool) => {
        const fn = tool.name.slice(tool.module.length + 1);
        const signature = signatureOf(serviceSources(tool.module), fn);
        return (
          signature !== null &&
          payloadDeclaresUserId(signature) &&
          !tool.injectAuth.includes("userId")
        );
      })
      .map((tool) => tool.name);

    expect(missing).toEqual([]);
  });

  it("does not inject into services that take userId positionally", () => {
    const positional = tools.filter(
      (tool) =>
        tool.serviceParams.includes("userId") &&
        tool.injectAuth.includes("userId")
    );

    expect(positional.map((tool) => tool.name)).toEqual([]);
  });

  it("covers the edge-function wrappers that surfaced this", () => {
    for (const name of [
      "production_createJobOperationBatch",
      "production_updateJobOperationBatch",
      "production_releaseJobOperationBatch",
      "production_unreleaseJobOperationBatch"
    ]) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.injectAuth).toContain("userId");
    }
  });
});
