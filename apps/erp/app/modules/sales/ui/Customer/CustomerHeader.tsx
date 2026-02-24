import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardAction,
  CardAttribute,
  CardAttributeLabel,
  CardAttributes,
  CardAttributeValue,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Suspense, useCallback } from "react";
import { LuHistory } from "react-icons/lu";
import { Await, useFetcher, useParams } from "react-router";
import { z } from "zod";
import { EmployeeAvatar } from "~/components";
import { AuditLogDrawer } from "~/components/AuditLog";
import { Enumerable } from "~/components/Enumerable";
import { Tags } from "~/components/Form";
import { useCustomerTypes } from "~/components/Form/CustomerType";
import { useRouteData, useUser } from "~/hooks";
import type { action } from "~/routes/x+/settings+/tags";
import { path } from "~/utils/path";
import type { CustomerDetail, CustomerStatus } from "../../types";

const CustomerHeader = () => {
  const { customerId } = useParams();

  if (!customerId) throw new Error("Could not find customerId");
  const fetcher = useFetcher<typeof action>();
  const { company } = useUser();
  const auditDrawer = useDisclosure();
  const routeData = useRouteData<{
    customer: CustomerDetail;
    tags: { name: string }[];
  }>(path.to.customer(customerId));

  const rootRouteData = useRouteData<{
    auditLogEnabled: Promise<boolean>;
  }>(path.to.authenticatedRoot);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
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
        action: path.to.tags
      });
    },

    [customerId]
  );

  return (
    <>
      <VStack>
        <Card>
          <HStack className="justify-between items-start">
            <CardHeader>
              <CardTitle>{routeData?.customer?.name}</CardTitle>
            </CardHeader>
            <Suspense fallback={null}>
              <Await resolve={rootRouteData?.auditLogEnabled}>
                {(auditLogEnabled) => {
                  return (
                    <>
                      {auditLogEnabled && (
                        <CardAction>
                          <Button
                            variant="secondary"
                            leftIcon={<LuHistory />}
                            onClick={auditDrawer.onOpen}
                          >
                            History
                          </Button>
                        </CardAction>
                      )}
                    </>
                  );
                }}
              </Await>
            </Suspense>
          </HStack>
          <CardContent>
            <CardAttributes>
              <CardAttribute>
                <CardAttributeLabel>Status</CardAttributeLabel>
                <CardAttributeValue>
                  {customerStatus ? (
                    <Enumerable value={customerStatus!} />
                  ) : (
                    "-"
                  )}
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
                      tags: routeData?.customer?.tags ?? []
                    }}
                    validator={z.object({
                      tags: z.array(z.string()).optional()
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
      <AuditLogDrawer
        isOpen={auditDrawer.isOpen}
        onClose={auditDrawer.onClose}
        entityType="customer"
        entityId={customerId}
        companyId={company.id}
      />
    </>
  );
};

export default CustomerHeader;
