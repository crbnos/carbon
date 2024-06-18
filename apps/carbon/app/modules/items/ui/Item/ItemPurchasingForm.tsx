import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  ConversionFactor,
  Hidden,
  Number,
  Submit,
  Supplier,
  UnitOfMeasure,
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import type { PartSummary } from "~/modules/items";
import { itemPurchasingValidator } from "~/modules/items";
import { path } from "~/utils/path";

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
            <Supplier
              name="preferredSupplierId"
              label="Preferred Supplier"
              allowedSuppliers={allowedSuppliers}
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
