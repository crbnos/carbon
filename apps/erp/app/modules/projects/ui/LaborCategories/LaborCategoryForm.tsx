// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPencil, LuPlus } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Boolean,
  DatePicker,
  Hidden,
  Input,
  Number as NumberField,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions,
  useUser
} from "~/hooks";
import { path } from "~/utils/path";
import {
  laborCategoryRateValidator,
  laborCategoryValidator,
  rdActivityRoles
} from "../../projects.models";
import type { LaborCategoryRate } from "../../types";
import { useRdActivityRoleLabels } from "../RdTax/useRdTaxLabels";

type LaborCategoryFormProps = {
  initialValues: z.infer<typeof laborCategoryValidator>;
  /** The category's cost rates, newest first. Only for an existing one. */
  rates?: LaborCategoryRate[];
  onClose: () => void;
};

type EditingRate = {
  id?: string;
  effectiveFrom: string;
  costRate?: number;
  billRate?: number;
};

/**
 * Creates or edits a labor category in a drawer. An existing category also
 * lists its effective-dated cost rates; a rate opens in a modal.
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
  const today = useCompanyToday();
  const formatMoney = useCurrencyFormatter({ rate: true });
  const { formatDate } = useDateFormatter();
  const [editingRate, setEditingRate] = useState<EditingRate | null>(null);

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
            <ValidatedForm
              validator={laborCategoryValidator}
              method="post"
              action={
                isEditing
                  ? path.to.laborCategory(initialValues.id!)
                  : path.to.newLaborCategory
              }
              defaultValues={initialValues}
              fetcher={fetcher}
              className="flex flex-col h-full"
            >
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
                <Hidden name="id" />
                <VStack spacing={4}>
                  <Input name="name" label={t`Name`} autoFocus={!isEditing} />
                  <TextArea name="description" label={t`Description`} />
                  <Select
                    name="rdActivityRole"
                    label={t`Research role`}
                    isOptional
                    helperText={t`Default role for time in this category`}
                    options={rdActivityRoles.map((value) => ({
                      value,
                      label: roleLabels[value]
                    }))}
                  />
                  <Boolean
                    name="active"
                    label={t`Active`}
                    description={t`Inactive categories cannot be picked for new time`}
                  />
                  {isEditing && (
                    <div className="flex w-full flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          <Trans>Rates</Trans>
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<LuPlus />}
                          isDisabled={!canSave}
                          onClick={() =>
                            setEditingRate({ effectiveFrom: today })
                          }
                        >
                          <Trans>Add Rate</Trans>
                        </Button>
                      </div>
                      {(rates ?? []).length === 0 ? (
                        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                          <Trans>
                            No rates yet. Time on this category cannot post to
                            an Expense or Contract project until it has one.
                          </Trans>
                        </p>
                      ) : (
                        <div className="w-full overflow-x-auto rounded-md border border-border">
                          <TableBase full>
                            <Thead>
                              <Tr>
                                <Th>
                                  <Trans>Effective From</Trans>
                                </Th>
                                <Th className="text-right">
                                  <Trans>Cost Rate</Trans>
                                </Th>
                                <Th className="text-right">
                                  <Trans>Bill Rate</Trans>
                                </Th>
                                <Th className="w-12">
                                  <span className="sr-only">
                                    <Trans>Actions</Trans>
                                  </span>
                                </Th>
                              </Tr>
                            </Thead>
                            <Tbody>
                              {(rates ?? []).map((rate) => (
                                <Tr key={rate.id}>
                                  <Td className="whitespace-nowrap tabular-nums">
                                    {formatDate(rate.effectiveFrom)}
                                  </Td>
                                  <Td className="text-right tabular-nums">
                                    {formatMoney.format(Number(rate.costRate))}
                                  </Td>
                                  <Td className="text-right tabular-nums">
                                    {rate.billRate === null ? (
                                      <span className="text-muted-foreground">
                                        —
                                      </span>
                                    ) : (
                                      formatMoney.format(Number(rate.billRate))
                                    )}
                                  </Td>
                                  <Td>
                                    <IconButton
                                      aria-label={t`Edit rate`}
                                      icon={<LuPencil />}
                                      variant="ghost"
                                      size="sm"
                                      isDisabled={!canSave}
                                      onClick={() =>
                                        setEditingRate({
                                          id: rate.id,
                                          effectiveFrom: rate.effectiveFrom,
                                          costRate: Number(rate.costRate),
                                          billRate:
                                            rate.billRate === null
                                              ? undefined
                                              : Number(rate.billRate)
                                        })
                                      }
                                    />
                                  </Td>
                                </Tr>
                              ))}
                            </Tbody>
                          </TableBase>
                        </div>
                      )}
                    </div>
                  )}
                </VStack>
              </ModalDrawerBody>
              <ModalDrawerFooter>
                <HStack>
                  <Submit isDisabled={!canSave}>
                    <Trans>Save</Trans>
                  </Submit>
                  <Button size="md" variant="solid" onClick={onClose}>
                    <Trans>Cancel</Trans>
                  </Button>
                </HStack>
              </ModalDrawerFooter>
            </ValidatedForm>
          </ModalDrawerContent>
        </ModalDrawer>
      </ModalDrawerProvider>

      {/* A sibling of the drawer, not inside its form: a nested form would
          submit both. */}
      {editingRate && initialValues.id && (
        <RateModal
          laborCategoryId={initialValues.id}
          initialValues={editingRate}
          onClose={() => setEditingRate(null)}
        />
      )}
    </>
  );
};

function RateModal({
  laborCategoryId,
  initialValues,
  onClose
}: {
  laborCategoryId: string;
  initialValues: EditingRate;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction({ onSuccess: onClose });
  const { company } = useUser();
  const currencyCode = company.baseCurrencyCode;
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={laborCategoryRateValidator}
          method="post"
          action={path.to.laborCategory(laborCategoryId)}
          fetcher={fetcher}
          defaultValues={{ ...initialValues, laborCategoryId }}
        >
          <ModalHeader>
            <ModalTitle>
              {initialValues.id ? t`Edit Rate` : t`New Rate`}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="rate" />
            <Hidden name="id" />
            <Hidden name="laborCategoryId" />
            <VStack spacing={4}>
              <DatePicker name="effectiveFrom" label={t`Effective From`} />
              <NumberField
                name="costRate"
                label={t`Cost Rate per Hour`}
                minValue={0}
                formatOptions={INPUT_FORMAT.rate(
                  currencyCode,
                  currencyDecimals
                )}
                step={INPUT_STEP.rate}
              />
              <NumberField
                name="billRate"
                label={t`Bill Rate per Hour`}
                helperText={t`The default price of an hour on a Time & Materials contract line`}
                minValue={0}
                formatOptions={INPUT_FORMAT.rate(
                  currencyCode,
                  currencyDecimals
                )}
                step={INPUT_STEP.rate}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

export default LaborCategoryForm;
