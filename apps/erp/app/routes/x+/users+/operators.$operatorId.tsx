import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  useMount,
  VStack
} from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { Input, Select, Submit } from "~/components/Form";
import { convertOperatorValidator } from "~/modules/users/users.models";
import { convertConsoleOperatorToUser } from "~/modules/users/users.server";
import type { getEmployeeTypes } from "~/modules/users/users.service";
import type { Result } from "~/types";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    update: "users"
  });

  const { operatorId } = params;
  if (!operatorId) throw new Error("Operator ID is required");

  const user = await client
    .from("user")
    .select("id, firstName, lastName, email")
    .eq("id", operatorId)
    .single();

  if (user.error || !user.data) {
    throw redirect(
      path.to.operators,
      await flash(request, error(user.error, "Operator not found"))
    );
  }

  return { operator: user.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "users"
  });

  const { operatorId } = params;
  if (!operatorId) throw new Error("Operator ID is required");

  const validation = await validator(convertOperatorValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await convertConsoleOperatorToUser(client, {
    userId: operatorId,
    email: validation.data.email,
    employeeType: validation.data.employeeType,
    companyId,
    createdBy: userId
  });

  if (!result.success) {
    throw redirect(
      path.to.operators,
      await flash(request, error(result, result.message))
    );
  }

  throw redirect(
    path.to.employeeAccounts,
    await flash(
      request,
      success("Operator converted to full user. Invite email sent.")
    )
  );
}

export default function ConvertOperatorRoute() {
  const { operator } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const formFetcher = useFetcher<Result>();
  const employeeTypeFetcher =
    useFetcher<Awaited<ReturnType<typeof getEmployeeTypes>>>();

  useMount(() => {
    employeeTypeFetcher.load(path.to.api.employeeTypes);
  });

  const employeeTypeOptions =
    employeeTypeFetcher.data?.data
      ?.filter((et) => et.systemType !== "Console Operator")
      .map((et) => ({
        value: et.id,
        label: et.name
      })) ?? [];

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(-1);
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          method="post"
          validator={convertOperatorValidator}
          fetcher={formFetcher}
          className="flex flex-col h-full"
        >
          <ModalHeader>
            <ModalTitle>Convert to Full User</ModalTitle>
          </ModalHeader>

          <ModalBody>
            <VStack spacing={4}>
              <p className="text-sm text-muted-foreground">
                Convert{" "}
                <strong>
                  {operator.firstName} {operator.lastName}
                </strong>{" "}
                from a console operator to a full user. They will receive an
                email invitation and be able to log in independently.
              </p>
              <Input
                name="email"
                label="Email Address"
                placeholder="operator@company.com"
              />
              <Select
                name="employeeType"
                label="Employee Type"
                options={employeeTypeOptions}
                placeholder="Select Employee Type"
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit isLoading={formFetcher.state !== "idle"}>
                Convert & Send Invite
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
