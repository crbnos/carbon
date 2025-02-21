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
import type { action } from "~/routes/x+/settings+/tags";
import { path } from "~/utils/path";
import type { CustomerDetail, CustomerStatus } from "../../types";
import { useCustomerTypes } from "~/components/Form/CustomerType";

const CustomerHeader = () => {
  const { customerId } = useParams();

  if (!customerId) throw new Error("Could not find customerId");
  const fetcher = useFetcher<typeof action>();
  const routeData = useRouteData<{
    customer: CustomerDetail;
    tags: { name: string }[];
  }>(path.to.customer(customerId));

  const customerTypes = useCustomerTypes();
  const customerType = customerTypes?.find(
    (type) => type.value === routeData?.customer?.customerTypeId
  )?.label;

  const sharedCustomerData = useRouteData<{
    customerStatuses: CustomerStatus[];
  }>(path.to.customerRoot);
  const customerStatus = sharedCustomerData?.customerStatuses?.find(
    (status) => status.id === routeData?.customer?.customerStatusId
  )?.name;

  const onUpdateTags = useCallback(
    (value: string[]) => {
      const formData = new FormData();

      formData.append("ids", customerId);
      formData.append("table", "customer");

      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customerId]
  );

  return (
    <VStack>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>{routeData?.customer?.name}</CardTitle>
          </CardHeader>
          <CardAction>
            {/* <Button onClick={() => alert("TODO")} leftIcon={<FaHistory />}>
              Customer Details
            </Button> */}
          </CardAction>
        </HStack>
        <CardContent>
          <CardAttributes>
            <CardAttribute>
              <CardAttributeLabel>Status</CardAttributeLabel>
              <CardAttributeValue>
                {customerStatus ? <Enumerable value={customerStatus!} /> : "-"}
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>Type</CardAttributeLabel>
              <CardAttributeValue>
                {customerType ? <Enumerable value={customerType!} /> : "-"}
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>Account Manager</CardAttributeLabel>
              <CardAttributeValue>
                {routeData?.customer?.accountManagerId ? (
                  <EmployeeAvatar
                    employeeId={routeData?.customer?.accountManagerId ?? null}
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
                    tags: routeData?.customer?.tags ?? [],
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
                    table="customer"
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
                    id={customerId}
                    table="customer"
                    value={assignee ?? ""}
                    isReadOnly={!permissions.can("update", "sales")}
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

export default CustomerHeader;
