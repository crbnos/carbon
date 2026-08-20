import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  IconButton,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Boolean,
  CustomerLocation,
  Hidden,
  Input,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  ediReleaseModeType,
  ediTradingPartnerLocationValidator,
  ediTradingPartnerValidator
} from "../../sales.models";

// Stable format options — react number fields re-parse on every render, so this
// must not be re-created inline (see lessons on react number fields).
const priceToleranceFormatOptions: Intl.NumberFormatOptions = {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
};

// The four Phase-1 documents. `key` is the "<documentType>:<direction>" string
// posted in the `documents` checkbox group and parsed back in the route action.
export const ediDocumentDefinitions = [
  {
    key: "Purchase Order:Inbound",
    documentType: "Purchase Order",
    direction: "Inbound",
    label: "Purchase Order (850)",
    description: "Inbound customer orders staged for release"
  },
  {
    key: "Purchase Order Acknowledgment:Outbound",
    documentType: "Purchase Order Acknowledgment",
    direction: "Outbound",
    label: "Order Acknowledgment (855)",
    description: "Outbound acknowledgment of received orders"
  },
  {
    key: "Advance Ship Notice:Outbound",
    documentType: "Advance Ship Notice",
    direction: "Outbound",
    label: "Advance Ship Notice (856)",
    description: "Outbound shipment notifications"
  },
  {
    key: "Invoice:Outbound",
    documentType: "Invoice",
    direction: "Outbound",
    label: "Invoice (810)",
    description: "Outbound invoices"
  }
] as const;

type LocationMapping = {
  id: string;
  externalCode: string;
  customerLocationId: string;
};

type CustomerEdiFormProps = {
  customerId: string;
  initialValues: z.infer<typeof ediTradingPartnerValidator>;
  locations: LocationMapping[];
  customerLocations: { id: string; name: string }[];
};

const CustomerEdiForm = ({
  customerId,
  initialValues,
  locations,
  customerLocations
}: CustomerEdiFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const deleteFetcher = useFetcher<{}>();
  const addLocationFetcher = useFetcher<{}>();

  const isDisabled = !permissions.can("update", "sales");
  const partnerExists = !!initialValues.id;

  const [enabledDocuments, setEnabledDocuments] = useState<string[]>(
    initialValues.documents ?? []
  );

  const toggleDocument = (key: string, checked: boolean) => {
    setEnabledDocuments((prev) =>
      checked ? [...new Set([...prev, key])] : prev.filter((k) => k !== key)
    );
  };

  const releaseModeOptions = ediReleaseModeType.map((mode) => ({
    label: mode,
    value: mode
  }));

  const locationNameById = new Map(
    customerLocations.map((location) => [location.id, location.name])
  );

  return (
    <VStack spacing={4} className="w-full">
      <ValidatedForm
        method="post"
        validator={ediTradingPartnerValidator}
        defaultValues={initialValues}
      >
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>EDI</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Configure electronic data interchange with this trading partner
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Hidden name="intent" value="partner" />
            <Hidden name="id" />
            <Hidden name="customerId" />
            <VStack spacing={4}>
              <Boolean
                name="active"
                label={t`Active`}
                description={t`Exchange documents with this trading partner`}
              />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
                <Input name="externalId" label={t`Provider Partner ID`} />
                <Select
                  name="releaseMode"
                  label={t`Release Mode`}
                  options={releaseModeOptions}
                />
                <Number
                  name="priceTolerancePercent"
                  label={t`Price Tolerance`}
                  minValue={0}
                  maxValue={1}
                  step={0.01}
                  formatOptions={priceToleranceFormatOptions}
                />
              </div>

              <VStack spacing={2} className="w-full">
                <p className="text-sm font-medium text-muted-foreground">
                  {t`Documents`}
                </p>
                <div className="flex flex-col w-full border rounded-lg divide-y">
                  {ediDocumentDefinitions.map((doc) => {
                    const checked = enabledDocuments.includes(doc.key);
                    return (
                      <label
                        key={doc.key}
                        className="flex items-center gap-3 p-3 cursor-pointer"
                      >
                        <Checkbox
                          isChecked={checked}
                          onCheckedChange={(value) =>
                            toggleDocument(doc.key, value === true)
                          }
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {doc.label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {doc.description}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {enabledDocuments.map((key, index) => (
                  <input
                    key={key}
                    type="hidden"
                    name={`documents[${index}]`}
                    value={key}
                  />
                ))}
              </VStack>
            </VStack>
          </CardContent>
          <CardFooter>
            <Submit isDisabled={isDisabled}>
              <Trans>Save</Trans>
            </Submit>
          </CardFooter>
        </Card>
      </ValidatedForm>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Location Mapping</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Map partner ship-to codes to customer locations</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!partnerExists ? (
            <div className="my-8 text-center w-full">
              <p className="text-muted-foreground text-sm">
                <Trans>Save EDI settings before mapping locations</Trans>
              </p>
            </div>
          ) : (
            <VStack spacing={4} className="w-full">
              {locations.length > 0 && (
                <div className="flex flex-col w-full border rounded-lg divide-y">
                  {locations.map((location) => (
                    <div
                      key={location.id}
                      className="flex items-center justify-between gap-4 p-3"
                    >
                      <span className="text-sm font-mono">
                        {location.externalCode}
                      </span>
                      <span className="text-sm text-muted-foreground flex-1 truncate">
                        {locationNameById.get(location.customerLocationId) ??
                          location.customerLocationId}
                      </span>
                      <deleteFetcher.Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="deleteLocation"
                        />
                        <input type="hidden" name="id" value={location.id} />
                        <IconButton
                          type="submit"
                          aria-label={t`Delete location mapping`}
                          variant="ghost"
                          icon={<LuTrash />}
                          isDisabled={!permissions.can("delete", "sales")}
                        />
                      </deleteFetcher.Form>
                    </div>
                  ))}
                </div>
              )}
              <ValidatedForm
                method="post"
                fetcher={addLocationFetcher}
                validator={ediTradingPartnerLocationValidator}
                resetAfterSubmit
                defaultValues={{ externalCode: "", customerLocationId: "" }}
                className="w-full"
              >
                <Hidden name="intent" value="location" />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-4 gap-y-4 items-end w-full">
                  <Input name="externalCode" label={t`Partner Code`} />
                  <CustomerLocation
                    name="customerLocationId"
                    label={t`Customer Location`}
                    customer={customerId}
                  />
                  <Submit isDisabled={isDisabled}>
                    <Trans>Add Mapping</Trans>
                  </Submit>
                </div>
              </ValidatedForm>
            </VStack>
          )}
        </CardContent>
      </Card>
    </VStack>
  );
};

export default CustomerEdiForm;
