import {
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { json2csv } from "json-2-csv";
import { useCallback, useMemo } from "react";
import { LuDownload } from "react-icons/lu";
import { useCustomers, useItems, usePeople, useSuppliers } from "~/stores";

type DownloadProps = {
  data: object[];
  columnAccessors: Record<string, string>;
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
};

const Download = ({
  data,
  columnAccessors,
  columnOrder,
  columnVisibility
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

  // The visible columns, in the current view's order. The column id doubles as
  // the data accessor key; columns absent from columnAccessors (selection,
  // expand, actions) are dropped.
  const exportColumns = useMemo(() => {
    const order = columnOrder.length
      ? columnOrder
      : Object.keys(columnAccessors);
    return order.filter(
      (id) => id in columnAccessors && columnVisibility[id] !== false
    );
  }, [columnOrder, columnVisibility, columnAccessors]);

  const onClick = useCallback(() => {
    if (!data?.length) {
      return;
    }
    // Build label-keyed rows so json2csv emits the view's header labels, in the
    // view's column order, substituting names for id columns.
    const rows = data.map((row) => {
      const out: Record<string, unknown> = {};
      for (const key of exportColumns) {
        const raw = (row as Record<string, unknown>)[key];
        const map = idNameMaps[key];
        out[columnAccessors[key]] =
          map && raw != null ? (map.get(String(raw)) ?? raw) : raw;
      }
      return out;
    });
    let csvData = json2csv(rows, { emptyFieldValue: "" });
    // Create a CSV file and allow the user to download it
    let blob = new Blob([csvData], { type: "text/csv" });
    let url = window.URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = url;
    a.download = "data.csv";
    document.body.appendChild(a);
    a.click();
  }, [data, exportColumns, idNameMaps, columnAccessors]);

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
