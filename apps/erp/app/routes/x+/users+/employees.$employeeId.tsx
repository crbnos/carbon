import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import {
  makeCompanyPermissionsFromClaims,
  makeCompanyPermissionsFromEmployeeType,
  updateEmployee
} from "@carbon/ee/permissions.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuShield } from "react-icons/lu";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { UpgradeOverlayUpgradeButton } from "~/components/UpgradeOverlay";
import { usePlanGate } from "~/hooks/usePlanGate";
import type { CompanyPermission } from "~/modules/users";
import {
  EmployeePermissionsForm,
  employeeValidator,
  getEmployee,
  getEmployeeTypes,
  getPermissionsByEmployeeType,
  userPermissionsValidator
} from "~/modules/users";
import { getClaims } from "~/modules/users/users.server";
import { path } from "~/utils/path";
import { getCompanyId, invalidateUserSelectQueries } from "~/utils/react-query";

// The per-user permissions editor is a modal over the accounts list; when the
// company isn't entitled we show the upgrade prompt IN that modal (not a
// full-page overlay), so closing it returns to the accounts list — which stays
// fully usable (inviting people is a Community feature).
function PermissionsUpgradeModal() {
  const navigate = useNavigate();
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(-1);
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
  const { companyId } = await requirePermissions(request, {
    view: "users",
    role: "employee"
  });

  const { employeeId } = params;
  if (!employeeId) throw notFound("employeeId not found");

  const client = getCarbonServiceRole();

  const [rawClaims, employee, employeeTypes] = await Promise.all([
    getClaims(client, employeeId, companyId),
    getEmployee(client, employeeId, companyId),
    getEmployeeTypes(client, companyId)
  ]);

  if (rawClaims.error || employee.error || rawClaims.data === null) {
    redirect(
      path.to.employeeAccounts,
      await flash(
        request,
        error(
          { rawClaims: rawClaims.error, employee: employee.error },
          "Failed to load employee"
        )
      )
    );
  }
  const claims = makeCompanyPermissionsFromClaims(
    rawClaims.data as Json[],
    companyId
  );

  if (claims === null) {
    redirect(
      path.to.employeeAccounts,
      await flash(request, error(null, "Failed to parse claims"))
    );
  }

  const types = employeeTypes.data ?? [];
  const permissionsByType = await Promise.all(
    types.map((t) => getPermissionsByEmployeeType(client, t.id))
  );
  const employeeTypePermissions: Record<
    string,
    Record<string, CompanyPermission>
  > = {};
  types.forEach((t, i) => {
    const result = permissionsByType[i];
    const raw = makeCompanyPermissionsFromEmployeeType(
      result.data ?? [],
      companyId
    );
    const perms: Record<string, CompanyPermission> = {};
    for (const [mod, entry] of Object.entries(raw)) {
      perms[mod.toLowerCase()] = entry.permission;
    }
    employeeTypePermissions[t.id] = perms;
  });

  return {
    permissions: claims?.permissions,
    employee: employee.data,
    employeeTypes: types,
    employeeTypePermissions
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "users"
  });

  await requireFeature({
    request,
    client,
    companyId,
    redirectTo: path.to.employeeAccounts,
    feature: "PERMISSIONS"
  });

  const validation = await validator(employeeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, employeeType, data: permissionData } = validation.data;
  const permissions = JSON.parse(permissionData) as Record<
    string,
    CompanyPermission
  >;

  if (
    !Object.values(permissions).every(
      (permission) => userPermissionsValidator.safeParse(permission).success
    )
  ) {
    return data(
      {},
      await flash(request, error(permissions, "Failed to parse permissions"))
    );
  }

  const ip = request.headers.get("x-forwarded-for") ?? undefined;

  const result = await updateEmployee(client, {
    id,
    employeeType,
    permissions,
    companyId,
    actorId: userId,
    ip
  });

  throw redirect(path.to.employeeAccounts, await flash(request, result));
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  invalidateUserSelectQueries(getCompanyId());
  return await serverAction();
}

export default function UsersEmployeeRoute() {
  const { permissions, employee, employeeTypes, employeeTypePermissions } =
    useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "PERMISSIONS" });

  if (isGated) {
    return <PermissionsUpgradeModal />;
  }

  const initialValues = {
    id: employee?.id || "",
    employeeType: employee?.employeeTypeId,
    permissions: permissions || {}
  };

  return (
    <EmployeePermissionsForm
      key={initialValues.id}
      name={employee?.name || ""}
      employeeTypes={employeeTypes}
      employeeTypePermissions={employeeTypePermissions}
      // @ts-expect-error
      initialValues={initialValues}
    />
  );
}
