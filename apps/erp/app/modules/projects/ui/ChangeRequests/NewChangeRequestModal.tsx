// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Input, Submit, TextArea } from "~/components/Form";
import { path } from "~/utils/path";
import { projectChangeRequestValidator } from "../../projects.models";

/**
 * Opens a change request; the new route goes to the Elements page with it.
 * Opened from the change requests page and from the project sidebar's
 * change request picker.
 */
export function NewChangeRequestModal({
  projectId,
  onClose
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { t } = useLingui();

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={projectChangeRequestValidator}
            method="post"
            action={path.to.newProjectChangeRequest(projectId)}
            defaultValues={{ title: "", reason: "" }}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>New Change Request</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Input
                name="title"
                label={t`Title`}
                placeholder={t`Lighter harness`}
                autoFocus
              />
              <TextArea name="reason" label={t`Reason`} />
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit>
                  <Trans>Open</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}
