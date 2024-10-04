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
import type { SupplierDetail, SupplierStatus } from "~/modules/purchasing";
import { path } from "~/utils/path";

const SupplierHeader = () => {
  const permissions = usePermissions();
  const { supplierId } = useParams();

  if (!supplierId) throw new Error("Could not find supplierId");
  const routeData = useRouteData<{ supplier: SupplierDetail }>(
    path.to.supplier(supplierId)
  );

  const sharedSupplierData = useRouteData<{
    supplierStatuses: SupplierStatus[];
  }>(path.to.supplierRoot);

  const supplierStatus = sharedSupplierData?.supplierStatuses?.find(
    (status) => status.id === routeData?.supplier?.supplierStatusId
  )?.name;

  const optimisticAssignment = useOptimisticAssignment({
    id: supplierId,
    table: "supplier",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.supplier?.assignee;

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

            {permissions.is("employee") && (
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
            )}
          </CardAttributes>
        </CardContent>
      </Card>
    </VStack>
  );
};

export default SupplierHeader;
