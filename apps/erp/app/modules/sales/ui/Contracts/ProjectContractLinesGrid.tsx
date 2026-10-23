// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLoaderQuery } from "@carbon/query";
import {
  Button,
  LabelWithHelp,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  useDisclosure
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { LuPencil, LuPlus, LuReceipt, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Empty, Table } from "~/components";
import type { EditableTableCellComponentProps } from "~/components/Editable";
import {
  EditableList,
  EditableNumber,
  EditableText
} from "~/components/Editable";
import { ConfirmDelete } from "~/components/Modals";
import {
  rowMenuColumn,
  setupGridHeight,
  useCellSave
} from "~/components/Setup";
import {
  useCurrencyDecimals,
  usePercentFormatter,
  usePermissions,
  useSettings
} from "~/hooks";
import { path } from "~/utils/path";
import {
  type contractBillingMethods,
  type contractRevenueMethods,
  contractRevenueMethodsFor,
  isProjectBillingMethod
} from "../../sales.models";
import { useBillingMethodLabels } from "./ContractLineBillingFields";
import ContractLineForm from "./ContractLineForm";
import ContractMoney from "./ContractMoney";
import {
  contractLineFormValues,
  contractLineName,
  newContractLineFormValues
} from "./contractGrid";
import type { Contract, ContractLine } from "./types";

type BillingMethod = (typeof contractBillingMethods)[number];
type RevenueMethod = (typeof contractRevenueMethods)[number];

type LineRow = {
  id: string;
  lineItemNumber: string;
  description: string;
  name: string;
  billingMethod: BillingMethod;
  projectElementId: string | null;
  fundedAmount: number | null;
  ceilingAmount: number | null;
  /** The Cost Plus fee or the Time & Materials handling, in percent points,
   *  as the cell edits it. */
  markupPercent: number | null;
  /** A Fixed Price line's price: its rate at quantity 1. */
  rate: number;
  revenueMethod: RevenueMethod;
};

type BillingElementRow = { id: string; readableId: string; name: string };

type ProjectContractLinesGridProps = {
  contract: Contract;
  lines: ContractLine[];
};

/** A cell that does not apply to its row, or that has one value only. */
const Dash = () => <span className="text-muted-foreground">—</span>;
const ReadOnlyCell = ({ children }: { children: ReactNode }) => (
  <span className="flex h-full items-center px-3">{children}</span>
);

/** The fraction a line stores as the percent points a cell edits. */
const points = (fraction: number | null) =>
  fraction === null ? null : round(Number(fraction) * 100);
const amount = (value: number | null) =>
  value === null ? null : Number(value);

/** A billing element applies to a billing line, and to a Fixed Price line
 *  earned by Percent Complete. */
const hasElement = (row: LineRow) =>
  isProjectBillingMethod(row.billingMethod) ||
  row.revenueMethod === "Percent Complete";

/** A project contract's lines (CLINs) as a spreadsheet: CLIN, description,
 *  billing element, funding, fee or handling, price and revenue edit in
 *  place, one cell at a time, through the line's update route. The billing
 *  method and the rest of a line open in its form. */
const ProjectContractLinesGrid = ({
  contract,
  lines
}: ProjectContractLinesGridProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const settings = useSettings();
  const navigate = useNavigate();
  const save = useCellSave();
  const percent = usePercentFormatter();

  const contractId = contract.id!;
  const { currencyCode } = contract;
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const canEdit = permissions.can("update", "sales");
  // In DCAA mode the funding actions own a line's funded amount.
  const fundedByActions = settings.timekeepingControls === "DCAA";

  const addLine = useDisclosure();
  const [editing, setEditing] = useState<ContractLine | null>(null);
  const [deleting, setDeleting] = useState<ContractLine | null>(null);

  const billingMethodLabels = useBillingMethodLabels("Project");
  const revenueMethodLabels = useMemo<Record<RevenueMethod, string>>(
    () => ({
      Daily: t`Daily`,
      "Even Period": t`Even Period`,
      "Right to Invoice": t`Right to Invoice`,
      "Percent Complete": t`Percent Complete`
    }),
    [t]
  );

  const { data: billingElements } = useLoaderQuery<{
    data: BillingElementRow[];
  }>(
    contract.projectId
      ? path.to.api.projectBillingElements(contract.projectId)
      : null
  );
  const elementOptions = useMemo(
    () =>
      (billingElements?.data ?? []).map((element) => ({
        value: element.id,
        label: `${element.readableId} ${element.name}`
      })),
    [billingElements]
  );
  const elementLabels = useMemo(
    () => new Map(elementOptions.map((option) => [option.value, option.label])),
    [elementOptions]
  );

  const rows = useMemo<LineRow[]>(
    () =>
      lines.map((line) => ({
        id: line.id,
        lineItemNumber: line.lineItemNumber ?? "",
        description: line.description ?? "",
        name: contractLineName(line),
        billingMethod: line.billingMethod,
        projectElementId: line.projectElementId,
        fundedAmount: amount(line.fundedAmount),
        ceilingAmount: amount(line.ceilingAmount),
        markupPercent:
          line.billingMethod === "Cost Plus"
            ? points(line.feePercent)
            : line.billingMethod === "Time & Materials"
              ? points(line.materialHandlingPercent)
              : null,
        rate: Number(line.rate),
        revenueMethod: line.revenueMethod
      })),
    [lines]
  );

  const onCellEdit = useCallback(
    (accessorKey: string, value: unknown, row: LineRow) =>
      save(path.to.contractLineUpdate(contractId, row.id), {
        field:
          accessorKey === "markupPercent"
            ? row.billingMethod === "Cost Plus"
              ? "feePercent"
              : "materialHandlingPercent"
            : accessorKey,
        value: value === null || value === undefined ? "" : String(value)
      }),
    [contractId, save]
  );

  const columns = useMemo<ColumnDef<LineRow>[]>(
    () => [
      {
        accessorKey: "lineItemNumber",
        header: t`CLIN`,
        cell: ({ row }) =>
          row.original.lineItemNumber ? (
            <span className="whitespace-nowrap tabular-nums">
              {row.original.lineItemNumber}
            </span>
          ) : (
            <Dash />
          )
      },
      {
        accessorKey: "description",
        header: t`Description`,
        cell: ({ row }) => (
          <span
            className={
              row.original.description
                ? "block max-w-[240px] truncate font-medium"
                : "block max-w-[240px] truncate text-muted-foreground"
            }
          >
            {row.original.name}
          </span>
        )
      },
      {
        accessorKey: "billingMethod",
        header: () => (
          <LabelWithHelp termId="billing-method" variant="inline">
            <Trans>Billing Method</Trans>
          </LabelWithHelp>
        ),
        cell: ({ row }) => billingMethodLabels[row.original.billingMethod]
      },
      {
        accessorKey: "projectElementId",
        header: () => (
          <LabelWithHelp termId="billing-element" variant="inline">
            <Trans>Billing Element</Trans>
          </LabelWithHelp>
        ),
        cell: ({ row }) =>
          row.original.projectElementId ? (
            <span className="block max-w-[200px] truncate">
              {elementLabels.get(row.original.projectElementId) ?? ""}
            </span>
          ) : (
            <Dash />
          )
      },
      {
        accessorKey: "fundedAmount",
        header: () => (
          <LabelWithHelp termId="funded-amount" variant="inline">
            <Trans>Funded</Trans>
          </LabelWithHelp>
        ),
        cell: ({ row }) =>
          row.original.fundedAmount === null ? (
            <Dash />
          ) : (
            <ContractMoney
              value={row.original.fundedAmount}
              currencyCode={currencyCode}
            />
          )
      },
      {
        accessorKey: "ceilingAmount",
        header: () => (
          <LabelWithHelp termId="contract-ceiling" variant="inline">
            <Trans>Ceiling</Trans>
          </LabelWithHelp>
        ),
        cell: ({ row }) =>
          row.original.ceilingAmount === null ? (
            <Dash />
          ) : (
            <ContractMoney
              value={row.original.ceilingAmount}
              currencyCode={currencyCode}
            />
          )
      },
      {
        accessorKey: "markupPercent",
        header: t`Fee / Handling`,
        cell: ({ row }) =>
          row.original.markupPercent === null ? (
            <Dash />
          ) : (
            <span className="tabular-nums">
              {percent.format(row.original.markupPercent / 100)}
            </span>
          )
      },
      {
        accessorKey: "rate",
        header: t`Price`,
        cell: ({ row }) =>
          row.original.billingMethod === "Fixed" ? (
            <span className="font-medium">
              <ContractMoney
                value={row.original.rate}
                currencyCode={currencyCode}
              />
            </span>
          ) : (
            <Dash />
          )
      },
      {
        accessorKey: "revenueMethod",
        header: () => (
          <LabelWithHelp termId="revenue-method" variant="inline">
            <Trans>Revenue</Trans>
          </LabelWithHelp>
        ),
        cell: ({ row }) => revenueMethodLabels[row.original.revenueMethod]
      }
    ],
    [
      t,
      currencyCode,
      percent,
      billingMethodLabels,
      revenueMethodLabels,
      elementLabels
    ]
  );

  const editableComponents = useMemo(() => {
    const money = {
      minValue: 0,
      step: INPUT_STEP.money(currencyDecimals),
      formatOptions: INPUT_FORMAT.money(currencyCode, currencyDecimals)
    };
    const element = EditableList<LineRow>(onCellEdit, elementOptions);
    const funded = EditableNumber<LineRow>(onCellEdit, money, {
      clearable: true
    });
    const ceiling = EditableNumber<LineRow>(onCellEdit, money, {
      clearable: true
    });
    const markup = EditableNumber<LineRow>(
      onCellEdit,
      {
        minValue: 0,
        maxValue: 100,
        step: INPUT_STEP.percent,
        formatOptions: INPUT_FORMAT.percentPoints
      },
      { clearable: true }
    );
    const price = EditableNumber<LineRow>(onCellEdit, money);
    const revenueLists = new Map(
      (["Fixed", "Time & Materials", "Cost Plus"] as const).map((method) => [
        method,
        EditableList<LineRow>(
          onCellEdit,
          contractRevenueMethodsFor("Project", method).map((value) => ({
            value,
            label: revenueMethodLabels[value]
          }))
        )
      ])
    );
    const billing = (row: LineRow) => isProjectBillingMethod(row.billingMethod);

    return {
      lineItemNumber: EditableText<LineRow>(onCellEdit),
      description: EditableText<LineRow>(onCellEdit),
      projectElementId: (props: EditableTableCellComponentProps<LineRow>) =>
        hasElement(props.row) ? (
          element(props)
        ) : (
          <ReadOnlyCell>
            <Dash />
          </ReadOnlyCell>
        ),
      fundedAmount: (props: EditableTableCellComponentProps<LineRow>) =>
        billing(props.row) && !fundedByActions ? (
          funded(props)
        ) : (
          <ReadOnlyCell>
            {props.row.fundedAmount === null ? (
              <Dash />
            ) : (
              <ContractMoney
                value={props.row.fundedAmount}
                currencyCode={currencyCode}
              />
            )}
          </ReadOnlyCell>
        ),
      ceilingAmount: (props: EditableTableCellComponentProps<LineRow>) =>
        billing(props.row) ? (
          ceiling(props)
        ) : (
          <ReadOnlyCell>
            <Dash />
          </ReadOnlyCell>
        ),
      markupPercent: (props: EditableTableCellComponentProps<LineRow>) =>
        billing(props.row) ? (
          markup(props)
        ) : (
          <ReadOnlyCell>
            <Dash />
          </ReadOnlyCell>
        ),
      rate: (props: EditableTableCellComponentProps<LineRow>) =>
        props.row.billingMethod === "Fixed" ? (
          price(props)
        ) : (
          <ReadOnlyCell>
            <Dash />
          </ReadOnlyCell>
        ),
      // Time & Materials has one revenue method: nothing to choose.
      revenueMethod: (props: EditableTableCellComponentProps<LineRow>) =>
        contractRevenueMethodsFor("Project", props.row.billingMethod).length >
        1 ? (
          revenueLists.get(props.row.billingMethod)!(props)
        ) : (
          <ReadOnlyCell>
            {revenueMethodLabels[props.row.revenueMethod]}
          </ReadOnlyCell>
        )
    };
  }, [
    onCellEdit,
    currencyCode,
    currencyDecimals,
    elementOptions,
    fundedByActions,
    revenueMethodLabels
  ]);

  const renderContextMenu = useCallback(
    (row: LineRow) => {
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
          {isProjectBillingMethod(line.billingMethod) && (
            <MenuItem
              onClick={() =>
                navigate(path.to.contractLineBilling(contractId, line.id))
              }
            >
              <MenuIcon icon={<LuReceipt />} />
              <Trans>Billing</Trans>
            </MenuItem>
          )}
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
    [lines, permissions, navigate, contractId]
  );

  const gridColumns = useMemo(
    () => [...columns, rowMenuColumn(renderContextMenu, t`Actions`)],
    [columns, renderContextMenu, t]
  );

  return (
    <div className="flex w-full flex-col gap-4">
      {rows.length === 0 ? (
        <Empty
          className="rounded-lg border border-dashed border-border py-16"
          title={<Trans>No lines yet</Trans>}
          description={
            <Trans>
              Add a line for each CLIN: Time & Materials, Cost Plus or Fixed
              Price.
            </Trans>
          }
        >
          <Button
            className="mt-4"
            leftIcon={<LuPlus />}
            isDisabled={!permissions.can("create", "sales")}
            onClick={addLine.onOpen}
          >
            <Trans>Add Line</Trans>
          </Button>
        </Empty>
      ) : (
        <>
          <div
            className="w-full overflow-hidden rounded-lg border border-border"
            style={{ height: setupGridHeight(rows.length, 49) }}
          >
            <Table<LineRow>
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
              onClick={addLine.onOpen}
            >
              <Trans>Add Line</Trans>
            </Button>
          </div>
        </>
      )}

      {addLine.isOpen && (
        <ContractLineForm
          type="modal"
          initialValues={newContractLineFormValues(contract)}
          currencyCode={currencyCode}
          billingBasis="Project"
          onClose={addLine.onClose}
        />
      )}

      {editing && (
        <ContractLineForm
          type="modal"
          key={editing.id}
          title={contractLineName(editing)}
          currencyCode={currencyCode}
          billingBasis="Project"
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

export default ProjectContractLinesGrid;
