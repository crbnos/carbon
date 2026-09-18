import { downloadCsv } from "@carbon/files/csv";
import {
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useMemo } from "react";
import { LuDownload } from "react-icons/lu";
import { useCustomers, useItems, usePeople, useSuppliers } from "~/stores";
import { selectExportColumns } from "../utils";

type DownloadProps = {
  data: object[];
  columnAccessors: Record<string, string>;
  exportValues: Record<string, (row: any) => unknown>;
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
  // Export-only columns (meta.exportOnly): hidden in the grid but always
  // included in the CSV, regardless of visibility.
  exportOnlyColumns: string[];
};

const Download = ({
  data,
  columnAccessors,
  exportValues,
  columnOrder,
  columnVisibility,
  exportOnlyColumns
}: DownloadProps) => {
  const { t } = useLingui();

  const [items] = useItems();
  const [suppliers] = useSuppliers();
  const [people] = usePeople();
  const [customers] = useCustomers();

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

  const onClick = useCallback(() => {
    if (!data?.length) {
      return;
    }
    // Build label-keyed rows so the CSV emits the view's header labels, in the
    // view's column order, substituting names for id columns.
    const rows = data.map((row) => {
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
  }, [data, exportColumns, idNameMaps, columnAccessors, exportValues]);

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
