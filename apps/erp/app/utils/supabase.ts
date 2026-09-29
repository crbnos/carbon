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
