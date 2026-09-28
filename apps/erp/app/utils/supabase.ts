export { parseJobFilePath } from "@carbon/files/media";
export { sanitize } from "@carbon/utils";

/**
 * The code on an error a service writes itself: a refused business rule, not
 * a database failure. API and MCP callers see its message as written, while a
 * database failure is reduced to a fixed public message.
 */
export const SERVICE_RULE_ERROR_CODE = "CARBON_RULE";

export function ruleError(message: string) {
  return { code: SERVICE_RULE_ERROR_CODE, message };
}

/**
 * Drop named keys a service's type omits but an API caller can still send:
 * input validation passes unknown keys through, and a service that spreads its
 * payload into a row would send them to PostgREST (PGRST204). Name each key;
 * never replace this with a column allowlist, which would hide real mistakes.
 */
export function withoutKeys<T extends object>(
  input: T,
  keys: readonly string[]
): T {
  const output = { ...input } as Record<string, unknown>;
  for (const key of keys) delete output[key];
  return output as T;
}
