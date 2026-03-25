import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = {
  scripts?: Record<string, string>;
};

function getTscEntrypoints(scripts: Record<string, string>): string[] {
  const entrypoints: string[] = [];

  for (const command of Object.values(scripts)) {
    const match = command.match(/(?:^|\s)tsx\s+([^\s]+)/);
    if (!match) continue;
    entrypoints.push(match[1].replace(/^['"]|['"]$/g, ""));
  }

  return entrypoints;
}

function main(): void {
  const currentFile = fileURLToPath(import.meta.url);
  const ciRoot = resolve(dirname(currentFile), "..");

  const packageJsonPath = resolve(ciRoot, "package.json");
  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, "utf8")
  ) as PackageJson;
  const scripts = packageJson.scripts ?? {};

  const entrypoints = getTscEntrypoints(scripts);
  if (entrypoints.length === 0) {
    console.log("No tsx script entrypoints were found.");
    return;
  }

  const missingFiles = entrypoints.filter(
    (filePath) => !existsSync(resolve(ciRoot, filePath))
  );

  if (missingFiles.length > 0) {
    throw new Error(
      `Missing script entrypoints:\n${missingFiles
        .map((filePath) => `- ${filePath}`)
        .join("\n")}`
    );
  }

  console.log(`Validated ${entrypoints.length} tsx script entrypoint(s).`);
}

main();
