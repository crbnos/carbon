import { Select, ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  ConversionFactor,
  Hidden,
  Number,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { useSuppliers } from "~/stores/suppliers";
import { path } from "~/utils/path";
import { itemPurchasingValidator } from "../../items.models";
import type { PartSummary } from "../../types";

type ItemPurchasingFormProps = {
  initialValues: z.infer<typeof itemPurchasingValidator>;
  allowedSuppliers?: string[];
};

const ItemPurchasingForm = ({
  initialValues,
  allowedSuppliers,
}: ItemPurchasingFormProps) => {
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const [suppliers] = useSuppliers();
  const allowedSuppliersOptions = suppliers?.reduce((acc, supplier) => {
    if (allowedSuppliers?.includes(supplier.id)) {
      acc.push({
        label: supplier.name,
        value: supplier.id,
      });
    }
    return acc;
  }, [] as { label: string; value: string }[]);

  const routeData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId)
  );

  const inventoryCode = routeData?.partSummary?.unitOfMeasureCode;
  const [purchasingCode, setPurchasingCode] = useState<string | null>(
    initialValues.purchasingUnitOfMeasureCode ?? null
  );

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={itemPurchasingValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>Purchasing</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="itemId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Select
              name="preferredSupplierId"
              label="Preferred Supplier"
              options={allowedSuppliersOptions}
            />
            <Number name="purchasingLeadTime" label="Lead Time (Days)" />
            <UnitOfMeasure
              name="purchasingUnitOfMeasureCode"
              label="Purchasing Unit of Measure"
              onChange={(newValue) => {
                if (newValue) setPurchasingCode(newValue.value);
              }}
            />
            <ConversionFactor
              name="conversionFactor"
              isReadOnly={!purchasingCode || !inventoryCode}
              purchasingCode={purchasingCode ?? undefined}
              inventoryCode={inventoryCode ?? undefined}
            />
            <Boolean name="purchasingBlocked" label="Purchasing Blocked" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ItemPurchasingForm;
