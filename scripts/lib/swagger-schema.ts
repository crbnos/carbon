const PRIMARY_KEY_NOTE = "This is a Primary Key.<pk/>";

// The `partners` view projects `partner.id` twice (as `id` and as
// `supplierLocationId`), and PostgREST annotates the source primary key on
// whichever alias it encounters first — which differs between databases built
// from the same migrations. Pin the `<pk/>` note to `id` so the committed
// schema is a pure function of the migrations. When neither or both aliases
// carry the note there is nothing nondeterministic to fix, so leave the
// document untouched.
export function normalizeSwaggerSchema(schema: unknown): unknown {
  const result = structuredClone(schema) as {
    definitions?: {
      partners?: {
        properties?: Record<string, { description?: unknown }>;
      };
    };
  };
  const properties = result?.definitions?.partners?.properties;
  const id = properties?.id;
  const alias = properties?.supplierLocationId;
  if (
    typeof id?.description === "string" &&
    typeof alias?.description === "string" &&
    alias.description.includes(PRIMARY_KEY_NOTE) &&
    !id.description.includes(PRIMARY_KEY_NOTE)
  ) {
    alias.description = alias.description.replace(`${PRIMARY_KEY_NOTE}\n`, "");
    id.description = id.description.replace(
      "Note:\n",
      `Note:\n${PRIMARY_KEY_NOTE}\n`
    );
  }
  return result;
}
