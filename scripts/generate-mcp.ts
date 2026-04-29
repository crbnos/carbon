/**
 * Generate MCP tool metadata for JIT loading
 * This runs as part of generate-mcp.ts to create a metadata file
 * that can be imported without loading all tool implementations.
 *
 * Tools listed in apps/erp/.../mcp-blocked-tools.ts are omitted from metadata
 * (and blocked at runtime) so they never appear in search_tools / describe_tool.
 */

import * as fs from "fs";
import * as path from "path";

import { MCP_BLOCKED_TOOL_NAMES } from "../apps/erp/app/routes/api+/mcp+/lib/mcp-blocked-tools";

const ROOT = path.resolve(__dirname, "..");
const MCP_LIB_DIR = path.join(ROOT, "apps/erp/app/routes/api+/mcp+/lib");
const TOOLS_DIR = path.join(MCP_LIB_DIR, "tools");
const MODULES_DIR = path.join(ROOT, "apps/erp/app/modules");
const METADATA_FILE = path.join(MCP_LIB_DIR, "tool-metadata.json");

interface ToolMetadata {
  name: string;
  module: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  description: string;
  paramCount: number;
  serviceParams: string[];
}

function extractParamNames(paramsStr: string): string[] {
  const params: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < paramsStr.length; i++) {
    const ch = paramsStr[i];
    const prev = i > 0 ? paramsStr[i - 1] : "";

    if ("({[".includes(ch)) {
      depth++;
      current += ch;
    } else if (")}]".includes(ch)) {
      depth--;
      current += ch;
    } else if (ch === "<") {
      depth++;
      current += ch;
    } else if (ch === ">" && prev === "=") {
      current += ch;
    } else if (ch === ">") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      const name = current.trim().split(/[?:\s]/)[0].trim();
      if (name) params.push(name);
      current = "";
    } else {
      current += ch;
    }
  }

  const lastName = current.trim().split(/[?:\s]/)[0].trim();
  if (lastName) params.push(lastName);

  return params;
}

function extractServiceParamNames(moduleName: string): Map<string, string[]> {
  const serviceFile = path.join(MODULES_DIR, moduleName, `${moduleName}.service.ts`);

  if (!fs.existsSync(serviceFile)) {
    console.warn(`  ⚠ Service file not found: ${serviceFile}`);
    return new Map();
  }

  const content = fs.readFileSync(serviceFile, "utf-8");
  const result = new Map<string, string[]>();

  const funcStartRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(/g;
  let match;

  while ((match = funcStartRegex.exec(content)) !== null) {
    const funcName = match[1];
    const openParenPos = match.index + match[0].length - 1;

    let depth = 1;
    let pos = openParenPos + 1;
    while (pos < content.length && depth > 0) {
      const ch = content[pos];
      if ("({[".includes(ch)) depth++;
      else if (")}]".includes(ch)) depth--;
      pos++;
    }

    const paramsStr = content.substring(openParenPos + 1, pos - 1);
    result.set(funcName, extractParamNames(paramsStr));
  }

  return result;
}

// Parse a tool file to extract metadata
function extractToolsFromFile(filePath: string, moduleName: string): ToolMetadata[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const tools: ToolMetadata[] = [];
  
  // Regular expression to match tool registrations (matches until annotations)
  const toolRegex = /server\.registerTool\(\s*"([^"]+)",\s*\{([\s\S]*?)annotations:\s*(\w+_ANNOTATIONS)/g;
  let match;
  
  while ((match = toolRegex.exec(content)) !== null) {
    const toolName = match[1];
    const configBlock = match[2];
    const annotationType = match[3];
    
    // Extract description
    const descMatch = configBlock.match(/description:\s*"([^"]+)"/);
    const description = descMatch ? descMatch[1] : toolName;
    
    // Determine classification from annotations
    let classification: "READ" | "WRITE" | "DESTRUCTIVE" = "WRITE";
    if (annotationType === "DESTRUCTIVE_ANNOTATIONS") {
      classification = "DESTRUCTIVE";
    } else if (annotationType === "READ_ONLY_ANNOTATIONS") {
      classification = "READ";
    }
    
    // Count parameters (simplified - counts properties in inputSchema)
    const inputSchemaMatch = configBlock.match(/inputSchema:\s*z\.object\(\{([^}]*)\}\)/);
    let paramCount = 0;
    if (inputSchemaMatch) {
      const schemaContent = inputSchemaMatch[1];
      // Count occurrences of property definitions (simplified)
      const propMatches = schemaContent.match(/\w+:\s*z\./g);
      paramCount = propMatches ? propMatches.length : 0;
    }
    
    tools.push({
      name: toolName,
      module: moduleName,
      classification,
      description,
      paramCount,
      serviceParams: []
    });
  }
  
  return tools;
}

export function generateToolMetadata(): void {
  console.log("Generating tool metadata for JIT loading...");
  
  const allTools: ToolMetadata[] = [];
  
  // Get all tool files
  const toolFiles = fs.readdirSync(TOOLS_DIR)
    .filter(f => f.endsWith('.ts') && f !== 'index.ts')
    .map(f => ({
      path: path.join(TOOLS_DIR, f),
      module: f.replace('.ts', '')
    }));
  
  for (const file of toolFiles) {
    try {
      const tools = extractToolsFromFile(file.path, file.module).filter(
        (t) => !MCP_BLOCKED_TOOL_NAMES.includes(t.name),
      );

      const serviceParamMap = extractServiceParamNames(file.module);
      for (const tool of tools) {
        const funcName = tool.name.slice(file.module.length + 1);
        tool.serviceParams = serviceParamMap.get(funcName) || [];
      }

      allTools.push(...tools);
      console.log(`  ✓ ${file.module}: ${tools.length} tools`);
    } catch (error) {
      console.error(`  ✗ Failed to process ${file.module}:`, error);
    }
  }
  
  // Write metadata file
  const metadata = {
    generated: new Date().toISOString(),
    totalTools: allTools.length,
    modules: [...new Set(allTools.map(t => t.module))].length,
    tools: allTools
  };
  
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
  console.log(`\n✓ Generated metadata for ${allTools.length} tools`);
  console.log(`  Output: ${path.relative(ROOT, METADATA_FILE)}`);
}

// Run if called directly
if (require.main === module) {
  generateToolMetadata();
}