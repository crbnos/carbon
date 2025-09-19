// Simple env guard - fail fast if versions drift
import { execSync } from "node:child_process";

function ver(cmd) {
  return execSync(cmd).toString().trim();
}

const node = ver("node -v");      // e.g. v20.16.0
const npm = ver("npm -v");        // e.g. 10.8.1

const expectedNode = "v20.16.0";
const expectedNpm  = "10.8.1";

if (node !== expectedNode) {
  console.error(`[doctor] Wrong Node version: ${node} - expected ${expectedNode}`);
  process.exit(1);
}
if (npm !== expectedNpm) {
  console.error(`[doctor] Wrong npm version: ${npm} - expected ${expectedNpm}`);
  process.exit(1);
}
console.log("[doctor] Toolchain OK");
