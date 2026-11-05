// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { path } from "~/utils/path";

/**
 * Where a tab of an opened operation gets its content from:
 * - `own`: written on this operation.
 * - `procedure`: copied from the linked procedure onto each new job.
 * - `linked`: comes from a linked assembly instruction or inspection plan.
 * - `notUsed`: a supplier does the work, so operators never see it.
 */
export type OperationTabSource = "own" | "procedure" | "linked" | "notUsed";

export type OperationTabSources = {
  instructions: OperationTabSource;
  parameters: OperationTabSource;
  steps: OperationTabSource;
  tools: OperationTabSource;
  preview: OperationTabSource;
};

export function getOperationTabSources(operation: {
  operationType?: string | null;
  procedureId?: string | null;
  assemblyInstructionId?: string | null;
  inspectionDocumentId?: string | null;
}): OperationTabSources {
  if (operation.operationType === "Outside Processing") {
    return {
      instructions: "notUsed",
      parameters: "notUsed",
      steps: "notUsed",
      tools: "notUsed",
      preview: "notUsed"
    };
  }

  const fromProcedure = !!operation.procedureId;
  const fromLinkedDocument =
    !!operation.assemblyInstructionId || !!operation.inspectionDocumentId;
  const steps: OperationTabSource = fromProcedure
    ? "procedure"
    : fromLinkedDocument
      ? "linked"
      : "own";

  return {
    instructions: fromProcedure ? "procedure" : "own",
    parameters: fromProcedure ? "procedure" : "own",
    steps,
    tools: "own",
    preview: steps
  };
}

export type PartMethodTab = "bill-of-material" | "bill-of-process";

export function getPartMethodTab(pathname: string): PartMethodTab | null {
  if (pathname.includes("/bill-of-process")) return "bill-of-process";
  if (pathname.includes("/bill-of-material")) return "bill-of-material";
  return null;
}

/** True on one line of a method tab, including its `new` route. */
export function isPartMethodLinePath(pathname: string) {
  return /\/bill-of-(material|process)\/[^/]+/.test(pathname);
}

/**
 * The link of a method tree node on the part page. The tree stays on the
 * current method tab. From any other record tab, the root keeps the Details
 * link and a sub-assembly opens its Bill of Material.
 */
export function getPartMethodNodeLink({
  itemId,
  pathname,
  rootMethodId,
  makeMethodId
}: {
  itemId: string;
  pathname: string;
  rootMethodId: string;
  /** The node's method. Omit it for the root node. */
  makeMethodId?: string;
}) {
  const tab = getPartMethodTab(pathname);
  const tabPath =
    tab === "bill-of-process"
      ? path.to.partBillOfProcess(itemId)
      : path.to.partBillOfMaterial(itemId);

  if (!makeMethodId) {
    return `${tab ? tabPath : path.to.partDetails(itemId)}?methodId=${rootMethodId}`;
  }
  return `${tabPath}?methodId=${rootMethodId}&makeMethodId=${makeMethodId}`;
}

/** The current search without `tab`, the one param that belongs to one line. */
export function getMethodSearch(search: string) {
  const params = new URLSearchParams(search);
  params.delete("tab");
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function getAdjacentLineIds(ids: string[], currentId: string) {
  const index = ids.indexOf(currentId);
  if (index === -1) return { previousId: null, nextId: null };
  return {
    previousId: ids[index - 1] ?? null,
    nextId: ids[index + 1] ?? null
  };
}
