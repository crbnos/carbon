import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardAction,
  CardAttribute,
  CardAttributeLabel,
  CardAttributeValue,
  CardAttributes,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack,
} from "@carbon/react";

import { useFetcher, useParams } from "@remix-run/react";
import { useCallback } from "react";
import { z } from "zod";
import { EmployeeAvatar } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { Tags } from "~/components/Form";
import { useRouteData } from "~/hooks";
import type { SupplierDetail, SupplierStatus } from "~/modules/purchasing";
import type { action } from "~/routes/x+/settings+/tags";
import { path } from "~/utils/path";

const SupplierHeader = () => {
  const { supplierId } = useParams();

  if (!supplierId) throw new Error("Could not find supplierId");
  const fetcher = useFetcher<typeof action>();
  const routeData = useRouteData<{
    supplier: SupplierDetail;
    tags: { name: string }[];
  }>(path.to.supplier(supplierId));

  const sharedSupplierData = useRouteData<{
    supplierStatuses: SupplierStatus[];
  }>(path.to.supplierRoot);

  const supplierStatus = sharedSupplierData?.supplierStatuses?.find(
    (status) => status.id === routeData?.supplier?.supplierStatusId
  )?.name;

  const onUpdateTags = useCallback(
    (value: string[]) => {
      const formData = new FormData();

      formData.append("ids", supplierId);
      formData.append("table", "supplier");

      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supplierId]
  );

  return (
    <VStack>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>{routeData?.supplier?.name}</CardTitle>
          </CardHeader>
          <CardAction>
            {/* <Button onClick={() => alert("TODO")} leftIcon={<FaHistory />}>
              Supplier Details
            </Button> */}
          </CardAction>
        </HStack>
        <CardContent>
          <CardAttributes>
            <CardAttribute>
              <CardAttributeLabel>Status</CardAttributeLabel>
              <CardAttributeValue>
                {supplierStatus ? <Enumerable value={supplierStatus!} /> : "-"}
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>Account Manager</CardAttributeLabel>
              <CardAttributeValue>
                {routeData?.supplier?.accountManagerId ? (
                  <EmployeeAvatar
                    employeeId={routeData?.supplier?.accountManagerId ?? null}
                  />
                ) : (
                  "-"
                )}
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeValue>
                <ValidatedForm
                  defaultValues={{
                    tags: routeData?.supplier?.tags ?? [],
                  }}
                  validator={z.object({
                    tags: z.array(z.string()).optional(),
                  })}
                  className="w-full"
                >
                  <Tags
                    label="Tags"
                    name="tags"
                    availableTags={routeData?.tags ?? []}
                    table="supplier"
                    inline
                    onChange={onUpdateTags}
                  />
                </ValidatedForm>
              </CardAttributeValue>
            </CardAttribute>

            {/* {permissions.is("employee") && (
              <CardAttribute>
                <CardAttributeLabel>Assignee</CardAttributeLabel>
                <CardAttributeValue>
                  <Assignee
                    id={supplierId}
                    table="supplier"
                    value={assignee ?? ""}
                    isReadOnly={!permissions.can("update", "purchasing")}
                  />
                </CardAttributeValue>
              </CardAttribute>
            )} */}
          </CardAttributes>
        </CardContent>
      </Card>
    </VStack>
  );
};

export default SupplierHeader;
