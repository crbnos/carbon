// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { dataOrThrow } from "@carbon/api/carbon.server";
import { authorize } from "@carbon/auth/auth.server";
import { ITEM_TYPE_PAGES } from "@carbon/database/access";
import type { LoaderFunctionArgs } from "react-router";
import type { UnreleasedChangeOrderItem } from "~/modules/items/items.service";
import {
  getConsumable,
  getMaterial,
  getPart,
  getTool,
  getUnreleasedChangeOrderForItem
} from "~/modules/items/items.service";
import type {
  Consumable,
  ItemFile,
  MakeMethod,
  MaterialSummary,
  PartSummary,
  PickMethod,
  SupplierPart,
  Tool
} from "~/modules/items/types";
import type { ListItem } from "~/types";

type CommonFields = {
  itemId: string;
  supplierParts: SupplierPart[];
  pickMethods: PickMethod[];
  files: ItemFile[];
  tags: { name: string }[];
  locations: ListItem[];
  // Set while the change notice that minted this item is still open. Mirrors the
  // part/tool routes so the properties panel locks the Active toggle here too.
  unreleasedChangeOrder: UnreleasedChangeOrderItem | null;
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
  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  // Own-key check: `in` also accepts inherited keys, so e.g. ?type=toString
  // would pass and crash on the destructure below.
  const type =
    typeParam && Object.prototype.hasOwnProperty.call(typeConfig, typeParam)
      ? (typeParam as keyof typeof typeConfig)
      : "Part";

  // The item's type picks its page.
  const { client, companyId, api } = await authorize(
    request,
    { [ITEM_TYPE_PAGES[type]]: "View" },
    { bypassRls: true }
  );

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const { tagTable, getSummary } = typeConfig[type];
  const needsMakeMethods = type === "Part" || type === "Tool";

  const [
    summary,
    supplierParts,
    pickMethods,
    tags,
    makeMethods,
    files,
    locations,
    unreleasedChangeOrder
  ] = await Promise.all([
    getSummary(client, itemId, companyId),
    api.items.getSupplierParts({ id: itemId }),
    api.items.getPickMethods({ itemId }),
    api.shared.getTagsList({ table: tagTable }),
    needsMakeMethods ? api.items.getMakeMethods({ itemId }) : null,
    api.items.getItemFiles({ itemId }).then(dataOrThrow),
    api.resources.getLocationsList({}),
    getUnreleasedChangeOrderForItem(client, { itemId, companyId })
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
    locations: locations.data ?? [],
    unreleasedChangeOrder
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
