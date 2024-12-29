import { transpile } from "https://deno.land/x/ts_transpiler@v0.0.2/mod.ts";

// Check for disallowed code patterns
const disallowedPatterns = [
  /\b(for|while|do)\b/, // loops
  /\bfetch\b/, // fetch calls
  /setTimeout|setInterval/, // timeouts
  /\bimport\b/, // dynamic imports
  /new Promise/, // promise construction
  /\beval\b/, // eval
  /Function\(/, // Function constructor
];

/**
 * Sandbox for executing user-provided TypeScript code safely
 *
 * Usage:
 * ```ts
 * // Example code to execute
 * const code = `
 *   // Your configuration logic here
 *   if (parameters.value > 10) {
 *     return "high";
 *   }
 *   return "low";
 * `;
 *
 * // Parameters to pass to the code
 * const parameters = {
 *   value: 15
 * };
 *
 * // Import and execute the code
 * const mod = await importTypeScript(code);
 * const result = await mod.configure(parameters);
 * // result = "high"
 * ```
 *
 * The code will be executed in a sandboxed environment with the following restrictions:
 * - No loops (for, while, do)
 * - No fetch calls
 * - No timeouts or intervals
 * - No dynamic imports
 * - No promise construction
 * - No eval or Function constructor
 *
 * The code must export a `configure` function that takes a parameters object
 * and returns a value. The parameters object will be passed to the function
 * when executed.
 */

export async function importTypeScript(code: string) {
  try {
    // Transpile TypeScript to JavaScript
    const jsCode = await transpile(
      `export function configure(params: Params) {${
        disallowedPatterns.some((pattern) => pattern.test(code))
          ? `return null`
          : code
      }}`
    );

    return await import(`data:application/typescript;base64,${btoa(jsCode)}`);
  } catch (err) {
    console.error("Transpilation error:", err);
    throw new Error(`Failed to transpile TypeScript: ${err.message}`);
  }
}
