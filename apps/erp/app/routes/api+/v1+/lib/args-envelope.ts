import type { ManifestEntry } from "@carbon/api";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize the legacy `{ args: {...} }` envelope before input validation, so
 * its contents are validated like a flat body.
 *
 * - Operation declares `args` in its schema: the envelope IS the shape; leave it.
 * - A lone envelope: its contents are the body.
 * - A list operation (service param `args`, published flat) with the envelope
 *   beside sibling params (`{ jobId, args: { search } }`): the contents are
 *   lifted over the siblings, as the dispatcher does. Other operations keep an
 *   `args` key beside siblings untouched.
 */
export function unwrapArgsEnvelope(
  meta: Pick<ManifestEntry, "schema"> &
    Partial<Pick<ManifestEntry, "serviceParams">>,
  args?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!args) return args;
  const properties = meta.schema.properties;
  if (isPlainObject(properties) && "args" in properties) return args;
  if (!isPlainObject(args.args)) return args;
  const { args: envelope, ...siblings } = args;
  const keys = Object.keys(siblings);
  if (keys.length === 0) return envelope as Record<string, unknown>;
  if (meta.serviceParams?.includes("args")) {
    return { ...siblings, ...(envelope as Record<string, unknown>) };
  }
  return args;
}
