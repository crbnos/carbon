import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  Boolean,
  Customer,
  CustomFormFields,
  DatePicker,
  Hidden,
  Item,
  Number,
  Submit,
  Supplier,
  WarrantyTerm
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { warrantyRegistrationValidator } from "../../sales.models";

type WarrantyRegistrationFormProps = {
  registration: {
    id: string | null;
    warrantyRegistrationId: string | null;
    itemId: string | null;
    customerId: string | null;
    trackedEntityId: string | null;
    serialNumber: string | null;
    quantity: number | null;
    warrantyTermId: string | null;
    startDate: string | null;
    coversParts: boolean | null;
    partsExpirationDate: string | null;
    coversLabor: boolean | null;
    laborExpirationDate: string | null;
    supplierId: string | null;
    supplierWarrantyExpirationDate: string | null;
    source: string | null;
  };
};

const WarrantyRegistrationForm = ({
  registration
}: WarrantyRegistrationFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  return (
    <ValidatedForm
      validator={warrantyRegistrationValidator}
      method="post"
      action={path.to.warrantyRegistration(registration.id ?? "")}
      defaultValues={{
        id: registration.id ?? undefined,
        itemId: registration.itemId ?? "",
        customerId: registration.customerId ?? "",
        trackedEntityId: registration.trackedEntityId ?? undefined,
        quantity: registration.quantity ?? 1,
        warrantyTermId: registration.warrantyTermId ?? undefined,
        startDate: registration.startDate ?? "",
        coversParts: registration.coversParts ?? true,
        partsExpirationDate: registration.partsExpirationDate ?? undefined,
        coversLabor: registration.coversLabor ?? true,
        laborExpirationDate: registration.laborExpirationDate ?? undefined,
        supplierId: registration.supplierId ?? undefined,
        supplierWarrantyExpirationDate:
          registration.supplierWarrantyExpirationDate ?? undefined
      }}
      className="w-full"
    >
      <Card>
        <CardHeader>
          <CardTitle>{registration.warrantyRegistrationId}</CardTitle>
          <CardDescription>
            {/* The registration is the truth, not the rule that produced it —
                a date typed here always wins over any term. */}
            <Trans>
              Stamped from {registration.source ?? "—"}
              {registration.serialNumber
                ? ` · ${registration.serialNumber}`
                : ""}
              . Edit any of it — this record is what coverage is checked
              against.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Item name="itemId" label={t`Item`} type="Item" />
            <Customer name="customerId" label={t`Customer`} />
            <Number name="quantity" label={t`Quantity`} minValue={0} />
            <WarrantyTerm
              name="warrantyTermId"
              label={t`Warranty Term`}
              helperText={t`Provenance only — the dates below are what count`}
            />
            <DatePicker name="startDate" label={t`Start Date`} />
            <Boolean name="coversParts" label={t`Covers parts`} bordered />
            <DatePicker
              name="partsExpirationDate"
              label={t`Parts Expiration`}
            />
            <Boolean name="coversLabor" label={t`Covers labor`} bordered />
            <DatePicker
              name="laborExpirationDate"
              label={t`Labor Expiration`}
            />
            <Supplier name="supplierId" label={t`Supplier`} />
            <DatePicker
              name="supplierWarrantyExpirationDate"
              label={t`Supplier Warranty Expiration`}
            />
            <CustomFormFields table="warrantyRegistration" />
          </div>
        </CardContent>
        <CardFooter>
          <HStack>
            <Submit isDisabled={!permissions.can("update", "sales")}>
              <Trans>Save</Trans>
            </Submit>
          </HStack>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default WarrantyRegistrationForm;
