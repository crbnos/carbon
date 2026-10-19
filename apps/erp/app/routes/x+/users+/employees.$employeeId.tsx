// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  useCloseRoute,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { LuShield } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { UpgradeOverlayUpgradeButton } from "~/components/UpgradeOverlay";
import { usePlanGate } from "~/hooks/usePlanGate";
import { EmployeePermissionsForm } from "~/modules/users/ui";
import { employeeValidator } from "~/modules/users/users.models";
import {
  getEmployee,
  getEmployeeTypes,
  originOf
} from "~/modules/users/users.service";
import { path } from "~/utils/path";

// The per-user permissions editor is a modal over the accounts list; when the
// company isn't entitled we show the upgrade prompt IN that modal (not a
// full-page overlay), so closing it returns to the accounts list — which stays
// fully usable (inviting people is a Community feature).
function PermissionsUpgradeModal() {
  const closeRoute = useCloseRoute();
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) closeRoute();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>User Permissions</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4} className="items-center text-center py-6">
            <div className="flex items-center justify-center rounded-full bg-muted size-12">
              <LuShield className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground max-w-sm">
              <Trans>
                Grant each user fine-grained, per-module permissions instead of
                giving everyone full access.
              </Trans>
            </p>
            <UpgradeOverlayUpgradeButton />
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId, api } = await authorize(
    request,
    { "users.accounts": "View" },
    { role: "employee" }
  );

  const { employeeId } = params;
  if (!employeeId) throw notFound("employeeId not found");

  const client = getCarbonServiceRole();

  const [employee, employeeTypes, grants, roleGrants, effectiveAccess] =
    await Promise.all([
      getEmployee(client, employeeId, companyId),
      getEmployeeTypes(client, companyId),
      api.users.getAccessGrants({
        subjectType: "person",
        subjectId: employeeId
      }),
      api.users.getRoleGrants({}),
      api.users.getEffectiveAccess({ userId: employeeId })
    ]);

  if (employee.error || grants.error || roleGrants.error) {
    throw redirect(
      path.to.employeeAccounts,
      await flash(
        request,
        error(
          {
            employee: employee.error,
            grants: grants.error,
            roleGrants: roleGrants.error
          },
          "Failed to load employee"
        )
      )
    );
  }

  return {
    employee: employee.data,
    employeeTypes: employeeTypes.data ?? [],
    grants: grants.data,
    roleGrants: roleGrants.data,
    effectiveAccess: effectiveAccess.data ?? []
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(employeeValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id, employeeType, data: grants } = input.data;
  const { api } = await authorize(args.request);
  const result = await api.users.updateEmployeePermissions({
    id,
    employeeType,
    grants: JSON.parse(grants),
    ip: originOf(args.request).ip
  });
  return respond(args.request, result).redirect(path.to.employeeAccounts, {
    message: "Permissions updated"
  });
}

export default function UsersEmployeeRoute() {
  const { employee, employeeTypes, grants, roleGrants, effectiveAccess } =
    useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "PERMISSIONS" });

  if (isGated) {
    return <PermissionsUpgradeModal />;
  }

  const initialValues = {
    id: employee?.id || "",
    employeeType: employee?.employeeTypeId ?? "",
    grants
  };

  return (
    <EmployeePermissionsForm
      key={initialValues.id}
      employee={{
        name: employee?.name || "",
        email: employee?.email ?? null,
        avatarUrl: employee?.avatarUrl ?? null
      }}
      employeeTypes={employeeTypes}
      roleGrants={roleGrants}
      effectiveAccess={effectiveAccess}
      initialValues={initialValues}
    />
  );
}
