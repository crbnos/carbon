// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction, useLoaderQuery } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Skeleton,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuArrowRightLeft, LuTriangleAlert } from "react-icons/lu";
import { AccountControlled } from "~/components/Form";
import type { AccountClass } from "~/modules/accounting/types";
import type { InvoiceLinePostedAccount } from "~/modules/invoicing/invoicing.service";

type ChangeInvoiceLineAccountProps = {
  /** The line's `account` action route. */
  action: string;
  /** The `api+` route that reads the account the line is posted to now. */
  currentAccountPath: string;
  /** The class of account the line can move to. */
  accountClass: AccountClass;
};

type PostedAccountResult =
  | { data: InvoiceLinePostedAccount; error: null }
  | { data: null; error: { message: string } };

/**
 * "Change GL Account" on a posted invoice line: a correcting journal moves the
 * line's posted amount to the account picked here. No form element, so it can
 * sit inside the line's own (read-only) form.
 */
export function ChangeInvoiceLineAccount({
  action,
  currentAccountPath,
  accountClass
}: ChangeInvoiceLineAccountProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  // Read when the dialog opens, so the line page loads nothing extra.
  const current = useLoaderQuery<PostedAccountResult>(
    open ? currentAccountPath : null,
    { staleTime: 0 }
  );
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
          <ModalBody className="flex flex-col gap-4">
            <CurrentAccount
              isPending={current.isPending}
              result={current.data}
              failed={current.isError}
            />
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

/** The account the line's posted amount is on now, or why it cannot change. */
function CurrentAccount({
  isPending,
  result,
  failed
}: {
  isPending: boolean;
  result: PostedAccountResult | undefined;
  failed: boolean;
}) {
  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>The current account could not be loaded.</Trans>
      </p>
    );
  }
  if (isPending || !result) return <Skeleton className="h-5 w-56" />;
  if (result.error) {
    return (
      <Alert variant="warning">
        <LuTriangleAlert className="h-4 w-4" />
        <AlertDescription>{result.error.message}</AlertDescription>
      </Alert>
    );
  }
  const account = [result.data.accountNumber, result.data.accountName]
    .filter(Boolean)
    .join(" ");
  return (
    <p className="text-sm">
      <Trans>Current account: {account}</Trans>
    </p>
  );
}
