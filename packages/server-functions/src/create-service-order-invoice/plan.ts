// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure layout of a service order's invoice: the work tree in order, each
// top-level node a heading, each Unbilled billable item a Service line, a
// fixed-price node one line at its price, and "By Node" one line per
// top-level node. Spec: .ai/specs/2026-10-08-field-service.md (Invoicing).

import type { Database } from "@carbon/database";
import { round } from "@carbon/utils";

export type ServiceInvoiceDetail =
  Database["public"]["Enums"]["serviceInvoiceDetail"];

export type ServiceInvoiceElement = {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  sequence: number;
  fixedPrice: number | null;
};

export type ServiceInvoiceItem = {
  id: string;
  projectElementId: string | null;
  itemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  unitOfMeasureCode: string;
};

export type PlannedServiceInvoiceLine = {
  invoiceLineType: "Comment" | "Service";
  description: string;
  itemId: string | null;
  quantity: number;
  unitPrice: number;
  unitOfMeasureCode: string;
  /** The billable items this line bills (stamped with its id). */
  billableItemIds: string[];
};

export const INCLUDED_IN_FIXED_PRICE = "Included in fixed price";

/** The heading of the items that sit on no node of the tree. */
export const UNASSIGNED_HEADING = "Other charges";

function byTreeOrder(a: ServiceInvoiceElement, b: ServiceInvoiceElement) {
  return (
    a.sortOrder - b.sortOrder ||
    a.sequence - b.sequence ||
    a.id.localeCompare(b.id)
  );
}

/**
 * The invoice lines of a service order, in tree order, and for each line the
 * billable items it stamps.
 * - Itemized: each top-level node with charges is a Comment line, followed
 *   by one Service line per Unbilled item of its subtree, node by node.
 * - A node with `fixedPrice` gives one Service line at that price; every item
 *   of its subtree follows at price 0 with "Included in fixed price". The
 *   item keeps its own price for history.
 * - By Node: one Service line per top-level node at its subtree total (a
 *   fixed-price node counts at its price), and no item lines.
 * Items on no node (or a node not in the tree) come last, under "Other
 * charges". A node with no item in its subtree gives no line.
 */
export function planServiceInvoiceLines(args: {
  elements: ServiceInvoiceElement[];
  items: ServiceInvoiceItem[];
  invoiceDetail: ServiceInvoiceDetail;
}): PlannedServiceInvoiceLine[] {
  const elementById = new Map(args.elements.map((e) => [e.id, e]));
  const childrenOf = new Map<string | null, ServiceInvoiceElement[]>();
  for (const element of args.elements) {
    const parentId =
      element.parentId && elementById.has(element.parentId)
        ? element.parentId
        : null;
    const siblings = childrenOf.get(parentId) ?? [];
    siblings.push(element);
    childrenOf.set(parentId, siblings);
  }
  for (const siblings of childrenOf.values()) siblings.sort(byTreeOrder);

  const itemsByElement = new Map<string, ServiceInvoiceItem[]>();
  const unassigned: ServiceInvoiceItem[] = [];
  for (const item of args.items) {
    if (item.projectElementId && elementById.has(item.projectElementId)) {
      const list = itemsByElement.get(item.projectElementId) ?? [];
      list.push(item);
      itemsByElement.set(item.projectElementId, list);
    } else {
      unassigned.push(item);
    }
  }

  /** Every item of a node's subtree, in tree order. */
  const subtreeItems = (
    element: ServiceInvoiceElement,
    seen = new Set<string>()
  ): ServiceInvoiceItem[] => {
    if (seen.has(element.id)) return [];
    seen.add(element.id);
    return [
      ...(itemsByElement.get(element.id) ?? []),
      ...(childrenOf.get(element.id) ?? []).flatMap((child) =>
        subtreeItems(child, seen)
      )
    ];
  };

  /** A node's subtree total, a fixed-price node counting at its price. */
  const subtreeTotal = (
    element: ServiceInvoiceElement,
    seen = new Set<string>()
  ): number => {
    if (seen.has(element.id)) return 0;
    seen.add(element.id);
    if (element.fixedPrice !== null) {
      return subtreeItems(element).length > 0 ? element.fixedPrice : 0;
    }
    return (
      (itemsByElement.get(element.id) ?? []).reduce(
        (sum, item) => sum + item.amount,
        0
      ) +
      (childrenOf.get(element.id) ?? []).reduce(
        (sum, child) => sum + subtreeTotal(child, seen),
        0
      )
    );
  };

  const itemLine = (
    item: ServiceInvoiceItem,
    includedInFixedPrice: boolean
  ): PlannedServiceInvoiceLine => ({
    invoiceLineType: "Service",
    description: includedInFixedPrice
      ? `${item.description} (${INCLUDED_IN_FIXED_PRICE})`
      : item.description,
    itemId: item.itemId,
    quantity: round(item.quantity),
    unitPrice: includedInFixedPrice ? 0 : round(item.unitPrice),
    unitOfMeasureCode: item.unitOfMeasureCode,
    billableItemIds: [item.id]
  });

  const comment = (description: string): PlannedServiceInvoiceLine => ({
    invoiceLineType: "Comment",
    description,
    itemId: null,
    quantity: 0,
    unitPrice: 0,
    unitOfMeasureCode: "EA",
    billableItemIds: []
  });

  /** The Itemized lines of one node and its subtree. */
  const itemizedLines = (
    element: ServiceInvoiceElement,
    seen: Set<string>
  ): PlannedServiceInvoiceLine[] => {
    if (seen.has(element.id)) return [];
    seen.add(element.id);
    if (element.fixedPrice !== null) {
      const covered = subtreeItems(element);
      if (covered.length === 0) return [];
      return [
        {
          invoiceLineType: "Service",
          description: element.name,
          itemId: null,
          quantity: 1,
          unitPrice: round(element.fixedPrice),
          unitOfMeasureCode: "EA",
          billableItemIds: []
        },
        ...covered.map((item) => itemLine(item, true))
      ];
    }
    return [
      ...(itemsByElement.get(element.id) ?? []).map((item) =>
        itemLine(item, false)
      ),
      ...(childrenOf.get(element.id) ?? []).flatMap((child) =>
        itemizedLines(child, seen)
      )
    ];
  };

  const lines: PlannedServiceInvoiceLine[] = [];
  for (const root of childrenOf.get(null) ?? []) {
    const items = subtreeItems(root);
    if (items.length === 0) continue;
    if (args.invoiceDetail === "By Node") {
      lines.push({
        invoiceLineType: "Service",
        description: root.name,
        itemId: null,
        quantity: 1,
        unitPrice: round(subtreeTotal(root)),
        unitOfMeasureCode: "EA",
        billableItemIds: items.map((item) => item.id)
      });
    } else {
      lines.push(comment(root.name), ...itemizedLines(root, new Set()));
    }
  }

  if (unassigned.length > 0) {
    if (args.invoiceDetail === "By Node") {
      lines.push({
        invoiceLineType: "Service",
        description: UNASSIGNED_HEADING,
        itemId: null,
        quantity: 1,
        unitPrice: round(
          unassigned.reduce((sum, item) => sum + item.amount, 0)
        ),
        unitOfMeasureCode: "EA",
        billableItemIds: unassigned.map((item) => item.id)
      });
    } else {
      lines.push(
        comment(UNASSIGNED_HEADING),
        ...unassigned.map((item) => itemLine(item, false))
      );
    }
  }

  return lines;
}
