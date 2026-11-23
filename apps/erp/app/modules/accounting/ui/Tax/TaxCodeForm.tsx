// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  IconButton,
  LabelWithHelp,
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
import { LuChevronRight, LuPlus, LuTrash } from "react-icons/lu";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import {
  Account,
  Boolean,
  CreatableCombobox,
  DatePicker,
  Hidden,
  Input,
  InputControlled,
  NumberControlled,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import Country from "~/components/Form/Country";
import {
  useCompanyToday,
  useDrawerItem,
  usePercentFormatter,
  usePermissions
} from "~/hooks";
import { path } from "~/utils/path";
import {
  taxCalculationTypes,
  taxCodeValidator,
  taxReportingCategories
} from "../../accounting.models";
import type { AccountClass } from "../../types";
import TaxAuthorityForm from "./TaxAuthorityForm";

type TaxCodeFormValues = z.infer<typeof taxCodeValidator>;

type TaxCodeFormProps = {
  initialValues: TaxCodeFormValues;
  taxAuthorities: { id: string; name: string }[];
  open?: boolean;
  onClose: () => void;
};

/**
 * A component row. Every field a row shows is held here, not read from the
 * form by name: removing a row renumbers the rows after it, and a field read
 * by name would then show the removed row's value.
 */
type ComponentRow = {
  key: string;
  id?: string;
  name: string;
  taxAuthorityId: string;
  taxPercent: number;
  recoverablePercent: number;
  isCompound: boolean;
  taxReceivedAccountId: string;
  taxPaidAccountId: string;
  effectiveDate?: string;
  expirationDate?: string;
  showMore: boolean;
};

const TAX_RECEIVED_CLASSES: AccountClass[] = ["Liability"];
const TAX_PAID_CLASSES: AccountClass[] = ["Asset"];

const TaxCodeForm = ({
  initialValues,
  taxAuthorities,
  open = true,
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

  // The authority typed into a row's Authority picker, being created.
  const createAuthority = useDrawerItem<{ rowKey: string; name: string }>();

  const nextKey = useRef(0);
  const newRow = (): ComponentRow => ({
    key: `new-${nextKey.current++}`,
    name: "",
    taxAuthorityId: "",
    taxPercent: 0,
    recoverablePercent: 0,
    isCompound: false,
    taxReceivedAccountId: "",
    taxPaidAccountId: "",
    showMore: false
  });

  const [rows, setRows] = useState<ComponentRow[]>(() =>
    initialValues.components.length > 0
      ? initialValues.components.map((c, index) => ({
          key: c.id ?? `initial-${index}`,
          id: c.id,
          name: c.name,
          taxAuthorityId: c.taxAuthorityId ?? "",
          taxPercent: c.taxPercent,
          recoverablePercent: c.recoverablePercent,
          isCompound: c.isCompound,
          taxReceivedAccountId: c.taxReceivedAccountId ?? "",
          taxPaidAccountId: c.taxPaidAccountId ?? "",
          effectiveDate: c.effectiveDate,
          expirationDate: c.expirationDate,
          // Open the extra fields when any of them is already set.
          showMore:
            c.recoverablePercent > 0 ||
            c.isCompound ||
            !!c.taxReceivedAccountId ||
            !!c.taxPaidAccountId ||
            !!c.effectiveDate ||
            !!c.expirationDate
        }))
      : [newRow()]
  );

  // A Reverse Charge line is charged no tax; its rate is self-assessed.
  const [isReverseCharge, setIsReverseCharge] = useState(
    initialValues.calculationType === "Reverse Charge"
  );

  const updateRow = (index: number, patch: Partial<ComponentRow>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  const addRow = () => setRows((current) => [...current, newRow()]);
  const removeRow = (index: number) =>
    setRows((current) => current.filter((_, i) => i !== index));

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
    label: <Enumerable value={v} />
  }));
  const reportingCategoryOptions = taxReportingCategories.map((v) => ({
    value: v,
    label: <Enumerable value={v} />
  }));
  const authorityOptions = useMemo(
    () => taxAuthorities.map((a) => ({ value: a.id, label: a.name })),
    [taxAuthorities]
  );

  return (
    <Drawer
      open={open}
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
                  termId="tax-calculation-type"
                  options={calculationTypeOptions}
                  onChange={(option) =>
                    setIsReverseCharge(option?.value === "Reverse Charge")
                  }
                />
                <Select
                  name="reportingCategory"
                  label={t`Reporting Category`}
                  termId="tax-reporting-category"
                  options={reportingCategoryOptions}
                />
                <Country
                  name="countryCode"
                  termId="tax-code-region"
                  isOptional
                />
                <Input name="state" label={t`State`} termId="tax-code-region" />
              </div>
              <TextArea
                name="invoiceMessage"
                label={t`Invoice Message`}
                termId="tax-invoice-message"
              />
              <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
                <Boolean
                  name="taxesShipping"
                  label={t`Taxes Shipping`}
                  termId="taxes-shipping"
                  bordered
                />
                <Boolean name="active" label={t`Active`} bordered />
              </div>

              <div className="flex w-full flex-col gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  <LabelWithHelp termId="tax-component">
                    <Trans>Components</Trans>
                  </LabelWithHelp>
                </span>
                <div className="@container w-full rounded-lg border border-border divide-y divide-border">
                  {rows.map((row, index) => (
                    <div key={row.key} className="p-4">
                      {row.id && (
                        <Hidden
                          name={`components[${index}].id`}
                          value={row.id}
                        />
                      )}
                      <Hidden
                        name={`components[${index}].sequence`}
                        value={index + 1}
                      />
                      <div className="flex flex-col gap-3">
                        <div className="flex items-end gap-2">
                          <div className="grid flex-1 min-w-0 gap-4 grid-cols-1 @xl:grid-cols-[2fr_2fr_1fr]">
                            <InputControlled
                              name={`components[${index}].name`}
                              label={t`Name`}
                              value={row.name}
                              onChange={(name) => updateRow(index, { name })}
                            />
                            <CreatableCombobox
                              name={`components[${index}].taxAuthorityId`}
                              label={t`Authority`}
                              termId="tax-authority"
                              options={authorityOptions}
                              value={row.taxAuthorityId}
                              onChange={(option) =>
                                updateRow(index, {
                                  taxAuthorityId: option?.value ?? ""
                                })
                              }
                              onCreateOption={(name) =>
                                createAuthority.open({ rowKey: row.key, name })
                              }
                              isOptional
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
                          </div>
                          {rows.length > 1 && (
                            <IconButton
                              aria-label={t`Remove component`}
                              icon={<LuTrash />}
                              variant="ghost"
                              className="shrink-0 mb-1 text-muted-foreground hover:text-foreground"
                              onClick={() => removeRow(index)}
                            />
                          )}
                        </div>
                        <Collapsible
                          open={row.showMore}
                          onOpenChange={(showMore) =>
                            updateRow(index, { showMore })
                          }
                        >
                          <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                            <LuChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                            <Trans>More options</Trans>
                          </CollapsibleTrigger>
                          {/* Kept mounted while closed so its fields still submit. */}
                          <CollapsibleContent
                            forceMount
                            className="data-[state=closed]:hidden"
                          >
                            <div className="grid w-full gap-4 pt-3 grid-cols-1 @xl:grid-cols-3">
                              <NumberControlled
                                name={`components[${index}].recoverablePercent`}
                                label={t`Recoverable`}
                                termId="recoverable-percent"
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
                                termId="tax-component-effective-date"
                                value={row.effectiveDate ?? ""}
                                onChange={(effectiveDate) =>
                                  updateRow(index, {
                                    effectiveDate: effectiveDate ?? undefined
                                  })
                                }
                              />
                              <DatePicker
                                name={`components[${index}].expirationDate`}
                                label={t`Expires`}
                                termId="tax-component-expiration-date"
                                value={row.expirationDate ?? ""}
                                onChange={(expirationDate) =>
                                  updateRow(index, {
                                    expirationDate: expirationDate ?? undefined
                                  })
                                }
                              />
                              <Account
                                name={`components[${index}].taxReceivedAccountId`}
                                label={t`Tax Received Account`}
                                termId="tax-component-received-account"
                                classes={TAX_RECEIVED_CLASSES}
                                value={row.taxReceivedAccountId}
                                onChange={(option) =>
                                  updateRow(index, {
                                    taxReceivedAccountId: option?.value ?? ""
                                  })
                                }
                                isOptional
                              />
                              <Account
                                name={`components[${index}].taxPaidAccountId`}
                                label={t`Tax Paid Account`}
                                termId="tax-component-paid-account"
                                classes={TAX_PAID_CLASSES}
                                value={row.taxPaidAccountId}
                                onChange={(option) =>
                                  updateRow(index, {
                                    taxPaidAccountId: option?.value ?? ""
                                  })
                                }
                                isOptional
                              />
                              <Boolean
                                name={`components[${index}].isCompound`}
                                label={t`Compound`}
                                termId="compound-tax"
                                value={row.isCompound}
                                onChange={(isCompound) =>
                                  updateRow(index, { isCompound })
                                }
                              />
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    </div>
                  ))}
                  <div className="px-2 py-2">
                    <Button
                      variant="ghost"
                      leftIcon={<LuPlus />}
                      onClick={addRow}
                    >
                      <Trans>Add component</Trans>
                    </Button>
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {isReverseCharge ? (
                  <Trans>
                    Self-assessed rate today:{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {percentFormatter.format(effectiveRate)}
                    </span>
                    . Lines using this code are charged no tax.
                  </Trans>
                ) : (
                  <Trans>
                    Effective rate today:{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {percentFormatter.format(effectiveRate)}
                    </span>
                  </Trans>
                )}
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
      {createAuthority.item !== null && (
        <TaxAuthorityForm
          key={createAuthority.key}
          type="modal"
          open={createAuthority.isOpen}
          initialValues={{ name: createAuthority.item.name, supplierId: "" }}
          onCreated={(taxAuthorityId) => {
            const rowKey = createAuthority.item?.rowKey;
            setRows((current) =>
              current.map((row) =>
                row.key === rowKey ? { ...row, taxAuthorityId } : row
              )
            );
          }}
          onClose={createAuthority.close}
        />
      )}
    </Drawer>
  );
};

export default TaxCodeForm;
