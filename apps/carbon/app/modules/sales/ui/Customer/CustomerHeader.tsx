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

import { useParams } from "@remix-run/react";
import {
  Assignee,
  EmployeeAvatar,
  useOptimisticAssignment,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useRouteData } from "~/hooks";
import type { CustomerDetail, CustomerStatus } from "~/modules/sales";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

const CustomerHeader = () => {
  const permissions = usePermissions();
  const { customerId } = useParams();

  if (!customerId) throw new Error("Could not find customerId");
  const routeData = useRouteData<{ customer: CustomerDetail }>(
    path.to.customer(customerId)
  );

  const sharedCustomerData = useRouteData<{
    customerStatuses: CustomerStatus[];
    paymentTerms: ListItem[];
  }>(path.to.customerRoot);

  const customerStatus = sharedCustomerData?.customerStatuses?.find(
    (status) => status.id === routeData?.customer?.customerStatusId
  )?.name;

  const optimisticAssignment = useOptimisticAssignment({
    id: customerId,
    table: "customer",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.customer?.assignee;

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
            {permissions.is("employee") && (
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
            )}
            <CardAttribute>
              <CardAttributeLabel>Status</CardAttributeLabel>
              <CardAttributeValue>
                {customerStatus ? <Enumerable value={customerStatus!} /> : "-"}
              </CardAttributeValue>
            </CardAttribute>
          </CardAttributes>
        </CardContent>
      </Card>
    </VStack>
  );
};

export default CustomerHeader;
