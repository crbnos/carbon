import {
  FieldEmptyState,
  fieldEmptyStateLinkClassName,
  Select,
  ValidatedForm
} from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Link, useParams } from "react-router";
import type { z } from "zod";
import { Hidden, Number, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { useSuppliers } from "~/stores/suppliers";
import { itemPurchasingValidator } from "../../items.models";
import type { SupplierPart } from "../../types";

type ItemPurchasingFormProps = {
  initialValues: z.infer<typeof itemPurchasingValidator>;
  allowedSuppliers?: string[];
  supplierParts?: SupplierPart[];
};

const ItemPurchasingForm = ({
  initialValues,
  allowedSuppliers,
  supplierParts
}: ItemPurchasingFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const [suppliers] = useSuppliers();
  const allowedSuppliersOptions = suppliers?.reduce(
    (acc, supplier) => {
      if (allowedSuppliers?.includes(supplier.id)) {
        acc.push({
          label: supplier.name,
          value: supplier.id
        });
      }
      return acc;
    },
    [] as { label: string; value: string }[]
  );

  // Purchasing unit of measure and conversion factor are not editable here —
  // they are pulled from the preferred supplier's supplier part record.
  const [preferredSupplierId, setPreferredSupplierId] = useState<
    string | undefined
  >(initialValues.preferredSupplierId ?? undefined);

  const preferredSupplierPart = supplierParts?.find(
    (sp) => sp.supplierId === preferredSupplierId
  );
  const purchasingUnitOfMeasureCode =
    preferredSupplierPart?.supplierUnitOfMeasureCode ?? "";
  const conversionFactor = preferredSupplierPart?.conversionFactor ?? 1;

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={itemPurchasingValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Purchasing</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="itemId" />
          <Hidden
            name="purchasingUnitOfMeasureCode"
            value={purchasingUnitOfMeasureCode}
          />
          <Hidden name="conversionFactor" value={conversionFactor} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Select
              name="preferredSupplierId"
              label={t`Preferred Supplier`}
              termId="item-preferred-supplier"
              options={allowedSuppliersOptions}
              onChange={(newValue) =>
                setPreferredSupplierId(newValue?.value ?? undefined)
              }
              emptyMessage={
                <FieldEmptyState
                  title={<Trans>No suppliers yet</Trans>}
                  description={
                    <Trans>
                      <Link to="new" className={fieldEmptyStateLinkClassName}>
                        Add a supplier part
                      </Link>{" "}
                      for this item to set a preferred supplier.
                    </Trans>
                  }
                />
              }
            />
            <Number
              name="leadTime"
              label={t`Lead Time (Days)`}
              termId="item-purchasing-lead-time"
            />
            {/* <Boolean name="purchasingBlocked" label={t`Purchasing Blocked`} /> */}
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ItemPurchasingForm;
