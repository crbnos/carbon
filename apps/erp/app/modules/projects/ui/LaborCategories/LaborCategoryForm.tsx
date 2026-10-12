// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  LabelWithHelp,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  EditableDate,
  EditableNumber,
  useStableEditableComponents
} from "~/components/Editable";
import {
  Boolean,
  Hidden,
  Input,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import Grid from "~/components/Grid";
import { useCellSave } from "~/components/Setup";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions,
  useUser
} from "~/hooks";
import { path } from "~/utils/path";
import { laborCategoryValidator, rdActivityRoles } from "../../projects.models";
import type { LaborCategoryRate } from "../../types";
import { useRdActivityRoleLabels } from "../RdTax/useRdTaxLabels";

const LABOR_CATEGORY_FORM = "labor-category-form";

type LaborCategoryFormProps = {
  initialValues: z.infer<typeof laborCategoryValidator>;
  /** The category's cost rates, newest first. Only for an existing one. */
  rates?: LaborCategoryRate[];
  onClose: () => void;
};

/**
 * Creates or edits a labor category in a drawer. An existing category also
 * edits its effective-dated rates in a grid.
 */
const LaborCategoryForm = ({
  initialValues,
  rates,
  onClose
}: LaborCategoryFormProps) => {
  const { t } = useLingui();
  const roleLabels = useRdActivityRoleLabels();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();

  const isEditing = initialValues.id !== undefined;
  const canSave = isEditing
    ? permissions.can("update", "projects")
    : permissions.can("create", "projects");

  return (
    <>
      <ModalDrawerProvider type="drawer">
        <ModalDrawer
          open
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
        >
          <ModalDrawerContent>
            {/* The form holds the category's fields only: the rates grid
                sits outside it, so Enter in a grid cell never submits the
                category. Save reaches the form through `formId`. */}
            <div className="flex h-full flex-col">
              <ModalDrawerHeader>
                <ModalDrawerTitle>
                  {isEditing ? (
                    <Trans>Edit Labor Category</Trans>
                  ) : (
                    <Trans>New Labor Category</Trans>
                  )}
                </ModalDrawerTitle>
              </ModalDrawerHeader>
              <ModalDrawerBody>
                <VStack spacing={8}>
                  <ValidatedForm
                    id={LABOR_CATEGORY_FORM}
                    validator={laborCategoryValidator}
                    method="post"
                    action={
                      isEditing
                        ? path.to.laborCategory(initialValues.id!)
                        : path.to.newLaborCategory
                    }
                    defaultValues={initialValues}
                    fetcher={fetcher}
                    className="w-full"
                  >
                    <Hidden name="id" />
                    <VStack spacing={4}>
                      <Input
                        name="name"
                        label={t`Name`}
                        autoFocus={!isEditing}
                      />
                      <TextArea name="description" label={t`Description`} />
                      <Select
                        name="rdActivityRole"
                        label={t`Research role`}
                        termId="research-role"
                        isOptional
                        helperText={t`Default role for time in this category`}
                        options={rdActivityRoles.map((value) => ({
                          value,
                          label: roleLabels[value]
                        }))}
                      />
                      <Boolean
                        bordered
                        name="active"
                        label={t`Active`}
                        description={t`Inactive categories cannot be picked for new time`}
                      />
                    </VStack>
                  </ValidatedForm>
                  {isEditing && initialValues.id && (
                    <LaborRatesGrid
                      laborCategoryId={initialValues.id}
                      rates={rates ?? []}
                      canEdit={canSave}
                    />
                  )}
                </VStack>
              </ModalDrawerBody>
              <ModalDrawerFooter>
                <HStack>
                  <Submit formId={LABOR_CATEGORY_FORM} isDisabled={!canSave}>
                    <Trans>Save</Trans>
                  </Submit>
                  <Button size="md" variant="solid" onClick={onClose}>
                    <Trans>Cancel</Trans>
                  </Button>
                </HStack>
              </ModalDrawerFooter>
            </div>
          </ModalDrawerContent>
        </ModalDrawer>
      </ModalDrawerProvider>
    </>
  );
};

type RateRow = {
  /** The rate's id; a draft row has none until it saves. */
  id: string | null;
  key: string;
  effectiveFrom: string;
  costRate: number | null;
  billRate: number | null;
};

/**
 * The category's effective-dated rates as a grid, newest first. A cell
 * saves the whole rate (`intent=rate`, quiet). "New" adds a draft row from
 * today, which saves once it has a cost rate. Rates have no delete.
 */
function LaborRatesGrid({
  laborCategoryId,
  rates,
  canEdit
}: {
  laborCategoryId: string;
  rates: LaborCategoryRate[];
  canEdit: boolean;
}) {
  const { t } = useLingui();
  const today = useCompanyToday();
  const save = useCellSave();
  const formatRate = useCurrencyFormatter({ rate: true });
  const { formatDate } = useDateFormatter();
  const { company } = useUser();
  const currencyCode = company.baseCurrencyCode;
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const [drafts, setDrafts] = useState<RateRow[]>([]);
  const draftCount = useRef(0);
  const action = path.to.laborCategory(laborCategoryId);

  const rows = useMemo<RateRow[]>(
    () => [
      ...rates.map((rate) => ({
        id: rate.id,
        key: rate.id,
        effectiveFrom: rate.effectiveFrom,
        costRate: Number(rate.costRate),
        billRate: rate.billRate === null ? null : Number(rate.billRate)
      })),
      ...drafts
    ],
    [rates, drafts]
  );

  // A cell posts the whole rate with the change. A draft keeps the change
  // until it has a cost rate; then it saves and leaves the drafts.
  const onCellEdit = useCallback(
    async (key: string, value: unknown, row: RateRow) => {
      const next: RateRow = { ...row };
      if (key === "effectiveFrom") next.effectiveFrom = String(value ?? "");
      if (key === "costRate" || key === "billRate") {
        next[key] =
          value === null || value === undefined || value === ""
            ? null
            : Number(value);
      }
      if (next.id === null && (next.costRate === null || !next.effectiveFrom)) {
        setDrafts((previous) =>
          previous.map((draft) => (draft.key === row.key ? next : draft))
        );
        return { data: null, error: null } as Awaited<ReturnType<typeof save>>;
      }
      const result = await save(action, {
        intent: "rate",
        id: next.id ?? "",
        laborCategoryId,
        effectiveFrom: next.effectiveFrom,
        costRate: next.costRate === null ? "" : String(next.costRate),
        billRate: next.billRate === null ? "" : String(next.billRate)
      });
      if (next.id === null && !result.error) {
        setDrafts((previous) => previous.filter((d) => d.key !== row.key));
      }
      return result;
    },
    [action, laborCategoryId, save]
  );

  const editableComponents = useStableEditableComponents(
    (latest) => {
      const edit = (key: string, value: unknown, row: RateRow) =>
        latest.current.onCellEdit(key, value, row);
      const rate = {
        minValue: 0,
        formatOptions: INPUT_FORMAT.rate(currencyCode, currencyDecimals),
        step: INPUT_STEP.rate
      };
      return {
        effectiveFrom: EditableDate<RateRow>(edit, {
          label: t`Effective From`
        }),
        costRate: EditableNumber<RateRow>(edit, rate, {
          inputClassName: "text-right"
        }),
        billRate: EditableNumber<RateRow>(edit, rate, {
          clearable: true,
          inputClassName: "text-right"
        })
      };
    },
    { onCellEdit }
  );

  const columns = useMemo<ColumnDef<RateRow>[]>(
    () => [
      {
        accessorKey: "effectiveFrom",
        header: t`Effective From`,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatDate(row.original.effectiveFrom)}
          </span>
        )
      },
      {
        accessorKey: "costRate",
        header: t`Cost Rate`,
        cell: ({ row }) =>
          row.original.costRate === null ? (
            <span className="text-muted-foreground">
              <Trans>Enter a rate</Trans>
            </span>
          ) : (
            <span className="block text-right tabular-nums">
              {formatRate.format(row.original.costRate)}
            </span>
          )
      },
      {
        accessorKey: "billRate",
        header: () => (
          <LabelWithHelp termId="bill-rate" variant="inline">
            <Trans>Bill Rate</Trans>
          </LabelWithHelp>
        ),
        cell: ({ row }) =>
          row.original.billRate === null ? (
            <span className="block text-right text-muted-foreground">—</span>
          ) : (
            <span className="block text-right tabular-nums">
              {formatRate.format(row.original.billRate)}
            </span>
          )
      }
    ],
    [t, formatDate, formatRate]
  );

  return (
    <div className="flex w-full flex-col gap-2">
      <span className="text-sm font-medium">
        <Trans>Rates</Trans>
      </span>
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Time on this category cannot post to an Expense or Contract project
            until it has a rate.
          </Trans>
        </p>
      )}
      <Grid<RateRow>
        data={rows}
        columns={columns}
        canEdit={canEdit}
        editableComponents={editableComponents}
        withSimpleSorting={false}
        onNewRow={
          canEdit
            ? () => {
                draftCount.current += 1;
                setDrafts((previous) => [
                  ...previous,
                  {
                    id: null,
                    key: `draft-${draftCount.current}`,
                    effectiveFrom: today,
                    costRate: null,
                    billRate: null
                  }
                ]);
              }
            : undefined
        }
      />
    </div>
  );
}

export default LaborCategoryForm;
