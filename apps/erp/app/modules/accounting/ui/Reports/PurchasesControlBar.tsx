import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  Switch
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  LuColumns3,
  LuCornerDownRight,
  LuDownload,
  LuRows3,
  LuSigma,
  LuX
} from "react-icons/lu";
import { PeriodSelector } from "~/components";
import { DimensionEntityTypeIcon } from "~/components/Icons";
import { useUrlParams } from "~/hooks";
import type { PivotMeasure, PivotState } from "../../accounting.models";
import {
  financialReportColumns,
  pivotMeasures,
  purchaseGroupingFields
} from "../../accounting.models";

type PurchasesControlBarProps = {
  state: PivotState;
  onDownload: () => void;
};

const PurchasesControlBar = ({
  state,
  onDownload
}: PurchasesControlBarProps) => {
  const { t } = useLingui();
  const [params, setParams] = useUrlParams();

  // Grouping fields (purchase invoice line / header columns), with a label and
  // the entityType used for the row/column icons.
  const fieldOptions: {
    field: string;
    label: string;
    entityType: string;
  }[] = useMemo(() => {
    const labels: Record<(typeof purchaseGroupingFields)[number], string> = {
      supplier: t`Supplier`,
      supplierType: t`Supplier Type`,
      item: t`Item`,
      itemPostingGroup: t`Item Group`,
      costCenter: t`Cost Center`
    };
    const entityTypes: Record<(typeof purchaseGroupingFields)[number], string> =
      {
        supplier: "Supplier",
        supplierType: "SupplierType",
        item: "Item",
        itemPostingGroup: "ItemPostingGroup",
        costCenter: "CostCenter"
      };
    return purchaseGroupingFields.map((field) => ({
      field,
      label: labels[field],
      entityType: entityTypes[field]
    }));
  }, [t]);

  const fieldById = useMemo(
    () => new Map(fieldOptions.map((o) => [o.field, o])),
    [fieldOptions]
  );

  const columnLabels: Record<(typeof financialReportColumns)[number], string> =
    {
      month: t`Monthly`,
      quarter: t`Quarterly`,
      year: t`Yearly`
    };

  const measureLabels: Record<PivotMeasure, string> = {
    amount: t`Amount`,
    quantity: t`Quantity`,
    count: t`Count`
  };

  // -- Rows --
  const row1 = state.rows[0];
  const row2 = state.rows[1];

  const setRows = (rows: string[]) => {
    setParams({ rows: rows.length > 0 ? rows.join(",") : undefined });
  };

  const onRow1Change = (field: string) => {
    if (!field) {
      setRows(row2 ? [row2] : []);
      return;
    }
    setRows([field, ...(row2 && row2 !== field ? [row2] : [])]);
  };

  const onRow2Change = (field: string) => {
    if (!row1) return;
    setRows(field ? [row1, field] : [row1]);
  };

  // -- Columns --
  const columnAxisValue =
    state.columnAxis.type === "period" ? state.columnAxis.bucket : "dimension";

  const columnFieldId =
    state.columnAxis.type === "dimension"
      ? state.columnAxis.dimensionId
      : undefined;

  const columnCandidates = fieldOptions.filter(
    (o) => !state.rows.includes(o.field)
  );

  const columnLabel =
    state.columnAxis.type === "period"
      ? columnLabels[state.columnAxis.bucket]
      : (fieldById.get(state.columnAxis.dimensionId)?.label ?? t`By field`);

  const onColumnAxisChange = (value: string) => {
    if (value === "dimension") {
      const fallback = columnCandidates[0];
      if (!fallback) return;
      setParams({ col: `dim:${fallback.field}` });
      return;
    }
    setParams({ col: value === "month" ? undefined : `period:${value}` });
  };

  const onReset = () => {
    setParams({
      rows: undefined,
      col: undefined,
      measure: undefined,
      pct: undefined,
      startDate: undefined,
      endDate: undefined
    });
  };

  return (
    <div className="flex flex-wrap px-4 py-3 items-center gap-2 justify-between bg-card border-b border-border w-full">
      <HStack className="flex-wrap gap-y-2">
        <PeriodSelector variant="range" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" leftIcon={<LuRows3 />}>
              {row1 ? (fieldById.get(row1)?.label ?? row1) : t`Group by`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={row1 ?? ""}
              onValueChange={onRow1Change}
            >
              <DropdownMenuRadioItem value="">
                <Trans>None</Trans>
              </DropdownMenuRadioItem>
              {fieldOptions.map((option) => (
                <DropdownMenuRadioItem key={option.field} value={option.field}>
                  <DropdownMenuIcon
                    icon={
                      <DimensionEntityTypeIcon
                        entityType={option.entityType as any}
                      />
                    }
                  />
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              leftIcon={<LuCornerDownRight />}
              isDisabled={!row1}
            >
              {row2 ? (fieldById.get(row2)?.label ?? row2) : t`Then by`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={row2 ?? ""}
              onValueChange={onRow2Change}
            >
              <DropdownMenuRadioItem value="">
                <Trans>None</Trans>
              </DropdownMenuRadioItem>
              {fieldOptions
                .filter((option) => option.field !== row1)
                .map((option) => (
                  <DropdownMenuRadioItem
                    key={option.field}
                    value={option.field}
                  >
                    <DropdownMenuIcon
                      icon={
                        <DimensionEntityTypeIcon
                          entityType={option.entityType as any}
                        />
                      }
                    />
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" leftIcon={<LuColumns3 />}>
              {columnLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={columnAxisValue}
              onValueChange={onColumnAxisChange}
            >
              {financialReportColumns.map((granularity) => (
                <DropdownMenuRadioItem key={granularity} value={granularity}>
                  {columnLabels[granularity]}
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuRadioItem
                value="dimension"
                disabled={columnCandidates.length === 0}
              >
                <Trans>By field</Trans>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {state.columnAxis.type === "dimension" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">
                {columnFieldId
                  ? (fieldById.get(columnFieldId)?.label ?? columnFieldId)
                  : t`Column field`}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={columnFieldId ?? ""}
                onValueChange={(value) => {
                  if (value) setParams({ col: `dim:${value}` });
                }}
              >
                {columnCandidates.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.field}
                    value={option.field}
                  >
                    <DropdownMenuIcon
                      icon={
                        <DimensionEntityTypeIcon
                          entityType={option.entityType as any}
                        />
                      }
                    />
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" leftIcon={<LuSigma />}>
              {measureLabels[state.measure]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={state.measure}
              onValueChange={(value) =>
                setParams({ measure: value === "amount" ? undefined : value })
              }
            >
              {pivotMeasures.map((measure) => (
                <DropdownMenuRadioItem key={measure} value={measure}>
                  {measureLabels[measure]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Switch
          variant="small"
          checked={state.percentOfTotal}
          onCheckedChange={(checked) =>
            setParams({ pct: checked ? "1" : undefined })
          }
          label={t`% of total`}
        />
        {[...params.entries()].length > 0 && (
          <Button variant="secondary" rightIcon={<LuX />} onClick={onReset}>
            {t`Reset`}
          </Button>
        )}
      </HStack>
      <Button
        variant="secondary"
        leftIcon={<LuDownload />}
        onClick={onDownload}
      >
        {t`Download`}
      </Button>
    </div>
  );
};

export default PurchasesControlBar;
