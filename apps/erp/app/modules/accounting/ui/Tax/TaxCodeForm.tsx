// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Table,
  Tbody,
  Td,
  Tr,
  VStack
} from "@carbon/react";
import {
  effectiveComponents,
  effectiveTaxPercent,
  INPUT_FORMAT,
  INPUT_STEP,
  type TaxComponentInput
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import type { z } from "zod";
import {
  Account,
  Boolean,
  Combobox,
  DatePicker,
  Hidden,
  Input,
  NumberControlled,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import Country from "~/components/Form/Country";
import { useCompanyToday, usePercentFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  taxCalculationTypes,
  taxCodeValidator,
  taxReportingCategories
} from "../../accounting.models";
import type { AccountClass } from "../../types";

type TaxCodeFormValues = z.infer<typeof taxCodeValidator>;

type TaxCodeFormProps = {
  initialValues: TaxCodeFormValues;
  taxAuthorities: { id: string; name: string }[];
  onClose: () => void;
};

/** The fields of a component row that decide the code's effective rate. */
type ComponentRow = {
  key: string;
  taxPercent: number;
  recoverablePercent: number;
  isCompound: boolean;
  effectiveDate?: string;
  expirationDate?: string;
};

const TAX_RECEIVED_CLASSES: AccountClass[] = ["Liability"];
const TAX_PAID_CLASSES: AccountClass[] = ["Asset"];

const TaxCodeForm = ({
  initialValues,
  taxAuthorities,
  onClose
}: TaxCodeFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const today = useCompanyToday();
  const percentFormatter = usePercentFormatter();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const nextKey = useRef(0);
  const newRow = (): ComponentRow => ({
    key: `new-${nextKey.current++}`,
    taxPercent: 0,
    recoverablePercent: 0,
    isCompound: false
  });

  const [rows, setRows] = useState<ComponentRow[]>(() =>
    initialValues.components.length > 0
      ? initialValues.components.map((c, index) => ({
          key: c.id ?? `initial-${index}`,
          taxPercent: c.taxPercent,
          recoverablePercent: c.recoverablePercent,
          isCompound: c.isCompound,
          effectiveDate: c.effectiveDate,
          expirationDate: c.expirationDate
        }))
      : [newRow()]
  );

  const updateRow = (index: number, patch: Partial<ComponentRow>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  const addRow = () => setRows((current) => [...current, newRow()]);
  const removeRow = () => setRows((current) => current.slice(0, -1));

  const effectiveRate = useMemo(() => {
    const components: TaxComponentInput[] = rows.map((row, index) => ({
      id: row.key,
      name: "",
      taxAuthorityId: null,
      taxPercent: Number.isFinite(row.taxPercent) ? row.taxPercent : 0,
      recoverablePercent: Number.isFinite(row.recoverablePercent)
        ? row.recoverablePercent
        : 0,
      sequence: index + 1,
      isCompound: row.isCompound,
      taxReceivedAccountId: null,
      taxPaidAccountId: null,
      effectiveDate: row.effectiveDate || null,
      expirationDate: row.expirationDate || null
    }));
    return effectiveTaxPercent(effectiveComponents({ components }, today));
  }, [rows, today]);

  const calculationTypeOptions = taxCalculationTypes.map((v) => ({
    value: v,
    label: v
  }));
  const reportingCategoryOptions = taxReportingCategories.map((v) => ({
    value: v,
    label: v
  }));
  const authorityOptions = useMemo(
    () => taxAuthorities.map((a) => ({ value: a.id, label: a.name })),
    [taxAuthorities]
  );

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="xl">
        <ValidatedForm
          validator={taxCodeValidator}
          method="post"
          action={
            isEditing ? path.to.taxCode(initialValues.id!) : path.to.newTaxCode
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? (
                <Trans>Edit Tax Code</Trans>
              ) : (
                <Trans>New Tax Code</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
                <Input name="name" label={t`Name`} />
                <Input name="description" label={t`Description`} />
                <Select
                  name="calculationType"
                  label={t`Calculation Type`}
                  options={calculationTypeOptions}
                />
                <Select
                  name="reportingCategory"
                  label={t`Reporting Category`}
                  options={reportingCategoryOptions}
                />
                <Country name="countryCode" isOptional />
                <Input name="state" label={t`State`} />
              </div>
              <TextArea name="invoiceMessage" label={t`Invoice Message`} />
              <Boolean
                name="taxesShipping"
                label={t`Taxes Shipping`}
                bordered
              />
              <Boolean name="active" label={t`Active`} bordered />

              <span className="text-xs font-medium text-muted-foreground">
                <Trans>Components</Trans>
              </span>
              <Card className="flex-grow px-0">
                <Table>
                  <Tbody>
                    {rows.map((row, index) => {
                      const id = initialValues.components.find(
                        (c) => c.id === row.key
                      )?.id;
                      return (
                        <Tr key={row.key}>
                          <Td>
                            {id && <Hidden name={`components[${index}].id`} />}
                            <Hidden
                              name={`components[${index}].sequence`}
                              value={index + 1}
                            />
                            <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-3">
                              <Input
                                name={`components[${index}].name`}
                                label={t`Name`}
                              />
                              <Combobox
                                name={`components[${index}].taxAuthorityId`}
                                label={t`Authority`}
                                options={authorityOptions}
                                isOptional
                              />
                              <Boolean
                                name={`components[${index}].isCompound`}
                                label={t`Compound`}
                                value={row.isCompound}
                                onChange={(isCompound) =>
                                  updateRow(index, { isCompound })
                                }
                              />
                              <NumberControlled
                                name={`components[${index}].taxPercent`}
                                label={t`Rate`}
                                value={row.taxPercent}
                                minValue={0}
                                maxValue={1}
                                step={INPUT_STEP.percent}
                                formatOptions={INPUT_FORMAT.percent}
                                onChange={(taxPercent) =>
                                  updateRow(index, { taxPercent })
                                }
                              />
                              <NumberControlled
                                name={`components[${index}].recoverablePercent`}
                                label={t`Recoverable`}
                                value={row.recoverablePercent}
                                minValue={0}
                                maxValue={1}
                                step={INPUT_STEP.percent}
                                formatOptions={INPUT_FORMAT.percent}
                                onChange={(recoverablePercent) =>
                                  updateRow(index, { recoverablePercent })
                                }
                              />
                              <DatePicker
                                name={`components[${index}].effectiveDate`}
                                label={t`Effective`}
                                onChange={(effectiveDate) =>
                                  updateRow(index, {
                                    effectiveDate: effectiveDate ?? undefined
                                  })
                                }
                              />
                              <Account
                                name={`components[${index}].taxReceivedAccountId`}
                                label={t`Tax Received Account`}
                                classes={TAX_RECEIVED_CLASSES}
                                isOptional
                              />
                              <Account
                                name={`components[${index}].taxPaidAccountId`}
                                label={t`Tax Paid Account`}
                                classes={TAX_PAID_CLASSES}
                                isOptional
                              />
                              <DatePicker
                                name={`components[${index}].expirationDate`}
                                label={t`Expires`}
                                onChange={(expirationDate) =>
                                  updateRow(index, {
                                    expirationDate: expirationDate ?? undefined
                                  })
                                }
                              />
                            </div>
                          </Td>
                        </Tr>
                      );
                    })}
                    <Tr>
                      <Td className="text-right">
                        <Button onClick={addRow} className="mr-2">
                          <Trans>Add</Trans>
                        </Button>
                        {rows.length > 1 ? (
                          <Button onClick={removeRow} variant="destructive">
                            <Trans>Remove</Trans>
                          </Button>
                        ) : null}
                      </Td>
                    </Tr>
                  </Tbody>
                </Table>
              </Card>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Effective rate today:{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {percentFormatter.format(effectiveRate)}
                  </span>
                </Trans>
              </p>
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default TaxCodeForm;
