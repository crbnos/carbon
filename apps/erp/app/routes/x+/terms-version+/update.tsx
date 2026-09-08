import { requirePermissions } from "@carbon/auth/auth.server";
import type { Json } from "@carbon/database";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { termsDocumentTypes, termsVersionScopes } from "~/modules/settings";

/**
 * Field-level updates from the terms-version editor's properties panel, so each
 * control saves on its own without a whole-form submit (the procedure pattern).
 * Scope is written as a pair — picking Countries clears the region and vice
 * versa — because the two columns are mutually exclusive by CHECK constraint.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const id = formData.get("id");
  const field = formData.get("field");

  if (typeof id !== "string" || typeof field !== "string") {
    return { error: { message: "Invalid form data" }, data: null };
  }

  const audit = { updatedBy: userId, updatedAt: datetime.timestamp() };
  const scoped = client
    .from("termsVersion")
    .update(await buildUpdate(field, formData, audit))
    .eq("id", id)
    .eq("companyId", companyId);

  return await scoped;
}

async function buildUpdate(
  field: string,
  formData: FormData,
  audit: { updatedBy: string; updatedAt: string }
) {
  const value = formData.get("value");
  const str = typeof value === "string" ? value : "";

  switch (field) {
    case "name":
      return { ...audit, name: str };
    case "editor": {
      // The editor saves its two fields together, so a Save is one write.
      const name = formData.get("name");
      const content = formData.get("content");
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(
          typeof content === "string" ? content || "{}" : "{}"
        );
      } catch {
        parsed = {};
      }
      return {
        ...audit,
        name: typeof name === "string" ? name : undefined,
        content: parsed as Json
      };
    }
    case "documentTypes": {
      const documentTypes = (
        formData.getAll("documentTypes") as string[]
      ).filter((type): type is (typeof termsDocumentTypes)[number] =>
        termsDocumentTypes.some((known) => known === type)
      );
      // A version must print somewhere; an empty selection is ignored.
      return documentTypes.length > 0 ? { ...audit, documentTypes } : audit;
    }
    case "scope": {
      // Only one scope dimension is ever set; clearing all of them = global.
      const scope = termsVersionScopes.find((s) => s === str);
      const cleared = {
        customerIds: [] as string[],
        supplierIds: [] as string[],
        countryCodes: [] as string[]
      };
      if (scope === "party")
        return {
          ...audit,
          ...cleared,
          customerIds: formData.getAll("customerIds") as string[],
          supplierIds: formData.getAll("supplierIds") as string[]
        };
      if (scope === "country")
        return {
          ...audit,
          ...cleared,
          countryCodes: formData.getAll("countryCodes") as string[]
        };
      return { ...audit, ...cleared };
    }
    case "effectiveFrom":
    case "effectiveTo":
      return { ...audit, [field]: str || null };
    case "active":
      return { ...audit, active: str === "true" };
    default:
      return audit;
  }
}
