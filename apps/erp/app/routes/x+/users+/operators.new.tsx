import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { generateConsolePin, setEmployeePin } from "@carbon/ee/console.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import {
  Button,
  Copy,
  HStack,
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
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useNavigate } from "react-router";
import { Input, Location, Submit } from "~/components/Form";
import { useUser } from "~/hooks";
import { createOperatorValidator } from "~/modules/users/users.models";
import { createConsoleOperator } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "operators-new");

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

  const { firstName, lastName, locationId } = validation.data;

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

  // The PIN is generated HERE, on the server, and stored only as a hash — the
  // action returns it so the modal can show it to the admin exactly once.
  const pin = generateConsolePin();
  try {
    await setEmployeePin(getDatabaseClient(), {
      employeeId: result.userId,
      companyId,
      pin,
      updatedBy: userId
    });
  } catch (err) {
    logger.error("Failed to set PIN for operator", {
      companyId,
      operatorId: result.userId,
      error: err
    });
    await updateSubscriptionQuantityForCompany(companyId);
    throw redirect(
      path.to.operators,
      await flash(
        request,
        error(
          err,
          "Operator created, but the PIN could not be set. Use Reset PIN."
        )
      )
    );
  }

  await updateSubscriptionQuantityForCompany(companyId);

  return { success: true as const, pin, name: result.name };
}

export default function NewOperatorRoute() {
  const { t } = useLingui();
  const { defaults } = useUser();
  const navigate = useNavigate();
  const formFetcher = useFetcher<typeof action>();
  const created =
    formFetcher.data && "pin" in formFetcher.data ? formFetcher.data : null;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (open) return;
        if (created) navigate(path.to.operators);
        else navigate(-1);
      }}
    >
      <ModalOverlay />
      <ModalContent>
        {created ? (
          <CreatedOperatorPin
            name={created.name}
            pin={created.pin}
            onDone={() => navigate(path.to.operators)}
          />
        ) : (
          <ValidatedForm
            method="post"
            action={path.to.newOperator}
            validator={createOperatorValidator}
            defaultValues={{
              locationId: defaults?.locationId ?? undefined
            }}
            fetcher={formFetcher}
            className="flex flex-col h-full"
          >
            <ModalHeader>
              <ModalTitle>
                <Trans>Add Console Operator</Trans>
              </ModalTitle>
            </ModalHeader>

            <ModalBody>
              <VStack spacing={4}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                  <Input name="firstName" label={t`First Name`} />
                  <Input name="lastName" label={t`Last Name`} />
                </div>
                <Location name="locationId" label={t`Location`} />
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    A 4-digit PIN is generated when the operator is created.
                  </Trans>
                </p>
              </VStack>
            </ModalBody>
            <ModalFooter>
              <HStack>
                <Submit isLoading={formFetcher.state !== "idle"}>
                  <Trans>Create Operator</Trans>
                </Submit>
              </HStack>
            </ModalFooter>
          </ValidatedForm>
        )}
      </ModalContent>
    </Modal>
  );
}

function CreatedOperatorPin({
  name,
  pin,
  onDone
}: {
  name: string;
  pin: string;
  onDone: () => void;
}) {
  return (
    <>
      <ModalHeader>
        <ModalTitle>
          <Trans>Console Operator Created</Trans>
        </ModalTitle>
      </ModalHeader>
      <ModalBody>
        <VStack spacing={4}>
          <p className="text-sm text-muted-foreground">
            <Trans>
              Share this PIN with {name} so they can pin in at MES terminals.
            </Trans>
          </p>
          <div className="flex items-center justify-center gap-3 w-full">
            <span className="font-mono text-3xl tracking-[0.4em]">{pin}</span>
            <Copy text={pin} />
          </div>
          <p className="text-xs text-muted-foreground text-center w-full">
            <Trans>
              This PIN will not be shown again. If it is lost, reset it from the
              operators list.
            </Trans>
          </p>
        </VStack>
      </ModalBody>
      <ModalFooter>
        <HStack>
          <Button onClick={onDone}>
            <Trans>Done</Trans>
          </Button>
        </HStack>
      </ModalFooter>
    </>
  );
}
