import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  HStack,
  IconButton,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import { useState } from "react";
import { LuCheck, LuCopy, LuRefreshCw } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useNavigate } from "react-router";
import { Input, Location, Submit } from "~/components/Form";
import { useUser } from "~/hooks";
import { createOperatorValidator } from "~/modules/users/users.models";
import { createConsoleOperator } from "~/modules/users/users.server";

function generatePin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

import type { Result } from "~/types";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "users" });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "users"
  });

  const validation = await validator(createOperatorValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { firstName, lastName, locationId, pin } = validation.data;

  // Auto-assign Console Operator employee type
  const serviceRole = getCarbonServiceRole();
  const operatorType = await serviceRole
    .from("employeeType")
    .select("id")
    .eq("companyId", companyId)
    .eq("systemType", "Console Operator")
    .single();

  if (operatorType.error || !operatorType.data) {
    throw redirect(
      path.to.operators,
      await flash(
        request,
        error(
          null,
          "Console Operator employee type not found. Run the migration."
        )
      )
    );
  }

  const result = await createConsoleOperator(client, {
    firstName,
    lastName,
    employeeType: operatorType.data.id,
    locationId,
    companyId,
    createdBy: userId
  });

  if (!result.success) {
    throw redirect(
      path.to.operators,
      await flash(
        request,
        error(result, result.message ?? "Failed to create console operator")
      )
    );
  }

  // Set PIN if provided (employee record is already created by createConsoleOperator)
  if (pin) {
    const pinUpdate = await serviceRole
      .from("employee")
      .update({ pin } as any)
      .eq("id", result.userId)
      .eq("companyId", companyId);

    if (pinUpdate.error) {
      console.error("Failed to set PIN for operator:", pinUpdate.error);
    }
  }

  await updateSubscriptionQuantityForCompany(companyId);

  throw redirect(
    path.to.operators,
    await flash(request, success("Console operator created successfully"))
  );
}

export default function NewOperatorRoute() {
  const { defaults } = useUser();
  const navigate = useNavigate();
  const formFetcher = useFetcher<Result>();
  const [pinValue, setPinValue] = useState(generatePin);
  const [copied, setCopied] = useState(false);

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
          action={path.to.newOperator}
          validator={createOperatorValidator}
          defaultValues={{
            locationId: defaults?.locationId ?? undefined,
            pin: pinValue
          }}
          fetcher={formFetcher}
          className="flex flex-col h-full"
        >
          <ModalHeader>
            <ModalTitle>Add Console Operator</ModalTitle>
          </ModalHeader>

          <ModalBody>
            <VStack spacing={4}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                <Input name="firstName" label="First Name" />
                <Input name="lastName" label="Last Name" />
              </div>
              <Location name="locationId" label="Location" />
              <div className="space-y-2 w-full">
                <Label htmlFor="pin">PIN</Label>
                <HStack>
                  <Input
                    name="pin"
                    value={pinValue}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setPinValue(val);
                    }}
                    maxLength={4}
                    inputMode="numeric"
                    className="font-mono text-lg tracking-[0.3em] text-center"
                  />
                  <IconButton
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Copy PIN"
                    icon={
                      copied ? (
                        <LuCheck className="text-emerald-500" />
                      ) : (
                        <LuCopy />
                      )
                    }
                    onClick={() => {
                      navigator.clipboard.writeText(pinValue);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  />
                  <IconButton
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Generate new PIN"
                    icon={<LuRefreshCw />}
                    onClick={() => {
                      const newPin = generatePin();
                      setPinValue(newPin);
                      setCopied(false);
                    }}
                  />
                </HStack>
                <p className="text-xs text-muted-foreground">
                  Share this PIN with the operator so they can pin in at MES
                  terminals.
                </p>
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit isLoading={formFetcher.state !== "idle"}>
                Create Operator
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
