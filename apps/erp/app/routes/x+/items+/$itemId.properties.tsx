import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import {
  getConsumable,
  getItemFiles,
  getMakeMethods,
  getMaterial,
  getPart,
  getPickMethods,
  getSupplierParts,
  getTool
} from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import { getTagsList, methodItemType } from "~/modules/shared";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  const type = (methodItemType as readonly string[]).includes(typeParam ?? "")
    ? (typeParam as (typeof methodItemType)[number])
    : "Part";

  const tagTable =
    type === "Material"
      ? "material"
      : type === "Tool"
        ? "tool"
        : type === "Consumable"
          ? "consumable"
          : "part";

  const getSummary =
    type === "Material"
      ? getMaterial
      : type === "Tool"
        ? getTool
        : type === "Consumable"
          ? getConsumable
          : getPart;

  const [
    summary,
    supplierParts,
    pickMethods,
    tags,
    makeMethods,
    files,
    locations
  ] = await Promise.all([
    getSummary(client, itemId, companyId),
    getSupplierParts(client, itemId, companyId),
    getPickMethods(client, itemId, companyId),
    getTagsList(client, companyId, tagTable),
    getMakeMethods(client, itemId, companyId),
    getItemFiles(client, itemId, companyId),
    getLocationsList(client, companyId)
  ]);

  // Guard against cross-tenant access: the detail RPCs run with RLS bypassed
  // and are not scoped by company, so verify the item belongs to the caller's
  // company before returning it (mirrors the part route's companyId check).
  if (summary.data && summary.data.companyId !== companyId) {
    throw new Response("Not Found", { status: 404 });
  }

  return {
    type,
    itemId,
    summary: summary.data,
    supplierParts: supplierParts.data ?? [],
    pickMethods: pickMethods.data ?? [],
    makeMethods: makeMethods.data ?? [],
    files,
    tags: tags.data ?? [],
    locations: locations.data ?? []
  };
}
