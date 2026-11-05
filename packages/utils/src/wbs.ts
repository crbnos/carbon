// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// WBS codes of a project's element tree. Only a pinned code is stored
// (`projectElement.wbsCode`); every other code is derived from the element's
// position, so a move renumbers derived codes and never a pinned one.
// Spec: `.ai/specs/2026-10-12-wbs-interop-and-contract-financing.md` (Phase A)

export type WbsNode = {
  id: string;
  parentId: string | null;
  /** The element type; a Parameter and its subtree take no code. */
  type: string;
  sortOrder: number;
  /** The number after the last "-" of the readable id (`wbsSequence`). */
  sequence: number;
  /** The pinned code, or null to derive it. */
  wbsCode: string | null;
};

export type WbsCodes = {
  /** The code of every numbered element, by element id. */
  codes: Map<string, string>;
  /** Codes that more than one element has. */
  duplicates: Set<string>;
};

const WBS_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,39}$/;

/** Matches `projectElement_wbsCode_check`. */
export function isValidWbsCode(code: string): boolean {
  return WBS_CODE_PATTERN.test(code);
}

/**
 * The code of the element at `position` (1-based) under a parent. MIL-STD-881F
 * numbers level 1 as "1.0" and level 2 as "1.1", so a parent code ending in
 * ".0" loses it first.
 */
export function childWbsCode(
  parentCode: string | null,
  position: number
): string {
  if (parentCode === null) return String(position);
  const base = parentCode.endsWith(".0") ? parentCode.slice(0, -2) : parentCode;
  return `${base}.${position}`;
}

/** The sequence number of a readable id: `OB2-17` → 17. */
export function wbsSequence(readableId: string): number {
  const value = Number(readableId.slice(readableId.lastIndexOf("-") + 1));
  return Number.isInteger(value) ? value : 0;
}

/** Whether an element type takes a WBS code. */
export function isWbsNumbered(type: string): boolean {
  return type !== "Parameter";
}

export function computeWbsCodes(nodes: readonly WbsNode[]): WbsCodes {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string | null, WbsNode[]>();
  for (const node of nodes) {
    // An element whose parent is not in the list is treated as a root.
    const parentId =
      node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const siblings = children.get(parentId);
    if (siblings) siblings.push(node);
    else children.set(parentId, [node]);
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.sequence - b.sequence
    );
  }

  const codes = new Map<string, string>();
  const walk = (parentId: string | null, parentCode: string | null) => {
    let position = 0;
    for (const node of children.get(parentId) ?? []) {
      if (!isWbsNumbered(node.type)) continue;
      position += 1;
      const code = node.wbsCode ?? childWbsCode(parentCode, position);
      codes.set(node.id, code);
      walk(node.id, code);
    }
  };
  walk(null, null);

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const code of codes.values()) {
    if (seen.has(code)) duplicates.add(code);
    seen.add(code);
  }
  return { codes, duplicates };
}
