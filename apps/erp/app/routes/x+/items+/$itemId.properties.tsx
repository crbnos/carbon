import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import type {
  Consumable,
  ItemFile,
  MakeMethod,
  MaterialSummary,
  PartSummary,
  PickMethod,
  SupplierPart,
  Tool
} from "~/modules/items";
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
import type { ListItem } from "~/types";

type CommonFields = {
  itemId: string;
  supplierParts: SupplierPart[];
  pickMethods: PickMethod[];
  files: ItemFile[];
  tags: { name: string }[];
  locations: ListItem[];
};

export type ItemPropertiesResult = CommonFields &
  (
    | { type: "Part"; summary: PartSummary; makeMethods: MakeMethod[] }
    | { type: "Material"; summary: MaterialSummary }
    | { type: "Tool"; summary: Tool; makeMethods: MakeMethod[] }
    | { type: "Consumable"; summary: Consumable }
  );

const typeConfig = {
  Part: { tagTable: "part", getSummary: getPart },
  Material: { tagTable: "material", getSummary: getMaterial },
  Tool: { tagTable: "tool", getSummary: getTool },
  Consumable: { tagTable: "consumable", getSummary: getConsumable }
} as const;

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

  const { tagTable, getSummary } = typeConfig[type];
  const needsMakeMethods = type === "Part" || type === "Tool";

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
    needsMakeMethods ? getMakeMethods(client, itemId, companyId) : null,
    getItemFiles(client, itemId, companyId),
    getLocationsList(client, companyId)
  ]);

  if (!summary.data) {
    throw new Response("Not Found", { status: 404 });
  }

  // Guard against cross-tenant access: the detail RPCs run with RLS bypassed
  // and are not scoped by company, so verify the item belongs to the caller's
  // company before returning it (mirrors the part route's companyId check).
  if (summary.data.companyId !== companyId) {
    throw new Response("Not Found", { status: 404 });
  }

  const common: CommonFields = {
    itemId,
    supplierParts: supplierParts.data ?? [],
    pickMethods: pickMethods.data ?? [],
    files,
    tags: tags.data ?? [],
    locations: locations.data ?? []
  };

  // Each branch casts summary.data to the correct type for the discriminated
  // union. The cast is safe: getSummary is selected from typeConfig[type] so
  // the runtime type always matches.
  switch (type) {
    case "Material":
      return {
        ...common,
        type,
        summary: summary.data as unknown as MaterialSummary
      };
    case "Consumable":
      return {
        ...common,
        type,
        summary: summary.data as unknown as Consumable
      };
    case "Tool":
      return {
        ...common,
        type,
        summary: summary.data as unknown as Tool,
        makeMethods: makeMethods?.data ?? []
      };
    default:
      return {
        ...common,
        type: "Part" as const,
        summary: summary.data as unknown as PartSummary,
        makeMethods: makeMethods?.data ?? []
      };
  }
}
