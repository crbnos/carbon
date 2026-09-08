import { getDocumentLabel } from "@carbon/documents/template";
import {
  Boolean as BooleanField,
  DatePicker,
  MultiSelect,
  Select,
  ValidatedForm
} from "@carbon/form";
import { HStack, Subheading, VStack } from "@carbon/react";
import { COUNTRY_MAP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { Customers, Suppliers } from "~/components/Form";
import { useCountries } from "~/components/Form/Country";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { TermsVersionScope } from "../../settings.models";
import { termsDocumentTypes, termsVersionScopes } from "../../settings.models";
import type { TermsVersion } from "../../types";

/**
 * Per-field autosave for everything about a terms version except its body,
 * which the editor saves itself. Each control submits one field to
 * `terms-version/update`; scope submits its columns as a set because the
 * country list and the region are mutually exclusive.
 */
const TermsVersionProperties = () => {
  const { id } = useParams();
  const { t } = useLingui();
  if (!id) throw new Error("id not found");

  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "settings");
  const fetcher = useFetcher();

  const routeData = useRouteData<{ termsVersion: TermsVersion }>(
    path.to.termsVersion(id)
  );
  const termsVersion = routeData?.termsVersion;

  const [scope, setScope] = useState<TermsVersionScope>(
    termsVersion?.customerIds?.length || termsVersion?.supplierIds?.length
      ? "party"
      : termsVersion?.countryCodes?.length
        ? "country"
        : "global"
  );
  const [customerIds, setCustomerIds] = useState<string[]>(
    termsVersion?.customerIds ?? []
  );
  const [supplierIds, setSupplierIds] = useState<string[]>(
    termsVersion?.supplierIds ?? []
  );
  const [countryCodes, setCountryCodes] = useState<string[]>(
    termsVersion?.countryCodes ?? []
  );

  const submit = (field: string, entries: [string, string][]) => {
    const formData = new FormData();
    formData.append("id", id);
    formData.append("field", field);
    for (const [key, value] of entries) formData.append(key, value);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateTermsVersion
    });
  };

  const submitScope = (next: {
    scope: TermsVersionScope;
    customerIds?: string[];
    supplierIds?: string[];
    countryCodes?: string[];
  }) => {
    const entries: [string, string][] = [["value", next.scope]];
    if (next.scope === "party") {
      for (const id of next.customerIds ?? customerIds)
        entries.push(["customerIds", id]);
      for (const id of next.supplierIds ?? supplierIds)
        entries.push(["supplierIds", id]);
    }
    if (next.scope === "country")
      for (const code of next.countryCodes ?? countryCodes)
        entries.push(["countryCodes", code]);
    submit("scope", entries);
  };

  // Purchase orders go to suppliers; the rest go to customers. Offer only the
  // side(s) the selected documents actually have a counterparty on.
  const documentTypes = termsVersion?.documentTypes ?? [];
  const hasPurchasing = documentTypes.includes("purchaseOrder");
  const hasSales = documentTypes.some((type) => type !== "purchaseOrder");

  const documentTypeOptions = termsDocumentTypes.map((type) => ({
    value: type,
    label: getDocumentLabel(type)
  }));

  const scopeOptions = [
    { value: "global", label: t`Global` },
    { value: "party", label: t`Specific customers or suppliers` },
    { value: "country", label: t`Countries` }
  ];

  // Already { value: alpha2, label: name } options.
  const countryOptions = useCountries();

  if (!termsVersion) return null;

  return (
    <VStack
      spacing={4}
      className="w-[450px] bg-background/30 h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <Subheading as="h3" variant="light">
            <Trans>Properties</Trans>
          </Subheading>
        </HStack>

        <ValidatedForm
          defaultValues={{
            documentTypes: termsVersion.documentTypes,
            scope,
            customerIds,
            supplierIds,
            countryCodes,
            effectiveFrom: termsVersion.effectiveFrom ?? "",
            effectiveTo: termsVersion.effectiveTo ?? "",
            active: termsVersion.active ?? true
          }}
          validator={z.object({
            documentTypes: z.array(z.enum(termsDocumentTypes)),
            scope: z.enum(termsVersionScopes),
            customerIds: z.array(z.string()).optional(),
            supplierIds: z.array(z.string()).optional(),
            countryCodes: z.array(z.string()).optional(),
            effectiveFrom: z.string().optional(),
            effectiveTo: z.string().optional(),
            active: z.boolean().optional()
          })}
          className="w-full"
        >
          <VStack spacing={4}>
            <MultiSelect
              name="documentTypes"
              label={t`Documents`}
              options={documentTypeOptions}
              isReadOnly={!canUpdate}
              onChange={(options) => {
                const next = options
                  .map((option) => option.value)
                  .filter((value) =>
                    termsDocumentTypes.some((type) => type === value)
                  );
                if (next.length > 0)
                  submit(
                    "documentTypes",
                    next.map(
                      (value) => ["documentTypes", value] as [string, string]
                    )
                  );
              }}
              helperText={t`The documents this version prints on.`}
            />

            <Select
              name="scope"
              label={t`Applies To`}
              options={scopeOptions}
              isReadOnly={!canUpdate}
              onChange={(option) => {
                const next = termsVersionScopes.find(
                  (s) => s === option?.value
                );
                if (!next) return;
                setScope(next);
                submitScope({ scope: next });
              }}
            />

            {scope === "party" && hasSales && (
              <Customers
                name="customerIds"
                label={t`Customers`}
                isReadOnly={!canUpdate}
                onChange={(next) => {
                  setCustomerIds(next);
                  submitScope({ scope: "party", customerIds: next });
                }}
              />
            )}

            {scope === "party" && hasPurchasing && (
              <Suppliers
                name="supplierIds"
                label={t`Suppliers`}
                isReadOnly={!canUpdate}
                onChange={(next) => {
                  setSupplierIds(next);
                  submitScope({ scope: "party", supplierIds: next });
                }}
              />
            )}

            {scope === "country" && (
              <MultiSelect
                name="countryCodes"
                label={t`Countries`}
                options={countryOptions}
                isReadOnly={!canUpdate}
                onChange={(options) => {
                  const next = options.map((option) => option.value);
                  setCountryCodes(next);
                  submitScope({ scope: "country", countryCodes: next });
                }}
              />
            )}

            <DatePicker
              name="effectiveFrom"
              label={t`Effective From`}
              isDisabled={!canUpdate}
              onChange={(value) =>
                submit("effectiveFrom", [["value", value?.toString() ?? ""]])
              }
            />

            <DatePicker
              name="effectiveTo"
              label={t`Effective To`}
              isDisabled={!canUpdate}
              onChange={(value) =>
                submit("effectiveTo", [["value", value?.toString() ?? ""]])
              }
            />

            <BooleanField
              name="active"
              label={t`Active`}
              isDisabled={!canUpdate}
              onChange={(value) =>
                submit("active", [["value", value ? "true" : "false"]])
              }
            />

            {scope === "country" && countryCodes.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {countryCodes
                  .map((code) => COUNTRY_MAP[code]?.name ?? code)
                  .join(", ")}
              </p>
            )}
          </VStack>
        </ValidatedForm>
      </VStack>
    </VStack>
  );
};

export default TermsVersionProperties;
