import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { generateConsolePin, setEmployeePin } from "@carbon/ee/console.server";
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
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "operators-reset-pin");

/**
 * A PIN pins in as that person at any MES console, so resetting one hands over
 * their shop-floor identity. `users_update` covers console operators (PIN-only
 * accounts made for exactly this); anyone else — an admin included — also
 * needs `settings_update`, the permission that turns console mode on.
 */
async function requireResetPinPermission(request: Request, operatorId: string) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "users"
  });

  const user = await client
    .from("user")
    .select("id, firstName, lastName, isConsoleOperator")
    .eq("id", operatorId)
    .single();

  if (user.error || !user.data) {
    throw redirect(
      path.to.operators,
      await flash(request, error(user.error, "Operator not found"))
    );
  }

  if (!user.data.isConsoleOperator) {
    await requirePermissions(request, { update: "settings" });
  }

  return { companyId, userId, operator: user.data };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { operatorId } = params;
  if (!operatorId) throw new Error("Operator ID is required");

  const { operator } = await requireResetPinPermission(request, operatorId);
  return {
    operator: {
      id: operator.id,
      firstName: operator.firstName,
      lastName: operator.lastName
    }
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { operatorId } = params;
  if (!operatorId) throw new Error("Operator ID is required");

  const { companyId, userId } = await requireResetPinPermission(
    request,
    operatorId
  );

  // Generated on the server and stored only as a hash (the (employee, company)
  // FK refuses an operator outside this company). Returned so the modal can
  // show it once — it cannot be read back later.
  const pin = generateConsolePin();
  try {
    await setEmployeePin(getDatabaseClient(), {
      employeeId: operatorId,
      companyId,
      pin,
      updatedBy: userId
    });
  } catch (err) {
    logger.error("Failed to reset operator PIN", {
      companyId,
      operatorId,
      error: err
    });
    return { success: false as const, message: "Failed to reset PIN" };
  }

  return { success: true as const, pin };
}

export default function ResetPinRoute() {
  const { operator } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const formFetcher = useFetcher<typeof action>();
  const newPin =
    formFetcher.data?.success === true ? formFetcher.data.pin : null;
  const failure =
    formFetcher.data?.success === false ? formFetcher.data.message : null;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (open) return;
        if (newPin) navigate(path.to.operators);
        else navigate(-1);
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <formFetcher.Form method="post" className="flex flex-col h-full">
          <ModalHeader>
            <ModalTitle>
              <Trans>
                Reset PIN for {operator.firstName} {operator.lastName}
              </Trans>
            </ModalTitle>
          </ModalHeader>

          <ModalBody>
            {newPin ? (
              <VStack spacing={4}>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Share this PIN with the operator so they can pin in at MES
                    terminals.
                  </Trans>
                </p>
                <div className="flex items-center justify-center gap-3 w-full">
                  <span className="font-mono text-3xl tracking-[0.4em]">
                    {newPin}
                  </span>
                  <Copy text={newPin} />
                </div>
                <p className="text-xs text-muted-foreground text-center w-full">
                  <Trans>This PIN will not be shown again.</Trans>
                </p>
              </VStack>
            ) : (
              <VStack spacing={4}>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Generate a new 4-digit PIN. The operator's current PIN stops
                    working immediately.
                  </Trans>
                </p>
                {failure && (
                  <p className="text-sm text-destructive">{failure}</p>
                )}
              </VStack>
            )}
          </ModalBody>
          <ModalFooter>
            <HStack>
              {newPin ? (
                <Button
                  type="button"
                  onClick={() => navigate(path.to.operators)}
                >
                  <Trans>Done</Trans>
                </Button>
              ) : (
                <Button
                  type="submit"
                  isLoading={formFetcher.state !== "idle"}
                  isDisabled={formFetcher.state !== "idle"}
                >
                  <Trans>Reset PIN</Trans>
                </Button>
              )}
            </HStack>
          </ModalFooter>
        </formFetcher.Form>
      </ModalContent>
    </Modal>
  );
}
