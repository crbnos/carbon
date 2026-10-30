// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuCheck, LuShieldCheck } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";

/**
 * Shown before a new API key: a CI job or a cloud workload can use identity
 * federation instead and hold no key at all.
 */
export default function ApiKeyChooser({
  query,
  onContinue,
  onClose
}: {
  /** The list's query string, kept on the federation page. */
  query: string;
  /** Goes on to the API key form. */
  onContinue: () => void;
  onClose: () => void;
}) {
  const suffix = query ? `?${query}` : "";
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <div className="flex size-10 items-center justify-center rounded-lg border bg-muted">
            <LuShieldCheck className="size-5" />
          </div>
          <ModalTitle>
            <Trans>With identity federation, you don't need an API key</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <p className="text-muted-foreground">
              <Trans>
                Your CI or cloud provider issues short-lived tokens that
                authenticate your requests. There is no static key to manage.
              </Trans>
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex items-center gap-2">
                <LuCheck className="size-4 shrink-0" />
                <Trans>
                  Nothing to store in env vars, config files, or secret managers
                </Trans>
              </li>
              <li className="flex items-center gap-2">
                <LuCheck className="size-4 shrink-0" />
                <Trans>Tokens expire in minutes</Trans>
              </li>
              <li className="flex items-center gap-2">
                <LuCheck className="size-4 shrink-0" />
                <Trans>
                  Works with GitHub Actions, AWS, Google Cloud, and Microsoft
                  Entra ID
                </Trans>
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Local scripts and third-party tools may still need an API key.
              </Trans>
            </p>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <VStack spacing={2} className="w-full">
            <Button size="lg" className="w-full" asChild>
              <Link to={`${path.to.newFederationRule}${suffix}`}>
                <Trans>Set up identity federation</Trans>
              </Link>
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="w-full"
              onClick={onContinue}
            >
              <Trans>Continue with an API key</Trans>
            </Button>
          </VStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
