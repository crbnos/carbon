// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback, useMemo, useRef, useState } from "react";
import { useRangeAnchor } from "~/components/Table/rangeSelection";
import { path } from "~/utils/path";
import type { OpenInvoiceRow, WorkbenchRow } from "./types";

type UseWorkbenchSelectionArgs = {
  side: "ar" | "ap";
  open: OpenInvoiceRow[];
  childrenByParty: Record<string, OpenInvoiceRow[]>;
  displayRows: WorkbenchRow[];
  partyIdOf: (r: {
    customerId?: string;
    supplierId?: string;
  }) => string | undefined;
};

// Counterparty order plus invoice order; expanding a row does not change it.
function rowsSignature(displayRows: WorkbenchRow[], open: OpenInvoiceRow[]) {
  return [
    ...displayRows.filter((r) => r.kind === "counterparty").map((r) => r.id),
    "|",
    ...open.map((inv) => inv.invoiceId)
  ].join(",");
}

// Selecting a counterparty cascades to all its open invoices; selecting
// individual invoices is also allowed. Only invoices are selectable — a
// payment settles invoices, so the counterparty checkbox is purely a
// select-all-its-children affordance.
export function useWorkbenchSelection({
  side,
  open,
  childrenByParty,
  displayRows,
  partyIdOf
}: UseWorkbenchSelectionArgs) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleInvoice = useCallback((invoiceId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceId)) next.delete(invoiceId);
      else next.add(invoiceId);
      return next;
    });
  }, []);

  const toggleCounterparty = useCallback(
    (partyId: string) => {
      const kids = childrenByParty[partyId] ?? [];
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const allSelected =
          kids.length > 0 && kids.every((k) => next.has(k.invoiceId));
        for (const k of kids) {
          if (allSelected) next.delete(k.invoiceId);
          else next.add(k.invoiceId);
        }
        return next;
      });
    },
    [childrenByParty]
  );

  // Shift-click range selection: one anchor for the tree, one for the documents tables.
  const { rangeTo: treeRangeTo, clearAnchor: clearTreeAnchor } =
    useRangeAnchor();
  const { rangeTo: documentRangeTo, clearAnchor: clearDocumentAnchor } =
    useRangeAnchor();

  // A reload, new as-of date or new sort drops both anchors, checked on click.
  const anchorRowsRef = useRef("");
  const dropStaleAnchors = useCallback(() => {
    const signature = rowsSignature(displayRows, open);
    if (signature === anchorRowsRef.current) return;
    anchorRowsRef.current = signature;
    clearTreeAnchor();
    clearDocumentAnchor();
  }, [clearDocumentAnchor, clearTreeAnchor, displayRows, open]);

  const setInvoicesSelected = useCallback(
    (invoiceIds: string[], checked: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of invoiceIds) {
          if (checked) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    []
  );

  // A counterparty in the range sets all its invoices, as its own click does.
  const selectTreeRow = useCallback(
    (row: WorkbenchRow, checked: boolean, shiftKey: boolean) => {
      dropStaleAnchors();
      const range = treeRangeTo(
        displayRows.map((r) => r.id),
        row.id,
        shiftKey
      );
      if (!range) {
        if (row.kind === "counterparty") toggleCounterparty(row.partyId);
        else toggleInvoice(row.invoiceId);
        return;
      }
      const inRange = new Set(range);
      setInvoicesSelected(
        displayRows
          .filter((r) => inRange.has(r.id))
          .flatMap((r) =>
            r.kind === "counterparty"
              ? (childrenByParty[r.partyId] ?? []).map((k) => k.invoiceId)
              : [r.invoiceId]
          ),
        checked
      );
    },
    [
      childrenByParty,
      displayRows,
      dropStaleAnchors,
      setInvoicesSelected,
      toggleCounterparty,
      toggleInvoice,
      treeRangeTo
    ]
  );

  // A range stays within one counterparty's documents table.
  const selectDocument = useCallback(
    (
      documents: OpenInvoiceRow[],
      invoiceId: string,
      checked: boolean,
      shiftKey: boolean
    ) => {
      dropStaleAnchors();
      const range = documentRangeTo(
        documents.map((d) => d.invoiceId),
        invoiceId,
        shiftKey
      );
      if (range) setInvoicesSelected(range, checked);
      else toggleInvoice(invoiceId);
    },
    [documentRangeTo, dropStaleAnchors, setInvoicesSelected, toggleInvoice]
  );

  // The selected invoices, and whether they can become one payment. A payment
  // has one counterparty and one currency, so the action is enabled only when
  // the selection is homogeneous on both.
  const { selectedInvoices, sameParty, payHref } = useMemo(() => {
    const selectedInvoices = open.filter((inv) =>
      selectedIds.has(inv.invoiceId)
    );
    const selectedPartyIds = new Set(selectedInvoices.map(partyIdOf));
    const selectedCurrencies = new Set(
      selectedInvoices.map((inv) => inv.currencyCode)
    );
    const sameParty = selectedPartyIds.size === 1;
    const sameCurrency = selectedCurrencies.size === 1;
    const partyId = [...selectedPartyIds][0];
    let payHref: string | null = null;
    if (sameParty && sameCurrency && partyId) {
      const params = new URLSearchParams();
      params.set(side === "ar" ? "customerId" : "supplierId", partyId);
      for (const inv of selectedInvoices)
        params.append("invoiceId", inv.invoiceId);
      payHref = `${path.to.paymentNew}?${params.toString()}`;
    }
    return { selectedInvoices, sameParty, payHref };
  }, [open, selectedIds, partyIdOf, side]);

  return {
    selectedIds,
    selectTreeRow,
    selectDocument,
    selectedInvoices,
    sameParty,
    payHref
  };
}
