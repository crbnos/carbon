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
import { useSupplierTypes } from "~/components/Form/SupplierType";
import { useRouteData, useUser } from "~/hooks";
import type { SupplierDetail, SupplierStatus } from "~/modules/purchasing";
import type { action } from "~/routes/x+/settings+/tags";
import { path } from "~/utils/path";

const SupplierHeader = () => {
  const { supplierId } = useParams();

  if (!supplierId) throw new Error("Could not find supplierId");
  const fetcher = useFetcher<typeof action>();
  const { company } = useUser();
  const auditDrawer = useDisclosure();
  const routeData = useRouteData<{
    supplier: SupplierDetail;
    tags: { name: string }[];
  }>(path.to.supplier(supplierId));

  const rootRouteData = useRouteData<{
    auditLogEnabled: Promise<boolean>;
  }>(path.to.authenticatedRoot);

  const supplierTypes = useSupplierTypes();
  const supplierType = supplierTypes?.find(
    (type) => type.value === routeData?.supplier?.supplierTypeId
  )?.label;

  const sharedSupplierData = useRouteData<{
    supplierStatuses: SupplierStatus[];
  }>(path.to.supplierRoot);

  const supplierStatus = sharedSupplierData?.supplierStatuses?.find(
    (status) => status.id === routeData?.supplier?.supplierStatusId
  )?.name;

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
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
        action: path.to.tags
      });
    },

    [supplierId]
  );

  return (
    <>
      <VStack>
        <Card>
          <HStack className="justify-between items-start">
            <CardHeader>
              <CardTitle>{routeData?.supplier?.name}</CardTitle>
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
                  {supplierStatus ? (
                    <Enumerable value={supplierStatus!} />
                  ) : (
                    "-"
                  )}
                </CardAttributeValue>
              </CardAttribute>
              <CardAttribute>
                <CardAttributeLabel>Type</CardAttributeLabel>
                <CardAttributeValue>
                  {supplierType ? <Enumerable value={supplierType!} /> : "-"}
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
                      tags: routeData?.supplier?.tags ?? []
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
      <AuditLogDrawer
        isOpen={auditDrawer.isOpen}
        onClose={auditDrawer.onClose}
        entityType="supplier"
        entityId={supplierId}
        companyId={company.id}
      />
    </>
  );
};

export default SupplierHeader;
