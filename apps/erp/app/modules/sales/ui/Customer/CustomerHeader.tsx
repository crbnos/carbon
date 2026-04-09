import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardAttribute,
  CardAttributeLabel,
  CardAttributes,
  CardAttributeValue,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { EmployeeAvatar } from "~/components";
import { useAuditLog } from "~/components/AuditLog";
import { Enumerable } from "~/components/Enumerable";
import { Tags } from "~/components/Form";
import { useCustomerTypes } from "~/components/Form/CustomerType";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { action } from "~/routes/x+/settings+/tags";
import { path } from "~/utils/path";
import type { CustomerDetail, CustomerStatus } from "../../types";

const CustomerHeader = () => {
  const { i18n, t } = useLingui();
  const { customerId } = useParams();

  if (!customerId) throw new Error("Could not find customerId");
  const fetcher = useFetcher<typeof action>();
  const permissions = usePermissions();
  const { company } = useUser();
  const deleteModal = useDisclosure();
  const routeData = useRouteData<{
    customer: CustomerDetail;
    tags: { name: string }[];
  }>(path.to.customer(customerId));

  const customerTypes = useCustomerTypes();
  const customerType = customerTypes?.find(
    (type) => type.value === routeData?.customer?.customerTypeId
  )?.label;

  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "customer",
    entityId: customerId,
    companyId: company.id,
    variant: "dropdown"
  });

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
        action: path.to.tags
      });
    },

    [customerId, fetcher.submit]
  );

  return (
    <>
      <VStack>
        <Card>
          <HStack className="justify-between items-start">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>{routeData?.customer?.name}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label={t`More options`}
                      icon={<LuEllipsisVertical />}
                      variant="secondary"
                      size="sm"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {auditLogTrigger}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!permissions.can("delete", "sales")}
                      destructive
                      onClick={deleteModal.onOpen}
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      <Trans>Delete Customer</Trans>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardTitle>
            </CardHeader>
          </HStack>
          <CardContent>
            <CardAttributes>
              <CardAttribute>
                <CardAttributeLabel>
                  <Trans>Status</Trans>
                </CardAttributeLabel>
                <CardAttributeValue>
                  {customerStatus ? (
                    <Enumerable value={i18n._(customerStatus)} />
                  ) : (
                    "-"
                  )}
                </CardAttributeValue>
              </CardAttribute>
              <CardAttribute>
                <CardAttributeLabel>
                  <Trans>Type</Trans>
                </CardAttributeLabel>
                <CardAttributeValue>
                  {customerType ? <Enumerable value={customerType!} /> : "-"}
                </CardAttributeValue>
              </CardAttribute>
              <CardAttribute>
                <CardAttributeLabel>
                  <Trans>Account Manager</Trans>
                </CardAttributeLabel>
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
                      label={t`Tags`}
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
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteCustomer(customerId)}
          isOpen={deleteModal.isOpen}
          name={routeData?.customer?.name!}
          text={t`Are you sure you want to delete ${routeData?.customer?.name!}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default CustomerHeader;
