// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  cn,
  MenuIcon,
  MenuItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  MultiSelect,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDebounce,
  useDisclosure,
  VStack
} from "@carbon/react";
import type { ContractAmendmentPreview } from "@carbon/server-functions/post-customer-contract";
import { equals, INPUT_FORMAT, INPUT_STEP, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuCircleAlert,
  LuCircleStop,
  LuPlus,
  LuTrash,
  LuTriangleAlert,
  LuUndo2
} from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Table as Grid } from "~/components";
import type { EditableTableCellComponentProps } from "~/components/Editable";
import {
  EditableList,
  EditableNumber,
  EditableText
} from "~/components/Editable";
import {
  DatePicker,
  Hidden,
  Select,
  SelectControlled,
  Submit,
  TextArea
} from "~/components/Form";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useDateFormatter,
  usePercentFormatter,
  usePermissions,
  useQuantityFormatter
} from "~/hooks";
import { useServices } from "~/stores";
import {
  type contractAmendmentChangeValidator,
  contractAmendmentEffects,
  contractRateUnits,
  contractRevenueTypes,
  customerContractAmendmentValidator,
  customerContractTypes
} from "../../sales.models";
import ContractMoney from "./ContractMoney";
import { contractGridHeight, rowMenuColumn } from "./contractGrid";
import type {
  Contract,
  ContractLine,
  ContractRouteData,
  ContractType
} from "./types";
import { useContractLabels } from "./useContractLabels";

type Effect = (typeof contractAmendmentEffects)[number];
type RateUnit = (typeof contractRateUnits)[number];
type RevenueType = (typeof contractRevenueTypes)[number];
type AmendmentChange = z.infer<typeof contractAmendmentChangeValidator>;

/** A line as the amendment grid edits it: an open line of the contract, or
 *  one the amendment adds (`isNew`). Percentages in percent points, as the
 *  amendment posts them. */
type AmendRow = {
  id: string;
  isNew: boolean;
  itemId: string;
  name: string;
  readableId: string | null;
  description: string;
  revenueType: RevenueType;
  quantity: number;
  rate: number;
  rateUnit: RateUnit | null;
  discountPercent: number;
  taxPercent: number;
  end: boolean;
};

type PreviewResponse = {
  preview: ContractAmendmentPreview | null;
  error: string | null;
};

type ContractAmendModalProps = Pick<ContractRouteData, "lines"> & {
  contract: Contract;
  action: string;
  onClose: () => void;
};

const toRow = (line: ContractLine): AmendRow => ({
  id: line.id,
  isNew: false,
  itemId: line.itemId,
  name: line.item?.name ?? line.itemId,
  readableId: line.item?.readableIdWithRevision ?? null,
  description: line.description ?? "",
  revenueType: line.revenueType,
  quantity: Number(line.quantity),
  rate: Number(line.rate),
  rateUnit: line.rateUnit,
  discountPercent: round(Number(line.discountPercent) * 100),
  taxPercent: round(Number(line.taxPercent) * 100),
  end: false
});

const isValidNumber = (value: number, min = 0) =>
  Number.isFinite(value) && value >= min;

/** What a grid cell's edit does to its row. The editable cells hand over a
 *  number or a string by column. */
const NUMBER_FIELDS = new Set([
  "quantity",
  "rate",
  "discountPercent",
  "taxPercent"
]);

/** The grid edits local state: nothing saves until Amend. */
const localSave = () =>
  Promise.resolve({
    data: null,
    error: null
  } as unknown as PostgrestSingleResponse<null>);

/** Amend an Active contract: change, add or end lines from a date, in the
 *  same grid as the setup wizard. Each edit is previewed — the amendment
 *  runs and rolls back on the server — so the adjustments and the next
 *  invoices are seen before saving. */
const ContractAmendModal = ({
  contract,
  lines,
  action,
  onClose
}: ContractAmendModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const today = useCompanyToday();
  const labels = useContractLabels();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const percent = usePercentFormatter();
  const fetcher = useFetcher<{}>();
  const previewFetcher = useFetcher<PreviewResponse>();
  const addServices = useDisclosure();

  const id = contract.id!;
  const currencyCode = contract.currencyCode ?? "USD";
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  // A line that has already ended cannot be amended; a replaced line has.
  const openLines = useMemo(
    () =>
      lines.filter((line) => line.endDate === null || line.endDate >= today),
    [lines, today]
  );
  const originals = useMemo(
    () => new Map(openLines.map((line) => [line.id, toRow(line)])),
    [openLines]
  );
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const nameOf = (lineId: string) => {
    const line = lineById.get(lineId);
    return line
      ? line.description || line.item?.name || line.itemId
      : t`New line`;
  };

  const [amendmentDate, setAmendmentDate] = useState(today);
  const [effect, setEffect] = useState<Effect>("Change Date");
  const [rows, setRows] = useState<AmendRow[]>(() => openLines.map(toRow));
  const [nextKey, setNextKey] = useState(0);
  const [chosenType, setChosenType] = useState<ContractType | null>(null);
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);

  const updateRow = useCallback(
    (rowId: string, patch: Partial<AmendRow>) =>
      setRows((prev) =>
        prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
      ),
    []
  );

  const onCellEdit = useCallback(
    (accessorKey: string, value: unknown, row: AmendRow) => {
      if (NUMBER_FIELDS.has(accessorKey)) {
        updateRow(row.id, { [accessorKey]: Number(value) });
      } else if (accessorKey === "revenueType") {
        const revenueType = contractRevenueTypes.find((v) => v === value);
        if (revenueType) {
          updateRow(row.id, {
            revenueType,
            // A one-time line has no rate unit; a recurring one starts at the
            // contract's billing frequency.
            rateUnit:
              revenueType === "One-time"
                ? null
                : (row.rateUnit ?? contract.billingFrequency ?? "Month")
          });
        }
      } else if (accessorKey === "rateUnit") {
        const rateUnit = contractRateUnits.find((v) => v === value);
        if (rateUnit) updateRow(row.id, { rateUnit });
      } else if (accessorKey === "description") {
        updateRow(row.id, { description: String(value ?? "") });
      }
      return localSave();
    },
    [updateRow, contract.billingFrequency]
  );

  const addRows = (itemIds: string[], services: AddableService[]) => {
    const byId = new Map(services.map((item) => [item.id, item]));
    setRows((prev) => [
      ...prev,
      ...itemIds.map((itemId, index) => {
        const item = byId.get(itemId);
        return {
          id: `new${nextKey + index}`,
          isNew: true,
          itemId,
          name: item?.name ?? itemId,
          readableId: item?.readableIdWithRevision ?? null,
          description: "",
          revenueType: "Recurring" as const,
          quantity: 1,
          rate: 0,
          rateUnit: contract.billingFrequency ?? "Month",
          discountPercent: 0,
          taxPercent: 0,
          end: false
        };
      })
    ]);
    setNextKey((key) => key + itemIds.length);
  };

  // The changes as the amendment posts them — only what differs.
  const changes = useMemo(
    () =>
      rows.flatMap((row): AmendmentChange[] => {
        if (row.isNew) {
          return [
            {
              op: "add",
              line: {
                revenueType: row.revenueType,
                itemId: row.itemId,
                description: row.description || undefined,
                quantity: row.quantity,
                rate: row.rate,
                rateUnit:
                  row.revenueType === "Recurring"
                    ? (row.rateUnit ?? undefined)
                    : undefined,
                discountPercent: row.discountPercent,
                taxPercent: row.taxPercent,
                // The server starts it on the effective date when that is later.
                startDate: amendmentDate,
                revenueMethod: "Daily"
              }
            }
          ];
        }
        if (row.end) return [{ op: "end", lineId: row.id }];
        const original = originals.get(row.id);
        if (!original) return [];
        const change = {
          ...(!equals(row.quantity, original.quantity) && {
            quantity: row.quantity
          }),
          ...(!equals(row.rate, original.rate) && { rate: row.rate }),
          ...(!equals(row.discountPercent, original.discountPercent) && {
            discountPercent: row.discountPercent
          }),
          ...(!equals(row.taxPercent, original.taxPercent) && {
            taxPercent: row.taxPercent
          }),
          ...(row.description !== original.description && {
            description: row.description
          })
        };
        return Object.keys(change).length > 0
          ? [{ op: "change", lineId: row.id, ...change }]
          : [];
      }),
    [rows, originals, amendmentDate]
  );
  const changedIds = useMemo(
    () =>
      new Set(
        changes.flatMap((change) =>
          change.op === "change" ? [change.lineId] : []
        )
      ),
    [changes]
  );

  const isValid =
    !!amendmentDate &&
    rows.every(
      (row) =>
        row.end ||
        (!!row.itemId &&
          isValidNumber(row.quantity) &&
          row.quantity > 0 &&
          isValidNumber(row.rate) &&
          isValidNumber(row.discountPercent) &&
          isValidNumber(row.taxPercent) &&
          (row.revenueType === "One-time" || !!row.rateUnit))
    );
  const hasChanges = changes.length > 0;
  const changesJson = JSON.stringify(changes);

  // Preview whenever the amendment changes, once it is complete.
  const previewKey =
    isValid && hasChanges
      ? JSON.stringify({ amendmentDate, effect, changes })
      : null;
  const submitPreview = useDebounce((key: string) => {
    const { amendmentDate, effect, changes } = JSON.parse(key);
    const formData = new FormData();
    formData.set("intent", "preview");
    formData.set("customerContractId", id);
    formData.set("amendmentDate", amendmentDate);
    formData.set("effect", effect);
    formData.set("changes", JSON.stringify(changes));
    setSubmittedKey(key);
    previewFetcher.submit(formData, { method: "post", action });
  }, 500);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key carries every input; the debounced submitter is a new function each render
  useEffect(() => {
    if (previewKey) submitPreview(previewKey);
  }, [previewKey]);

  const isPreviewing =
    previewFetcher.state !== "idle" || submittedKey !== previewKey;
  const preview = previewKey ? previewFetcher.data?.preview : null;
  const previewError = previewKey ? previewFetcher.data?.error : null;
  const isRefused = !isPreviewing && !!previewError;

  // The type follows the preview's suggestion until it is chosen by hand.
  const contractType = chosenType ?? preview?.suggestedType;

  const effectLabels: Record<Effect, string> = {
    "Change Date": t`From the change date`,
    "Next Period": t`From the next billing period`
  };
  const revenueTypeLabels = useMemo<Record<RevenueType, string>>(
    () => ({ "One-time": t`One-time`, Recurring: t`Recurring` }),
    [t]
  );
  const rateUnitLabels = useMemo<Record<RateUnit, string>>(
    () => ({
      Day: t`Day`,
      Week: t`Week`,
      Month: t`Month`,
      Quarter: t`Quarter`,
      Year: t`Year`
    }),
    [t]
  );

  // How each cell reads, both in its column and where a row cannot edit it
  // (an ended line, or a type an existing line cannot change).
  const display = useMemo<
    Record<
      | "description"
      | "revenueType"
      | "quantity"
      | "rate"
      | "rateUnit"
      | "discountPercent"
      | "taxPercent",
      (row: AmendRow) => ReactNode
    >
  >(
    () => ({
      description: (row) =>
        row.description ? (
          <span className="truncate">{row.description}</span>
        ) : (
          <span className="truncate text-muted-foreground">{row.name}</span>
        ),
      revenueType: (row) => revenueTypeLabels[row.revenueType],
      quantity: (row) => (
        <span className="tabular-nums">{formatQuantity(row.quantity)}</span>
      ),
      rate: (row) => (
        <ContractMoney value={row.rate} currencyCode={currencyCode} rate />
      ),
      rateUnit: (row) =>
        row.revenueType === "Recurring" && row.rateUnit ? (
          rateUnitLabels[row.rateUnit]
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      discountPercent: (row) =>
        row.discountPercent > 0 ? (
          <span className="tabular-nums">
            {percent.format(row.discountPercent / 100)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      taxPercent: (row) =>
        row.taxPercent > 0 ? (
          <span className="tabular-nums">
            {percent.format(row.taxPercent / 100)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )
    }),
    [currencyCode, formatQuantity, percent, rateUnitLabels, revenueTypeLabels]
  );

  const columns = useMemo<ColumnDef<AmendRow>[]>(() => {
    const cell =
      (key: keyof typeof display): ColumnDef<AmendRow>["cell"] =>
      ({ row }) => (
        <span
          className={cn(
            row.original.end && "text-muted-foreground line-through"
          )}
        >
          {display[key](row.original)}
        </span>
      );
    return [
      {
        accessorKey: "name",
        header: t`Service`,
        cell: ({ row }) => (
          <div
            className={cn(
              "flex max-w-[220px] flex-col",
              row.original.end && "text-muted-foreground line-through"
            )}
          >
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
        accessorKey: "description",
        header: t`Description`,
        cell: cell("description")
      },
      {
        accessorKey: "revenueType",
        header: t`Revenue Type`,
        cell: cell("revenueType")
      },
      { accessorKey: "quantity", header: t`Qty`, cell: cell("quantity") },
      { accessorKey: "rate", header: t`Rate`, cell: cell("rate") },
      { accessorKey: "rateUnit", header: t`Per`, cell: cell("rateUnit") },
      {
        accessorKey: "discountPercent",
        header: t`Discount`,
        cell: cell("discountPercent")
      },
      { accessorKey: "taxPercent", header: t`Tax`, cell: cell("taxPercent") },
      {
        id: "change",
        header: t`Change`,
        cell: ({ row }) => {
          const r = row.original;
          if (r.isNew) return <Badge variant="green">{t`New`}</Badge>;
          if (r.end) return <Badge variant="red">{t`Ends`}</Badge>;
          return changedIds.has(r.id) ? (
            <Badge variant="secondary">{t`Changed`}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        }
      }
    ];
  }, [t, display, changedIds]);

  const editableComponents = useMemo(() => {
    // An ended line, and a type an existing line cannot change, read as they
    // are instead of editing.
    const unless =
      (
        key: keyof typeof display,
        isLocked: (row: AmendRow) => boolean,
        editor: (
          props: EditableTableCellComponentProps<AmendRow>
        ) => JSX.Element
      ) =>
      (props: EditableTableCellComponentProps<AmendRow>) =>
        props.row.end || isLocked(props.row) ? (
          <span
            className={cn(
              "flex h-full items-center px-3",
              props.row.end && "text-muted-foreground line-through"
            )}
          >
            {display[key](props.row)}
          </span>
        ) : (
          editor(props)
        );
    const never = () => false;
    const existing = (row: AmendRow) => !row.isNew;
    const percentField = {
      minValue: 0,
      maxValue: 100,
      step: INPUT_STEP.percent,
      formatOptions: INPUT_FORMAT.percentPoints
    };
    return {
      description: unless(
        "description",
        never,
        EditableText<AmendRow>(onCellEdit)
      ),
      revenueType: unless(
        "revenueType",
        existing,
        EditableList<AmendRow>(
          onCellEdit,
          contractRevenueTypes.map((value) => ({
            value,
            label: revenueTypeLabels[value]
          }))
        )
      ),
      quantity: unless(
        "quantity",
        never,
        EditableNumber<AmendRow>(onCellEdit, {
          minValue: 0,
          step: INPUT_STEP.quantity,
          formatOptions: INPUT_FORMAT.quantity
        })
      ),
      rate: unless(
        "rate",
        never,
        EditableNumber<AmendRow>(onCellEdit, {
          minValue: 0,
          step: INPUT_STEP.rate,
          formatOptions: INPUT_FORMAT.rate(currencyCode, currencyDecimals)
        })
      ),
      rateUnit: unless(
        "rateUnit",
        (row) => !row.isNew || row.revenueType !== "Recurring",
        EditableList<AmendRow>(
          onCellEdit,
          contractRateUnits.map((value) => ({
            value,
            label: rateUnitLabels[value]
          }))
        )
      ),
      discountPercent: unless(
        "discountPercent",
        never,
        EditableNumber<AmendRow>(onCellEdit, percentField)
      ),
      taxPercent: unless(
        "taxPercent",
        never,
        EditableNumber<AmendRow>(onCellEdit, percentField)
      )
    };
  }, [
    display,
    onCellEdit,
    currencyCode,
    currencyDecimals,
    revenueTypeLabels,
    rateUnitLabels
  ]);

  const renderRowMenu = useCallback(
    (row: AmendRow) =>
      row.isNew ? (
        <MenuItem
          destructive
          onClick={() =>
            setRows((prev) => prev.filter((other) => other.id !== row.id))
          }
        >
          <MenuIcon icon={<LuTrash />} />
          <Trans>Remove Line</Trans>
        </MenuItem>
      ) : row.end ? (
        <MenuItem onClick={() => updateRow(row.id, { end: false })}>
          <MenuIcon icon={<LuUndo2 />} />
          <Trans>Keep Line</Trans>
        </MenuItem>
      ) : (
        <MenuItem
          destructive
          onClick={() => {
            // Ending a line drops its other edits: it ends as it is.
            const original = originals.get(row.id);
            updateRow(row.id, { ...original, end: true });
          }}
        >
          <MenuIcon icon={<LuCircleStop />} />
          <Trans>End Line</Trans>
        </MenuItem>
      ),
    [originals, updateRow]
  );

  const gridColumns = useMemo(
    () => [...columns, rowMenuColumn(renderRowMenu, t`Actions`)],
    [columns, renderRowMenu, t]
  );

  const period = (start: string, end: string) =>
    `${formatDate(start)} – ${formatDate(end)}`;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xxlarge">
        <ValidatedForm
          validator={customerContractAmendmentValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{
            customerContractId: id,
            amendmentDate: today,
            effect: "Change Date"
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Amend {contract.customerContractId}</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Change, add or end lines from a date. Periods already invoiced
                past it are adjusted on the next invoice.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="save" />
            <Hidden name="customerContractId" value={id} />
            <Hidden name="changes" value={changesJson} />
            <VStack spacing={4}>
              <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2">
                <DatePicker
                  name="amendmentDate"
                  label={t`Change Date`}
                  onChange={(date) => setAmendmentDate(date ?? "")}
                />
                <Select
                  name="effect"
                  label={t`Takes Effect`}
                  options={contractAmendmentEffects.map((value) => ({
                    value,
                    label: effectLabels[value]
                  }))}
                  onChange={(option) => {
                    const next = contractAmendmentEffects.find(
                      (value) => value === option?.value
                    );
                    if (next) setEffect(next);
                  }}
                />
              </div>

              {rows.length === 0 ? (
                <div className="flex w-full items-center justify-center rounded-lg border border-dashed border-border px-6 py-10 text-sm text-muted-foreground">
                  <Trans>No open lines. Add a service to amend.</Trans>
                </div>
              ) : (
                // Enter commits a cell; it must not submit the amendment.
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
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.metaKey &&
                      !event.ctrlKey &&
                      event.target instanceof HTMLInputElement
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  <Grid<AmendRow>
                    compact
                    columns={gridColumns}
                    data={rows}
                    count={rows.length}
                    editableComponents={editableComponents}
                    withInlineEditing
                    forceEditMode
                    withPagination={false}
                    withSearch={false}
                    withSimpleSorting={false}
                    withSidebarTrigger={false}
                    withColumnOrdering={false}
                    withCsvExport={false}
                    sort={null}
                  />
                </div>
              )}
              <div className="w-full">
                <Button
                  variant="secondary"
                  leftIcon={<LuPlus />}
                  onClick={addServices.onOpen}
                >
                  <Trans>Add Services</Trans>
                </Button>
              </div>

              {previewKey && (
                <VStack
                  spacing={3}
                  className={cn(
                    "w-full border-t border-border pt-4",
                    isPreviewing && "opacity-60"
                  )}
                >
                  {isRefused ? (
                    <Alert variant="destructive">
                      <LuCircleAlert className="h-4 w-4" />
                      <AlertTitle>
                        <Trans>This amendment cannot be made</Trans>
                      </AlertTitle>
                      <AlertDescription>{previewError}</AlertDescription>
                    </Alert>
                  ) : preview ? (
                    <AmendmentPreview
                      preview={preview}
                      currencyCode={currencyCode}
                      nameOf={nameOf}
                      period={period}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <Trans>Previewing the amendment…</Trans>
                    </p>
                  )}
                </VStack>
              )}

              <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2 border-t border-border pt-4">
                <SelectControlled
                  name="contractType"
                  label={t`Contract Type`}
                  helperText={t`Suggested from the change in recurring value`}
                  value={contractType}
                  options={customerContractTypes.map((value) => ({
                    value,
                    label: labels.contractType[value]
                  }))}
                  onChange={(option) => {
                    const next = customerContractTypes.find(
                      (value) => value === option?.value
                    );
                    if (next) setChosenType(next);
                  }}
                />
                <TextArea name="reason" label={t`Reason`} />
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              isDisabled={
                !hasChanges ||
                !isValid ||
                isRefused ||
                !permissions.can("update", "sales")
              }
            >
              <Trans>Amend</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
      {addServices.isOpen && (
        <AddServicesModal onAdd={addRows} onClose={addServices.onClose} />
      )}
    </Modal>
  );
};

type AddableService = {
  id: string;
  name: string;
  readableIdWithRevision: string;
};

/** Pick several services at once, as the setup wizard's Add Services does;
 *  each becomes a new recurring line in the grid, priced there. */
const AddServicesModal = ({
  onAdd,
  onClose
}: {
  onAdd: (itemIds: string[], services: AddableService[]) => void;
  onClose: () => void;
}) => {
  const { t } = useLingui();
  const services = useServices();
  const [itemIds, setItemIds] = useState<string[]>([]);

  const active = useMemo(
    () => services.filter((item) => item.active),
    [services]
  );
  const options = useMemo(
    () =>
      active.map((item) => ({
        value: item.id,
        label: item.readableIdWithRevision,
        helper: item.name
      })),
    [active]
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Add Services</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Each is added as a recurring line from the change date, to be
              priced in the grid.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <MultiSelect
            aria-label={t`Services`}
            value={itemIds}
            options={options}
            onChange={setItemIds}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isDisabled={itemIds.length === 0}
            onClick={() => {
              onAdd(itemIds, active);
              onClose();
            }}
          >
            <Trans>Add</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

/** The amendment's effect before it is saved: the effective date, the
 *  adjustments to periods already invoiced, and the next two invoices. */
function AmendmentPreview({
  preview,
  currencyCode,
  nameOf,
  period
}: {
  preview: ContractAmendmentPreview;
  currencyCode: string;
  nameOf: (lineId: string) => string;
  period: (start: string, end: string) => string;
}) {
  const { formatDate } = useDateFormatter();
  const effectiveDate = formatDate(preview.effectiveDate);
  const resets = preview.resetsEditedInvoices;

  return (
    <>
      <p className="text-sm text-muted-foreground">
        <Trans>Takes effect {effectiveDate}.</Trans>
      </p>
      {resets > 0 && (
        <Alert variant="warning">
          <LuTriangleAlert className="h-4 w-4" />
          <AlertTitle>
            {resets === 1 ? (
              <Trans>This resets 1 edited invoice from {effectiveDate}</Trans>
            ) : (
              <Trans>
                This resets {resets} edited invoices from {effectiveDate}
              </Trans>
            )}
          </AlertTitle>
          <AlertDescription>
            <Trans>
              Their dates and splits are planned again from the lines.
            </Trans>
          </AlertDescription>
        </Alert>
      )}
      <Table>
        <Thead>
          <Tr>
            <Th>
              <Trans>Line</Trans>
            </Th>
            <Th>
              <Trans>Period</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Amount</Trans>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {preview.adjustments.length > 0 && (
            <>
              <Tr>
                <Td colSpan={3} className="font-medium">
                  <Trans>Adjustments</Trans>
                </Td>
              </Tr>
              {preview.adjustments.map((row, index) => (
                <Tr key={`adjustment-${index}`}>
                  <Td className="truncate">{nameOf(row.lineId)}</Td>
                  <Td className="tabular-nums whitespace-nowrap">
                    {period(row.periodStart, row.periodEnd)}
                  </Td>
                  <Td className="text-right">
                    <ContractMoney
                      value={row.amount}
                      currencyCode={currencyCode}
                    />
                  </Td>
                </Tr>
              ))}
            </>
          )}
          {preview.nextInvoices.length === 0 ? (
            <Tr>
              <Td colSpan={3} className="text-muted-foreground">
                <Trans>No invoices planned after the change.</Trans>
              </Td>
            </Tr>
          ) : (
            preview.nextInvoices.map((invoice) => {
              const invoiceDate = formatDate(invoice.invoiceDate);
              return (
                <Fragment key={invoice.invoiceDate}>
                  <Tr>
                    <Td colSpan={2} className="font-medium">
                      <Trans>Invoice {invoiceDate}</Trans>
                    </Td>
                    <Td className="text-right font-medium">
                      <ContractMoney
                        value={invoice.total}
                        currencyCode={currencyCode}
                      />
                    </Td>
                  </Tr>
                  {invoice.rows.map((row, index) => (
                    <Tr key={`${invoice.invoiceDate}-${index}`}>
                      <Td>
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{nameOf(row.lineId)}</span>
                          {row.isAdjustment && (
                            <Badge variant="secondary" className="shrink-0">
                              <Trans>Adjustment</Trans>
                            </Badge>
                          )}
                        </span>
                      </Td>
                      <Td className="tabular-nums whitespace-nowrap">
                        {period(row.periodStart, row.periodEnd)}
                      </Td>
                      <Td className="text-right">
                        <ContractMoney
                          value={row.amount}
                          currencyCode={currencyCode}
                        />
                      </Td>
                    </Tr>
                  ))}
                </Fragment>
              );
            })
          )}
        </Tbody>
      </Table>
    </>
  );
}

export default ContractAmendModal;
