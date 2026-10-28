// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { downloadCsv } from "@carbon/files/csv";
import {
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import { useCallback, useMemo, useRef, useState } from "react";
import { LuDownload } from "react-icons/lu";
import { useLocation } from "react-router";
import { useCustomers, useItems, usePeople, useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import { BROWSER_ROW_LIMIT } from "../infiniteRowsStore";
import { selectExportColumns } from "../utils";
import { useTableJobRefusalMessage } from "./SelectAllMatching";

/** An infinite list's export: the rows the browser has not loaded yet. */
export type InfiniteExport = {
  /** The list's header count: exact below 1,000, else an estimate. */
  count: number;
  /** True while rows past the loaded ones exist. */
  hasMore: boolean;
  /** The list's registry key. Without it the export stops at 1,000 rows. */
  listKey?: string;
  /** Loads pages until the list ends or `limit` rows are loaded. */
  loadAll: (
    limit: number
  ) => Promise<{ rows: object[]; complete: boolean; resetKey: string }>;
  /** The list's reset key (`InfiniteRows.resetKey`) at render. */
  resetKey: string;
};

export type DownloadProps = {
  data: object[];
  columnAccessors: Record<string, string>;
  exportValues: Record<string, (row: any) => unknown>;
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
  // Export-only columns (meta.exportOnly): hidden in the grid but always
  // included in the CSV, regardless of visibility.
  exportOnlyColumns: string[];
  infinite?: InfiniteExport;
};

/**
 * Builds the CSV of the table's rows (visible columns, view order) and
 * downloads it. The desktop Download button and the compact ⋯ menu share it.
 *
 * An infinite list first loads the rest of its rows, up to 1,000. Past 1,000,
 * a list with a `listKey` asks the server for a background export instead;
 * a list without one exports the first 1,000 rows.
 */
export function useCsvDownload({
  data,
  columnAccessors,
  exportValues,
  columnOrder,
  columnVisibility,
  exportOnlyColumns,
  infinite
}: DownloadProps) {
  const { t } = useLingui();
  const refusalMessage = useTableJobRefusalMessage();
  const numberFormatter = useNumberFormatter();
  const { search } = useLocation();
  const [items] = useItems();
  const [suppliers] = useSuppliers();
  const [people] = usePeople();
  const [customers] = useCustomers();
  const [isExporting, setIsExporting] = useState(false);
  const isExportingRef = useRef(false);

  // Maps an id column's accessor key -> a lookup of record id -> name, so the
  // CSV can show the human-readable name instead of the raw id.
  const idNameMaps = useMemo<Record<string, Map<string, string>>>(
    () => ({
      itemId: new Map(items.map((i) => [i.id, i.name])),
      supplierId: new Map(suppliers.map((s) => [s.id, s.name])),
      employeeId: new Map(people.map((p) => [p.id, p.name])),
      customerId: new Map(customers.map((c) => [c.id, c.name]))
    }),
    [items, suppliers, people, customers]
  );

  const exportColumns = useMemo(
    () =>
      selectExportColumns({
        columnAccessors,
        columnOrder,
        columnVisibility,
        exportOnlyColumns
      }),
    [columnOrder, columnVisibility, columnAccessors, exportOnlyColumns]
  );

  const downloadRows = useCallback(
    (source: object[]) => {
      // Build label-keyed rows so the CSV emits the view's header labels, in
      // the view's column order, substituting names for id columns.
      const rows = source.map((row) => {
        const out: Record<string, unknown> = {};
        for (const key of exportColumns) {
          const exporter = exportValues[key];
          let value: unknown;
          if (exporter) {
            value = exporter(row);
          } else {
            const raw = (row as Record<string, unknown>)[key];
            const map = idNameMaps[key];
            value = map && raw != null ? (map.get(String(raw)) ?? raw) : raw;
          }
          out[columnAccessors[key]] = value;
        }
        return out;
      });
      downloadCsv(rows, "data.csv");
    },
    [exportColumns, idNameMaps, columnAccessors, exportValues]
  );

  // Starts the background export: the server writes the CSV and notifies the
  // user. The columns go with their translated headers, in display order.
  const startBackgroundExport = useCallback(
    async (listKey: string) => {
      const failed = t`The export could not start. Try again.`;
      try {
        const response = await fetch(path.to.api.tableExport, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            listKey,
            search,
            columns: exportColumns.map((key) => ({
              key,
              label: columnAccessors[key]
            }))
          }),
          credentials: "include"
        });
        const result: unknown = await response.json().catch(() => null);
        if (response.ok && isSuccess(result)) {
          toast.success(
            t`Your export is being prepared. We'll notify you when it's ready.`
          );
        } else {
          toast.error(
            refusalMessage(refusalOf(result)) ?? errorMessage(result) ?? failed
          );
        }
      } catch {
        toast.error(failed);
      }
    },
    [t, refusalMessage, search, exportColumns, columnAccessors]
  );

  const onClick = useCallback(async () => {
    if (!data?.length || isExportingRef.current) {
      return;
    }
    if (!infinite?.hasMore) {
      downloadRows(data);
      return;
    }

    isExportingRef.current = true;
    setIsExporting(true);
    try {
      const { count, listKey, loadAll, resetKey } = infinite;
      if (listKey && count > BROWSER_ROW_LIMIT) {
        await startBackgroundExport(listKey);
        return;
      }
      const { rows, complete, ...loaded } = await loadAll(BROWSER_ROW_LIMIT);
      // A filter, sort or search changed while the rows loaded: they are not
      // the list the user asked to export.
      if (loaded.resetKey !== resetKey) {
        toast.info(t`The list changed while the export loaded. Try again.`);
        return;
      }
      // The count was low, but more rows remain past 1,000.
      if (!complete && listKey) {
        await startBackgroundExport(listKey);
        return;
      }
      const exported = complete ? rows : rows.slice(0, BROWSER_ROW_LIMIT);
      downloadRows(exported);
      if (!complete) {
        const exportedCount = numberFormatter.format(exported.length);
        toast.info(t`Exported the first ${exportedCount} rows.`);
      }
    } finally {
      isExportingRef.current = false;
      setIsExporting(false);
    }
  }, [data, infinite, downloadRows, startBackgroundExport, numberFormatter, t]);

  return { onClick, isExporting };
}

function isSuccess(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { success?: unknown }).success === true
  );
}

function refusalOf(result: unknown): unknown {
  if (typeof result !== "object" || result === null) return null;
  return (result as { refusal?: unknown }).refusal ?? null;
}

function errorMessage(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const { error } = result as { error?: unknown };
  return typeof error === "string" && error.length > 0 ? error : null;
}

const Download = (props: DownloadProps) => {
  const { t } = useLingui();
  const { data } = props;
  const { onClick, isExporting } = useCsvDownload(props);

  if (!data?.length) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton
          aria-label={t`Download CSV`}
          title={t`Download CSV`}
          variant={"ghost"}
          icon={<LuDownload />}
          className={"!border-dashed border-border"}
          isLoading={isExporting}
          onClick={onClick}
        />
      </TooltipTrigger>
      <TooltipContent>
        <p>
          <Trans>Download CSV</Trans>
        </p>
      </TooltipContent>
    </Tooltip>
  );
};

export default Download;
