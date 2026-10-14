// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
  Spinner,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { LuCircleAlert, LuCreditCard } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Hidden, InputControlled } from "~/components/Form";
import type { StripeCustomerResolution } from "~/modules/invoicing/stripe-customer.server";
import { path } from "~/utils/path";

const CREATE_NEW = "__create_new__";

/** Who the Stripe customer is resolved for: an invoice's bill-to, or a
 *  billing customer directly (a contract, which has no invoice yet). */
export type StripeCustomerSource =
  | { invoiceId: string; customerContactId: string }
  | { customerId: string; customerContactId?: string | null };

/**
 * Load the panel's resolution by invoice or by customer. `email` is the
 * address the user committed for a contact that had none. A response for an
 * earlier source or email is stale and reads as loading, so the panel never
 * offers a choice about a different customer than the one on screen.
 */
export function useStripeCustomerResolution(
  source: StripeCustomerSource | null,
  email?: string
): { resolution: StripeCustomerResolution | null; isLoading: boolean } {
  const fetcher = useFetcher<StripeCustomerResolution>();
  const url = !source
    ? null
    : "invoiceId" in source
      ? path.to.api.stripeConnectCustomer(
          source.invoiceId,
          source.customerContactId,
          email
        )
      : path.to.api.stripeConnectCustomerByCustomer(
          source.customerId,
          source.customerContactId,
          email
        );
  const loadedUrl = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `fetcher` is a fresh object each render, so depending on it would re-run this effect forever.
  useEffect(() => {
    if (!url) return;
    loadedUrl.current = url;
    fetcher.load(url);
  }, [url]);

  if (!url) return { resolution: null, isLoading: false };
  return {
    resolution: fetcher.data ?? null,
    isLoading: fetcher.state !== "idle" || loadedUrl.current !== url
  };
}

type StripeCustomerPanelProps = {
  resolution: StripeCustomerResolution | null;
  isLoading: boolean;
  /** Email the user typed for a contact that had none; lifted so the parent can re-resolve. */
  email: string;
  onEmailChange: (email: string) => void;
  onEmailCommit: (email: string) => void;
  /** What the choice is made for, which only changes the copy: posting one
   *  invoice, or confirming a contract whose invoices are sent via Stripe. */
  subject?: "invoice" | "contract";
};

function CustomerLine({
  name,
  email,
  id
}: {
  name: string | null;
  email: string | null;
  id?: string;
}) {
  return (
    <VStack spacing={0}>
      <span className="text-sm font-medium">{name ?? email ?? id}</span>
      {email && <span className="text-xs text-muted-foreground">{email}</span>}
      {id && <span className="text-xs text-muted-foreground">{id}</span>}
    </VStack>
  );
}

/**
 * What posting through Stripe will do to the connected account, and the
 * decision the user has to make about it.
 *
 * The `stripeCustomerAction` hidden field is the whole point: the post action
 * refuses to run without one, so every path through this panel either emits an
 * action the user chose or emits nothing and leaves the submit disabled.
 */
const StripeCustomerPanel = ({
  resolution,
  isLoading,
  email,
  onEmailChange,
  onEmailCommit,
  subject = "invoice"
}: StripeCustomerPanelProps) => {
  const isContract = subject === "contract";
  const { t } = useLingui();
  const [selection, setSelection] = useState<string>(CREATE_NEW);

  // A fresh resolution invalidates whatever the user had picked — the match
  // list it referred to no longer exists.
  useEffect(() => {
    if (resolution?.state === "match-found") {
      setSelection(resolution.matches[0]?.id ?? CREATE_NEW);
    } else {
      setSelection(CREATE_NEW);
    }
  }, [resolution]);

  if (isLoading || !resolution) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        <Trans>Checking Stripe for this customer…</Trans>
      </div>
    );
  }

  switch (resolution.state) {
    case "unavailable":
      return (
        <Alert variant="destructive">
          <LuCircleAlert />
          <AlertTitle>
            <Trans>Cannot send through Stripe</Trans>
          </AlertTitle>
          <AlertDescription>{resolution.message}</AlertDescription>
        </Alert>
      );

    case "missing-email":
      return (
        <VStack spacing={2}>
          <Alert variant="warning">
            <LuCircleAlert />
            <AlertTitle>
              {isContract ? (
                <Trans>No email address for this customer</Trans>
              ) : (
                <Trans>This contact has no email address</Trans>
              )}
            </AlertTitle>
            <AlertDescription>
              {isContract ? (
                <Trans>
                  Stripe emails the invoices to the customer, so an address is
                  required. It is also saved to the contract's invoice contact
                  in Carbon, if it has one.
                </Trans>
              ) : (
                <Trans>
                  Stripe emails the invoice to the customer, so an address is
                  required. This will also be saved to the contact in Carbon.
                </Trans>
              )}
            </AlertDescription>
          </Alert>
          <InputControlled
            name="stripeCustomerEmail"
            label={t`Email`}
            value={email}
            onChange={onEmailChange}
            onBlur={() => onEmailCommit(email)}
          />
        </VStack>
      );

    case "linked":
      return (
        <VStack spacing={2}>
          <Alert variant="info">
            <LuCreditCard />
            <AlertTitle>
              <Trans>Existing Stripe customer</Trans>
            </AlertTitle>
            <AlertDescription>
              {isContract ? (
                <Trans>
                  The contract's invoices will be billed to the Stripe customer
                  already linked to this Carbon customer. To change its details,
                  edit it in the Stripe dashboard.
                </Trans>
              ) : (
                <Trans>
                  This invoice will be billed to the Stripe customer already
                  linked to this Carbon customer. To change its details, edit it
                  in the Stripe dashboard.
                </Trans>
              )}
            </AlertDescription>
          </Alert>
          <div className="w-full rounded-lg border p-3">
            <CustomerLine
              name={resolution.customer.name}
              email={resolution.customer.email}
              id={resolution.customer.id}
            />
          </div>
          <Hidden name="stripeCustomerAction" value="use-linked" />
        </VStack>
      );

    case "match-found":
      return (
        <VStack spacing={2}>
          <Alert variant="warning">
            <LuCircleAlert />
            <AlertTitle>
              <Trans>Stripe already has a customer with this email</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                Link this Carbon customer to one of them, or create a separate
                Stripe customer.
              </Trans>
            </AlertDescription>
          </Alert>
          <RadioGroup
            value={selection}
            onValueChange={setSelection}
            className="w-full"
          >
            {resolution.matches.map((match) => (
              <label
                key={match.id}
                htmlFor={match.id}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3"
              >
                <RadioGroupItem value={match.id} id={match.id} />
                <CustomerLine
                  name={match.name}
                  email={match.email}
                  id={match.id}
                />
              </label>
            ))}
            <label
              htmlFor={CREATE_NEW}
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3"
            >
              <RadioGroupItem value={CREATE_NEW} id={CREATE_NEW} />
              <Label className="cursor-pointer text-sm font-medium">
                <Trans>Create a new Stripe customer instead</Trans>
              </Label>
            </label>
          </RadioGroup>
          <Hidden
            name="stripeCustomerAction"
            value={selection === CREATE_NEW ? "create" : "link-existing"}
          />
          {selection !== CREATE_NEW && (
            <Hidden name="stripeCustomerId" value={selection} />
          )}
        </VStack>
      );

    case "new":
      return (
        <VStack spacing={2}>
          <Alert variant="info">
            <LuCreditCard />
            <AlertTitle>
              <Trans>A new Stripe customer will be created</Trans>
            </AlertTitle>
            <AlertDescription>
              {isContract ? (
                <Trans>
                  Stripe has no customer for this Carbon customer yet.
                  Confirming will create one on your connected account.
                </Trans>
              ) : (
                <Trans>
                  Stripe has no customer for this Carbon customer yet. Posting
                  will create one on your connected account.
                </Trans>
              )}
            </AlertDescription>
          </Alert>
          <div className="w-full rounded-lg border p-3">
            <VStack spacing={0}>
              <span className="text-sm font-medium">
                {resolution.preview.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {resolution.preview.email}
              </span>
              {resolution.preview.phone && (
                <span className="text-xs text-muted-foreground">
                  {resolution.preview.phone}
                </span>
              )}
              {resolution.preview.addressLines.map((line) => (
                <span key={line} className="text-xs text-muted-foreground">
                  {line}
                </span>
              ))}
              {resolution.preview.taxExempt === "exempt" && (
                <span className="text-xs text-muted-foreground">
                  <Trans>Tax exempt</Trans>
                </span>
              )}
              {resolution.preview.taxExempt === "reverse" && (
                <span className="text-xs text-muted-foreground">
                  <Trans>Reverse charge</Trans>
                </span>
              )}
            </VStack>
          </div>
          <Hidden name="stripeCustomerAction" value="create" />
        </VStack>
      );
  }
};

export default StripeCustomerPanel;
