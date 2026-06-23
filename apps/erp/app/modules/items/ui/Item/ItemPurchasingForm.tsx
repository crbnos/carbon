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
import {
  ConversionFactor,
  Hidden,
  Number,
  Submit,
  UnitOfMeasure
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
  allowedSuppliers
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
          <CardTitle>
            <Trans>Purchasing</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="itemId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Select
              name="preferredSupplierId"
              label={t`Preferred Supplier`}
              options={allowedSuppliersOptions}
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
              termId="lead-time"
            />
            <UnitOfMeasure
              name="purchasingUnitOfMeasureCode"
              label={t`Purchasing Unit of Measure`}
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
