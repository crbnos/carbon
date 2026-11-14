// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuArrowRightLeft } from "react-icons/lu";
import { AccountControlled } from "~/components/Form";
import type { AccountClass } from "~/modules/accounting/types";

type ChangeInvoiceLineAccountProps = {
  /** The line's `account` action route. */
  action: string;
  /** The class of account the line can move to. */
  accountClass: AccountClass;
};

/**
 * "Change GL Account" on a posted invoice line: a correcting journal moves the
 * line's posted amount to the account picked here. No form element, so it can
 * sit inside the line's own (read-only) form.
 */
export function ChangeInvoiceLineAccount({
  action,
  accountClass
}: ChangeInvoiceLineAccountProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const fetcher = useAction({
    onSuccess: () => {
      toast.success(t`Account changed`);
      setOpen(false);
      setAccountId("");
    }
  });

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        leftIcon={<LuArrowRightLeft />}
        onClick={() => setOpen(true)}
      >
        <Trans>Change GL Account</Trans>
      </Button>
      <Modal
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) setOpen(false);
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <Trans>Change GL Account</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                A journal dated on the invoice's posting date moves the line's
                posted amount to the new account. The period must be open.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <AccountControlled
              classes={[accountClass]}
              value={accountId}
              onChange={setAccountId}
              placeholder={t`Select an account`}
              aria-label={t`New GL Account`}
            />
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="button"
              isDisabled={!accountId}
              isLoading={fetcher.isPending}
              onClick={() =>
                fetcher.submit({ accountId }, { method: "post", action })
              }
            >
              <Trans>Change Account</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
