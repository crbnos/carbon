// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
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
  useCloseRoute,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { path } from "~/utils/path";

/**
 * The rule `users.operator.resetPin` enforces (see `resetConsoleOperatorPin`),
 * checked here too so the modal never opens for a reset the action refuses.
 */
async function requireResetPinPermission(request: Request, operatorId: string) {
  const { client } = await requirePermissions(request, {
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

  return { operator: user.data };
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["operatorId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.users.resetConsoleOperatorPin({
    operatorId: input.params.operatorId
  });
}

export default function ResetPinRoute() {
  const { operator } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const closeRoute = useCloseRoute();
  const formFetcher = useFetcher<typeof action>();
  const result =
    formFetcher.data && "error" in formFetcher.data ? formFetcher.data : null;
  const newPin = result?.data?.pin ?? null;
  const failure = result?.error?.message ?? null;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (open) return;
        if (newPin) navigate(path.to.operators);
        else closeRoute();
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
