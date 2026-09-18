import { Combobox, HStack, VStack } from "@carbon/react";
import { round } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import type { Receipt, ReceiptLine } from "../../types";

type CandidateEntity = {
  id: string;
  readableId: string | null;
  status: string;
  quantity: number;
};

type AssignedRow = {
  id: string;
  attributes: unknown;
};

/**
 * Tracking UI for sales-return receipt lines: instead of typing new
 * serial/batch numbers, the user picks WHICH entities actually arrived.
 * Candidates are every serial/batch of the line's item shipped to this
 * return's customer — "which serial is it" lives entirely on the receipt,
 * so a different serial than anyone expected still works. Assignment re-tags
 * the EXISTING entity with the receipt-line attributes (lines.tracking
 * `returnEntity` branch); posting then reactivates that same entity On Hold.
 * Blind lines (nothing shipped on record) fall back to the standard entry
 * forms passed as children.
 */
export function ReturnEntityForm({
  receipt,
  line,
  trackingType,
  isReadOnly,
  children
}: {
  receipt?: Receipt;
  line: ReceiptLine;
  trackingType: "batch" | "serial";
  isReadOnly: boolean;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const candidatesFetcher = useFetcher<{
    candidates: CandidateEntity[];
    assigned: AssignedRow[];
  }>();
  const assignFetcher = useFetcher<{ error?: string }>();

  const reload = () => {
    if (line.lineId) {
      candidatesFetcher.load(
        `${path.to.receiptLinesReturnEntities}?lineId=${line.lineId}&receiptLineId=${line.id}`
      );
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per line
  useEffect(() => {
    reload();
  }, [line.lineId]);

  // Refresh assignment state after each assign/remove settles
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on settle
  useEffect(() => {
    if (assignFetcher.state === "idle" && assignFetcher.data) {
      reload();
    }
  }, [assignFetcher.state]);

  const candidates = candidatesFetcher.data?.candidates;

  const assignedByEntityId = useMemo(() => {
    const map = new Map<string, { index: number | null }>();
    for (const row of candidatesFetcher.data?.assigned ?? []) {
      const attributes = (row.attributes ?? {}) as Record<string, unknown>;
      const index = attributes["Receipt Line Index"];
      map.set(row.id, {
        index: typeof index === "number" ? index : null
      });
    }
    return map;
  }, [candidatesFetcher.data?.assigned]);

  if (!line.lineId || (candidates && candidates.length === 0)) {
    // Blind return: nothing shipped on record — standard serial/batch entry
    return <>{children}</>;
  }

  if (!candidates) {
    return null; // loading
  }

  const selectable = candidates.filter(
    (e) => e.status === "Consumed" || assignedByEntityId.has(e.id)
  );

  const options = selectable.map((e) => ({
    value: e.id,
    label: e.readableId ?? e.id
  }));

  const assign = (
    trackedEntityId: string,
    index: number | null,
    previousEntityId?: string
  ) => {
    if (previousEntityId && previousEntityId !== trackedEntityId) {
      const clear = new FormData();
      clear.append("trackingType", "returnEntity");
      clear.append("intent", "remove");
      clear.append("trackedEntityId", previousEntityId);
      clear.append("receiptLineId", line.id!);
      clear.append("receiptId", receipt?.id ?? "");
      assignFetcher.submit(clear, {
        method: "post",
        action: path.to.receiptLinesTracking(line.id!)
      });
    }
    const formData = new FormData();
    formData.append("trackingType", "returnEntity");
    formData.append("intent", "assign");
    formData.append("trackedEntityId", trackedEntityId);
    formData.append("receiptLineId", line.id!);
    formData.append("receiptId", receipt?.id ?? "");
    if (index != null) formData.append("index", String(index));
    assignFetcher.submit(formData, {
      method: "post",
      action: path.to.receiptLinesTracking(line.id!)
    });
  };

  if (trackingType === "batch") {
    const current = [...assignedByEntityId.keys()][0];
    return (
      <VStack spacing={2} className="p-4 border rounded-lg bg-muted/30">
        <label className="text-xs text-muted-foreground">
          {t`Returned batch`}
        </label>
        <Combobox
          size="sm"
          value={current ?? ""}
          options={options}
          isReadOnly={isReadOnly}
          onChange={(value) => {
            if (value) assign(value, null, current);
          }}
        />
        {assignFetcher.data?.error && (
          <span className="text-xs text-destructive">
            {assignFetcher.data.error}
          </span>
        )}
      </VStack>
    );
  }

  // Serial quantities are integral by construction; round() is the
  // sanctioned integer coercion (no-raw-rounding).
  const slots = Math.max(0, round(line.receivedQuantity ?? 0, 0));
  const assignedByIndex = new Map<number, string>();
  for (const [entityId, { index }] of assignedByEntityId) {
    if (index != null) assignedByIndex.set(index, entityId);
  }

  return (
    <VStack spacing={2} className="p-4 border rounded-lg bg-muted/30">
      <label className="text-xs text-muted-foreground">
        {t`Returned serial numbers`}
      </label>
      {Array.from({ length: slots }, (_, index) => {
        const current = assignedByIndex.get(index);
        const usedElsewhere = new Set(
          [...assignedByIndex.entries()]
            .filter(([i]) => i !== index)
            .map(([, id]) => id)
        );
        return (
          <HStack key={index} className="w-full">
            <span className="text-xs text-muted-foreground w-6 tabular-nums">
              {index + 1}
            </span>
            <Combobox
              size="sm"
              value={current ?? ""}
              options={options.filter((o) => !usedElsewhere.has(o.value))}
              isReadOnly={isReadOnly}
              onChange={(value) => {
                if (value) assign(value, index, current);
              }}
            />
          </HStack>
        );
      })}
      {assignFetcher.data?.error && (
        <span className="text-xs text-destructive">
          {assignFetcher.data.error}
        </span>
      )}
    </VStack>
  );
}
