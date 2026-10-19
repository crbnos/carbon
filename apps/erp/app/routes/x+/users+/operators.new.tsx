// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { ValidatedForm, validator } from "@carbon/form";
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
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useNavigate } from "react-router";
import { Input, Location, Submit } from "~/components/Form";
import { useUser } from "~/hooks";
import { createOperatorValidator } from "~/modules/users/users.models";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "users" });
  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(createOperatorValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.users.addConsoleOperator(input.data);
  // The PIN is generated on the server and stored only as a hash; the result
  // carries it so the modal can show it to the admin exactly once.
  if (result.error) {
    return respond(args.request, result).redirect(path.to.operators);
  }
  return result;
}

export default function NewOperatorRoute() {
  const { t } = useLingui();
  const { defaults } = useUser();
  const navigate = useNavigate();
  const closeRoute = useCloseRoute();
  const formFetcher = useFetcher<typeof action>();
  const created =
    formFetcher.data && "data" in formFetcher.data
      ? formFetcher.data.data
      : null;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (open) return;
        if (created) navigate(path.to.operators);
        else closeRoute();
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
