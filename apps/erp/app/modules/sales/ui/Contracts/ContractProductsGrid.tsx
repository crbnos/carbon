// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MultiSelect, ValidatedForm } from "@carbon/form";
import {
  Button,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useDisclosure
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuPencil, LuPlus, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Table } from "~/components";
import type { EditableTableCellComponentProps } from "~/components/Editable";
import {
  EditableDate,
  EditableList,
  EditableNumber
} from "~/components/Editable";
import { Submit } from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import {
  useCurrencyDecimals,
  useDateFormatter,
  usePercentFormatter,
  usePermissions,
  useQuantityFormatter
} from "~/hooks";
import { useServices } from "~/stores";
import { path } from "~/utils/path";
import {
  contractRateUnits,
  contractRevenueTypes,
  customerContractLinesAddValidator
} from "../../sales.models";
import ContractLineForm from "./ContractLineForm";
import ContractMoney from "./ContractMoney";
import {
  contractGridHeight,
  contractLineName,
  rowMenuColumn,
  useContractCellSave
} from "./contractGrid";
import type { Contract, ContractLine } from "./types";

type ProductRow = {
  id: string;
  name: string;
  readableId: string | null;
  revenueType: ContractLine["revenueType"];
  quantity: number;
  rate: number;
  rateUnit: ContractLine["rateUnit"];
  /** Percent points, as the cell edits them. */
  discountPercent: number;
  startDate: string;
  endDate: string | null;
  total: number;
};

type ContractProductsGridProps = {
  contract: Contract;
  lines: ContractLine[];
  lineTotals: Record<string, number>;
};

/** The contract's lines as a spreadsheet: type, quantity, rate, discount and
 *  dates edit in place, one cell at a time, through the line's update route.
 *  The rest of a line (description, tax, revenue) opens in its form. */
const ContractProductsGrid = ({
  contract,
  lines,
  lineTotals
}: ContractProductsGridProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const save = useContractCellSave();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const percent = usePercentFormatter();

  const contractId = contract.id!;
  const { currencyCode } = contract;
  const contractEndDate = contract.endDate;
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const canEdit = permissions.can("update", "sales");

  const addProducts = useDisclosure();
  const [editing, setEditing] = useState<ContractLine | null>(null);
  const [deleting, setDeleting] = useState<ContractLine | null>(null);

  const revenueTypeLabels = useMemo<
    Record<ContractLine["revenueType"], string>
  >(() => ({ "One-time": t`One-time`, Recurring: t`Recurring` }), [t]);
  const rateUnitLabels = useMemo<
    Record<NonNullable<ContractLine["rateUnit"]>, string>
  >(
    () => ({
      Day: t`Day`,
      Week: t`Week`,
      Month: t`Month`,
      Quarter: t`Quarter`,
      Year: t`Year`
    }),
    [t]
  );

  const rows = useMemo<ProductRow[]>(
    () =>
      lines.map((line) => ({
        id: line.id,
        name: contractLineName(line),
        readableId: line.item?.readableIdWithRevision ?? null,
        revenueType: line.revenueType,
        quantity: Number(line.quantity),
        rate: Number(line.rate),
        rateUnit: line.rateUnit,
        discountPercent: round(Number(line.discountPercent) * 100),
        startDate: line.startDate,
        endDate: line.endDate,
        total: lineTotals[line.id] ?? 0
      })),
    [lines, lineTotals]
  );

  const onCellEdit = useCallback(
    (accessorKey: string, value: unknown, row: ProductRow) =>
      save(path.to.contractLineUpdate(contractId, row.id), {
        field: accessorKey,
        value: value === null || value === undefined ? "" : String(value)
      }),
    [contractId, save]
  );

  const columns = useMemo<ColumnDef<ProductRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: t`Service`,
        cell: ({ row }) => (
          <div className="flex max-w-[240px] flex-col">
            <span className="truncate font-medium">{row.original.name}</span>
            {row.original.readableId &&
              row.original.readableId !== row.original.name && (
                <span className="truncate text-xs text-muted-foreground">
                  {row.original.readableId}
                </span>
              )}
          </div>
        )
      },
      {
        accessorKey: "revenueType",
        header: t`Revenue Type`,
        cell: ({ row }) => revenueTypeLabels[row.original.revenueType]
      },
      {
        accessorKey: "quantity",
        header: t`Qty`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatQuantity(row.original.quantity)}
          </span>
        )
      },
      {
        accessorKey: "rate",
        header: t`Rate`,
        cell: ({ row }) => (
          <ContractMoney
            value={row.original.rate}
            currencyCode={currencyCode}
            rate
          />
        )
      },
      {
        accessorKey: "rateUnit",
        header: t`Per`,
        cell: ({ row }) =>
          row.original.revenueType === "Recurring" && row.original.rateUnit ? (
            rateUnitLabels[row.original.rateUnit]
          ) : (
            <span className="text-muted-foreground">—</span>
          )
      },
      {
        accessorKey: "discountPercent",
        header: t`Discount`,
        cell: ({ row }) =>
          row.original.discountPercent > 0 ? (
            <span className="tabular-nums">
              {percent.format(row.original.discountPercent / 100)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )
      },
      {
        accessorKey: "startDate",
        header: t`Start`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatDate(row.original.startDate)}
          </span>
        )
      },
      {
        accessorKey: "endDate",
        header: t`End`,
        cell: ({ row }) =>
          row.original.endDate ? (
            <span className="tabular-nums">
              {formatDate(row.original.endDate)}
            </span>
          ) : contractEndDate ? (
            // No end of its own: the line follows the contract's end, so a
            // changed term or a renewal moves it too. Muted to say so.
            <span className="tabular-nums text-muted-foreground">
              {formatDate(contractEndDate)}
            </span>
          ) : (
            <span className="text-muted-foreground">
              <Trans>Open-ended</Trans>
            </span>
          )
      },
      {
        id: "total",
        header: t`Total`,
        cell: ({ row }) => (
          <span className="font-medium">
            <ContractMoney
              value={row.original.total}
              currencyCode={currencyCode}
            />
          </span>
        )
      }
    ],
    [
      t,
      currencyCode,
      contractEndDate,
      formatDate,
      formatQuantity,
      percent,
      revenueTypeLabels,
      rateUnitLabels
    ]
  );

  const editableComponents = useMemo(() => {
    const revenueType = EditableList<ProductRow>(
      onCellEdit,
      contractRevenueTypes.map((value) => ({
        value,
        label: revenueTypeLabels[value]
      }))
    );
    const rateUnit = EditableList<ProductRow>(
      onCellEdit,
      contractRateUnits.map((value) => ({
        value,
        label: rateUnitLabels[value]
      }))
    );
    return {
      revenueType,
      quantity: EditableNumber<ProductRow>(onCellEdit, {
        minValue: 0,
        step: INPUT_STEP.quantity,
        formatOptions: INPUT_FORMAT.quantity
      }),
      rate: EditableNumber<ProductRow>(onCellEdit, {
        minValue: 0,
        step: INPUT_STEP.rate,
        formatOptions: INPUT_FORMAT.rate(currencyCode, currencyDecimals)
      }),
      // A one-time line has no rate unit: the cell stays a dash.
      rateUnit: (props: EditableTableCellComponentProps<ProductRow>) =>
        props.row.revenueType === "Recurring" ? (
          rateUnit(props)
        ) : (
          <span className="px-3 text-muted-foreground">—</span>
        ),
      discountPercent: EditableNumber<ProductRow>(onCellEdit, {
        minValue: 0,
        maxValue: 100,
        step: INPUT_STEP.percent,
        formatOptions: INPUT_FORMAT.percentPoints
      }),
      startDate: EditableDate<ProductRow>(onCellEdit, { label: t`Start` }),
      endDate: EditableDate<ProductRow>(onCellEdit, {
        label: t`End`,
        clearable: true,
        bounds: (row) => ({ minValue: row.startDate })
      })
    };
  }, [
    onCellEdit,
    currencyCode,
    currencyDecimals,
    t,
    revenueTypeLabels,
    rateUnitLabels
  ]);

  const renderContextMenu = useCallback(
    (row: ProductRow) => {
      const line = lines.find((l) => l.id === row.id);
      if (!line) return null;
      return (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            onClick={() => setEditing(line)}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Details</Trans>
          </MenuItem>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            destructive
            disabled={!permissions.can("delete", "sales")}
            onClick={() => setDeleting(line)}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Line</Trans>
          </MenuItem>
        </>
      );
    },
    [lines, permissions]
  );

  const gridColumns = useMemo(
    () => [...columns, rowMenuColumn(renderContextMenu, t`Actions`)],
    [columns, renderContextMenu, t]
  );

  return (
    <div className="flex w-full flex-col gap-4">
      {rows.length === 0 ? (
        <div className="flex w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            <Trans>
              No services yet. Add the services this contract bills.
            </Trans>
          </p>
          <Button
            leftIcon={<LuPlus />}
            isDisabled={!permissions.can("create", "sales")}
            onClick={addProducts.onOpen}
          >
            <Trans>Add Services</Trans>
          </Button>
        </div>
      ) : (
        <>
          <div
            className="w-full overflow-hidden rounded-lg border border-border"
            style={{
              height: contractGridHeight(
                rows.length,
                rows.some(
                  (row) => row.readableId && row.readableId !== row.name
                )
                  ? 53
                  : 49
              )
            }}
          >
            <Table<ProductRow>
              compact
              columns={gridColumns}
              data={rows}
              count={rows.length}
              editableComponents={editableComponents}
              withInlineEditing={canEdit}
              forceEditMode={canEdit}
              withPagination={false}
              withSearch={false}
              withSimpleSorting={false}
              withSidebarTrigger={false}
              withColumnOrdering={false}
              withCsvExport={false}
              sort={null}
            />
          </div>
          <div>
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              isDisabled={!permissions.can("create", "sales")}
              onClick={addProducts.onOpen}
            >
              <Trans>Add Services</Trans>
            </Button>
          </div>
        </>
      )}

      {addProducts.isOpen && (
        <ContractAddProductsModal
          contractId={contractId}
          existingItemIds={lines.map((line) => line.itemId)}
          onClose={addProducts.onClose}
        />
      )}

      {editing && (
        <ContractLineForm
          type="modal"
          key={editing.id}
          title={contractLineName(editing)}
          currencyCode={currencyCode}
          initialValues={contractLineFormValues(editing)}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ConfirmDelete
          action={path.to.deleteContractLine(contractId, deleting.id)}
          name={contractLineName(deleting)}
          text={t`Are you sure you want to remove ${contractLineName(deleting)} from this contract?`}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </div>
  );
};

/** A line as the line form's values: discount and tax in percent points. */
function contractLineFormValues(line: ContractLine) {
  return {
    id: line.id,
    customerContractId: line.customerContractId,
    revenueType: line.revenueType,
    itemId: line.itemId,
    description: line.description ?? undefined,
    quantity: Number(line.quantity),
    rate: Number(line.rate),
    rateUnit: line.rateUnit ?? undefined,
    discountPercent: round(Number(line.discountPercent) * 100),
    discountEndsOn: line.discountEndsOn ?? undefined,
    taxPercent: round(Number(line.taxPercent) * 100),
    startDate: line.startDate,
    endDate: line.endDate ?? undefined,
    goLiveDate: line.goLiveDate ?? undefined,
    revenueMethod: line.revenueMethod,
    revenueStartDate: line.revenueStartDate ?? undefined,
    revenueEndDate: line.revenueEndDate ?? undefined,
    projectId: line.projectId ?? undefined
  };
}

/** Pick several services at once; each becomes a line with a new line's
 *  defaults (Recurring, quantity 1, billed per the contract's frequency from
 *  its start), to be priced in the grid. */
const ContractAddProductsModal = ({
  contractId,
  existingItemIds,
  onClose
}: {
  contractId: string;
  existingItemIds: string[];
  onClose: () => void;
}) => {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const services = useServices();
  const submitted = useRef(false);

  const options = useMemo(() => {
    const existing = new Set(existingItemIds);
    return services
      .filter((item) => item.active && !existing.has(item.id))
      .map((item) => ({
        value: item.id,
        label: item.readableIdWithRevision,
        helper: item.name
      }));
  }, [services, existingItemIds]);

  // The action redirects back with a flash; close once it has settled.
  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      submitted.current = false;
      onClose();
    }
  }, [fetcher.state, onClose]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={customerContractLinesAddValidator}
          method="post"
          action={path.to.contractLinesAdd(contractId)}
          fetcher={fetcher}
          defaultValues={{ itemIds: [] }}
          onSubmit={() => {
            submitted.current = true;
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Add Services</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Choose the services this contract bills. Each is added as a
                recurring line you can price in the grid.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <MultiSelect name="itemIds" label={t`Services`} options={options} />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              isDisabled={fetcher.state !== "idle"}
              onClick={onClose}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Add</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default ContractProductsGrid;
