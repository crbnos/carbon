import { RAMP_CLIENT_ID } from "@carbon/auth";
import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { RAMP_AUTHORIZE_URL, RAMP_TOKEN_URL } from "./environment";
// Client-bundle safe: `modes` value-imports only the pure `spend/types` leaf;
// everything else it touches is type-only and erased.
import {
  rampOwnsCodingSurface,
  resolveRampMode,
  resolveRampModeProfile
} from "./lib/modes";
import { RAMP_OAUTH_SCOPES, RAMP_PUSH_ONLY_OAUTH_SCOPES } from "./scopes";

/**
 * OAuth "Connect to Ramp" authorization-code flow — the ONLY way to connect
 * Ramp. The authorize/token hosts come from `./environment` (a browser-safe
 * module, not `./lib/client`, which pulls `node:crypto` into the client
 * bundle), which carries the TEMPORARY sandbox/production switch used for
 * customer testing. `offline_access` requests a refresh token; the app must
 * have the Refresh Token grant enabled. IntegrationCard builds the authorize
 * redirect from this block.
 */

/**
 * Ramp settings form schema. Connection is exclusively via the "Connect to Ramp"
 * OAuth flow — the callback stores `metadata.credentials` (oauth2), pinned to
 * production — so the form carries NO client credentials. It only holds the
 * optional entity scope, the account mapping, and the sync toggles, all flat at
 * the metadata root.
 */
const RampSettingsSchema = z.object({
  entityId: z.string().optional(),
  /**
   * Optional HERE only because requiredness depends on the install mode, which
   * this schema cannot see: a push-only install posts no card journal, so the
   * form does not render the field and nothing is there to validate. A
   * `.min(1)` made the whole settings form unsaveable in that mode — a customer
   * could not change a Sync toggle.
   *
   * It is still required for a provider-mode install, enforced where the mode IS
   * known: `convergeRamp` refuses to push masters or launch finance without it,
   * and `rampHealthcheck` reports the install unhealthy — both behind
   * `rampOwnsCodingSurface`. The setting keeps `required: true` so provider mode
   * still marks the field required in the UI.
   */
  cardLiabilityAccountId: z.string().optional(),
  statementBankAccountId: z.string().optional(),
  cashbackIncomeAccountId: z.string().optional(),
  reimbursementBankAccountId: z.string().optional(),
  // SwitchField posts a literal "true"/"false" string; stored flat as-is.
  pullTransactions: z.string().optional(),
  pullBills: z.string().optional(),
  pullReimbursements: z.string().optional(),
  pushPurchaseOrders: z.string().optional(),
  pushInvoices: z.string().optional()
});

export const Ramp = defineIntegration({
  name: "Ramp",
  id: "ramp",
  // Gate on the OAuth app client id (mirrors jira/onshape). Without a configured
  // RAMP_CLIENT_ID the "Connect to Ramp" authorize URL would be built with an
  // empty client_id, so the card reads "Coming soon" until the app is set up.
  active: !!RAMP_CLIENT_ID,
  category: "Spend Management",
  providerRole: "spend" as const,
  logo: Logo,
  setupInstructions: SetupInstructions,
  /**
   * Mode-NEUTRAL on purpose. This is what someone sees BEFORE choosing a mode,
   * and the previous text ("pulls your charges, bills, and employee
   * reimbursements into Carbon's general ledger…") described provider mode only
   * — so it promised inbound posting to a reader who might be about to choose
   * push-only, where none of it happens. Each mode's own copy says what that
   * mode does; this says what the integration is.
   */
  description:
    "Connect Ramp to Carbon for spend management. Carbon keeps purchase orders and vendor bills in sync with Ramp, and you choose at connect time whether Carbon acts as Ramp's accounting system or another system posts your ledger.",
  shortDescription:
    "Keep purchase orders, bills, and card spend in sync with Ramp.",
  images: [],
  // One-click "Connect to Ramp" (production OAuth). When present, Install opens
  // this authorize URL; the callback (`/api/integrations/ramp/oauth`) exchanges
  // the code, and account mapping happens afterwards in the Details drawer.
  oauth: {
    authUrl: RAMP_AUTHORIZE_URL,
    clientId: RAMP_CLIENT_ID ?? "",
    redirectUri: "/api/integrations/ramp/oauth",
    // The default set, used only when no mode is chosen. The connect route
    // builds the real authorize URL from the selected mode's scopes below.
    scopes: [...RAMP_OAUTH_SCOPES],
    tokenUrl: RAMP_TOKEN_URL
  },
  /**
   * Chosen BEFORE consent and fixed for the life of the install — Ramp permits
   * exactly one connected accounting provider, so this decides whether Carbon
   * requests `accounting:write` at all. Changing it means uninstalling.
   *
   * Note Ramp does not name this role: Brex, BILL and Coupa all expose an
   * explicit "spend without the ledger" posture and Ramp does not, so this is
   * built on a well-evidenced affordance of Ramp's scope split rather than a
   * documented product mode.
   */
  /**
   * Ramp's capabilities are a property of the INSTALL, not the integration: in
   * push-only mode another system holds the accounting seat, so Carbon owns
   * neither the coding surface nor the AP ledger family. `resolveRampModeProfile`
   * defaults an install with no stored mode to `provider` — today's behaviour.
   */
  /**
   * The chosen mode, plus — only when it is meaningful — which system Ramp
   * reports as holding the accounting connection.
   *
   * `detail` is deliberately omitted in PROVIDER mode. There, Carbon holds the
   * seat, so naming a peer beside "Carbon is my accounting system" is at best
   * noise and at worst a flat contradiction: the stored value is a snapshot that
   * is only refreshed for a non-seat-holder, so a provider-mode install could
   * show a name left over from a previous push-only install indefinitely. That
   * is exactly what it did.
   *
   * In push-only, undefined still means "Carbon could not tell" — not "nobody" —
   * and the drawer must not render it as the latter.
   */
  resolveInstallMode: (metadata: unknown) => {
    const stored = (metadata ?? {}) as {
      syncMode?: "provider" | "push-only";
      accountingConnectionProvider?: string;
    };
    const id = resolveRampMode(stored);
    return {
      id,
      detail: rampOwnsCodingSurface(stored)
        ? undefined
        : stored.accountingConnectionProvider
    };
  },
  resolveInstallCapabilities: (metadata: unknown) =>
    resolveRampModeProfile(
      (metadata ?? {}) as { syncMode?: "provider" | "push-only" }
    ).capabilities,
  modes: [
    {
      id: "provider",
      label: "Carbon is my accounting system",
      description:
        "Carbon connects as Ramp's accounting provider: it pulls card charges, bills and reimbursements into Carbon's ledger, and pushes your chart of accounts and cost centers to Ramp for coding.",
      shortDescription:
        "Pull charges, bills, and reimbursements; push your chart of accounts.",
      scopes: [...RAMP_OAUTH_SCOPES]
    },
    {
      id: "push-only",
      label: "Another system posts my ledger",
      description:
        // Purchase orders and bills, and nothing else: the mode's
        // `outboundCeiling` is `{ purchaseOrder: true, bill: true }` and
        // `rampSyncerRegistry` registers exactly those two. Item-receipt push was
        // designed and dropped (2026-09-25), so `RAMP_PUSH_ONLY_SCOPES` does not
        // ask for `item_receipts:write` — and this copy is shown BEFORE consent,
        // for a choice that cannot be changed without reinstalling.
        "Carbon pushes purchase orders and provisional bills into Ramp but never claims Ramp's accounting connection — your other accounting system keeps it, and codes and posts the spend.",
      shortDescription:
        "Push purchase orders and bills to Ramp; another system posts the ledger.",
      scopes: [...RAMP_PUSH_ONLY_OAUTH_SCOPES]
    }
  ],
  /**
   * Both the GL-account mapping and the inbound toggles exist to configure what
   * Carbon does with activity Ramp SENDS it — and Ramp sends it to whichever
   * system holds its accounting-connection seat. `ownsRemoteCodingSurface` is
   * that seat (it is the single predicate behind all six `accounting:write`
   * calls, see `rampOwnsCodingSurface`), so it is not a proxy for "does Carbon
   * pull": it is the same fact. In push-only mode another system holds it, and
   * offering a card-liability account or a "Charges" switch there would promise
   * posting Carbon must not do.
   *
   * Note this hides the bill toggle too, which in push-only still gates the one
   * inbound family that survives (bill payments — what tells a Carbon invoice it
   * was paid). That is deliberate: `pullBills` is ONE stored toggle covering
   * bills AND their payments, and its label describes the bills half, which
   * push-only never does. Showing "Pull Ramp bills into Carbon as purchase
   * invoices" to the customer who chose "another system posts my ledger" would
   * read as the exact double-posting they installed this mode to avoid. The
   * cost is that push-only's bill-payment pull is not customer-toggleable;
   * splitting the toggle in two is the follow-up.
   */
  settingGroups: [
    {
      name: "Connection",
      description: "API access to your Ramp business"
    },
    {
      name: "Accounts",
      description: "GL accounts Ramp activity posts against"
    },
    {
      name: "Sync",
      // Deliberately direction-neutral: push-only renders this group with only
      // the outbound toggles, so "flows into and out of Carbon" was false there.
      description: "What Carbon keeps in sync with Ramp"
    }
  ],
  settings: [
    {
      name: "entityId",
      label: "Entity ID",
      description: "Limit sync to one Ramp entity (leave blank for all)",
      group: "Connection",
      type: "text" as const,
      required: false,
      value: ""
    },
    {
      name: "cardLiabilityAccountId",
      availableWhen: (c) => c.ownsRemoteCodingSurface,
      label: "Card liability account",
      description:
        "Pick the Liability account that tracks what you owe on your Ramp cards — your outstanding Ramp balance. Each card charge Carbon pulls in credits this account; paying a statement debits it back down. Required — no charges sync until this is set.",
      group: "Accounts",
      type: "options" as const,
      listOptions: [],
      required: true,
      value: ""
    },
    {
      name: "statementBankAccountId",
      availableWhen: (c) => c.ownsRemoteCodingSurface,
      label: "Statement bank account",
      description:
        "Optional. Only needed if you want Carbon to book Ramp statement payments and transfers: Carbon credits this bank (Asset) account and debits the card liability above. Leave blank to skip statement-payment and transfer sync — card charges sync without it.",
      group: "Accounts",
      type: "options" as const,
      listOptions: [],
      required: false,
      value: ""
    },
    {
      name: "cashbackIncomeAccountId",
      availableWhen: (c) => c.ownsRemoteCodingSurface,
      label: "Cashback income account",
      description:
        "The revenue account Ramp cashback posts to. Leave blank to skip cashback sync.",
      group: "Accounts",
      type: "options" as const,
      listOptions: [],
      required: false,
      value: ""
    },
    {
      name: "reimbursementBankAccountId",
      availableWhen: (c) => c.ownsRemoteCodingSurface,
      label: "Reimbursement bank account",
      description:
        "The bank/asset account employee reimbursements are paid from. Defaults to the statement bank account.",
      group: "Accounts",
      type: "options" as const,
      listOptions: [],
      required: false,
      value: ""
    },
    {
      name: "pullTransactions",
      availableWhen: (c) => c.ownsRemoteCodingSurface,
      label: "Charges",
      description: "Pull Ramp charges into Carbon.",
      group: "Sync",
      type: "switch" as const,
      required: false,
      value: "true"
    },
    {
      name: "pullBills",
      availableWhen: (c) => c.ownsRemoteCodingSurface,
      label: "Bills",
      description: "Pull Ramp bills into Carbon as purchase invoices.",
      group: "Sync",
      type: "switch" as const,
      required: false,
      value: "true"
    },
    {
      name: "pullReimbursements",
      availableWhen: (c) => c.ownsRemoteCodingSurface,
      label: "Reimbursements",
      description: "Pull Ramp employee reimbursements into Carbon.",
      group: "Sync",
      type: "switch" as const,
      required: false,
      value: "true"
    },
    {
      name: "pushPurchaseOrders",
      label: "Purchase orders",
      description: "Push Carbon purchase orders to Ramp.",
      group: "Sync",
      type: "switch" as const,
      required: false,
      value: "true"
    },
    {
      name: "pushInvoices",
      label: "Invoices",
      description: "Push Carbon invoices to Ramp as draft bills.",
      group: "Sync",
      type: "switch" as const,
      required: false,
      value: "true"
    }
  ],
  schema: RampSettingsSchema
});

function SetupInstructions({
  companyId,
  mode
}: {
  companyId: string;
  mode?: string;
}) {
  const origin = isBrowser ? window.location.origin : "";
  const webhookUrl = origin ? `${origin}/api/webhook/ramp/${companyId}` : "";

  // Steps 2 and 3 are the ones that differ. Before this, EVERY install was told
  // to map GL accounts under Accounts and that charges/bills/reimbursements
  // "flow in" — on a push-only install the Accounts tab does not exist and
  // nothing flows in, so the instructions described the one thing this mode was
  // built to avoid.
  const pushOnly = mode === "push-only";

  return (
    <div className="text-sm text-muted-foreground">
      <ol className="list-decimal space-y-3 pl-4">
        <li>
          <span className="font-medium text-foreground">Connect to Ramp.</span>{" "}
          Click <span className="font-medium">Connect to Ramp</span> and approve
          access in the Ramp window. You must sign in to Ramp as an{" "}
          <span className="font-medium">Admin</span> or{" "}
          <span className="font-medium">Business Owner</span> to authorize the
          connection.
        </li>
        {pushOnly ? (
          <li>
            <span className="font-medium text-foreground">
              Keep your accounting system connected in Ramp.
            </span>{" "}
            Carbon does not take Ramp's accounting connection in this mode —
            your other accounting system keeps it, and codes and posts the
            spend. Carbon never writes to Ramp's accounting surface.
          </li>
        ) : (
          <li>
            <span className="font-medium text-foreground">
              Map the GL accounts
            </span>{" "}
            under Accounts so card charges, statement payments, cashback, and
            reimbursements post to the right places.
          </li>
        )}
        {pushOnly ? (
          <li>
            <span className="font-medium text-foreground">
              Choose what pushes
            </span>{" "}
            under Sync — purchase orders and invoices go out to Ramp as draft
            bills. Nothing is pulled into Carbon's ledger; your other accounting
            system posts it.
          </li>
        ) : (
          <li>
            <span className="font-medium text-foreground">
              Choose what syncs
            </span>{" "}
            under Sync — charges, bills, and reimbursements flow in; purchase
            orders and invoices push out. All are on by default.
          </li>
        )}
        <li>
          <span className="font-medium text-foreground">
            Webhook (registered automatically).
          </span>{" "}
          On connect, Carbon registers the endpoint below with Ramp so new
          activity syncs in near-real-time. Ramp must be able to reach it over
          the public internet — for local development, expose Carbon with a
          tunnel (e.g. ngrok) and point your app URL at that tunnel. If the URL
          isn't publicly reachable, the hourly sync still keeps everything up to
          date.
        </li>
      </ol>
      <InputGroup className="mb-8 mt-4">
        <Input value={webhookUrl} readOnly />
        <InputRightElement>
          <Copy text={webhookUrl} />
        </InputRightElement>
      </InputGroup>
    </div>
  );
}

function Logo(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      viewBox="0 0 75 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      // The official Ramp wordmark. The shared render sites size logos by
      // height; clamp to a modest height and let the width follow so it never
      // overflows the drawer's icon box. `currentColor` keeps it theme-aware.
      style={{
        height: "1.25rem",
        width: "auto",
        maxWidth: "100%",
        // Caller's style LAST: a render site that sizes the mark itself (the
        // document SOURCE badge asks for 0.875rem) must win over this default,
        // or every site is stuck at the drawer's size.
        ...props.style
      }}
    >
      <g clipPath="url(#ramp-logo-clip)" fill="currentColor">
        <path d="M5.19 6.76c-1.79 0-2.667 1.576-2.667 3.681v5.275H0V4.585h2.478v2.888h.043c.53-1.776 1.585-3.21 3.212-3.21 1.144 0 1.627.399 1.627.399L6.22 6.955c0-.002-.363-.195-1.031-.195Zm30.496 1.528v7.427h-2.458V9.192c0-1.872-.587-2.864-2.088-2.864-1.553 0-2.305 1.254-2.305 3.66v5.726H26.4V9.192c0-1.8-.58-2.864-2.066-2.864-1.695 0-2.348 1.486-2.348 3.66v5.726h-2.478V4.584h2.478v2.521h.022c.386-1.744 1.44-2.82 3.218-2.82 1.764 0 2.913.947 3.349 2.627.415-1.617 1.52-2.628 3.218-2.628 2.37 0 3.893 1.486 3.893 4.004ZM12.318 4.262c-2.28 0-3.773 1.071-4.453 3.005l2.099.763c.382-1.166 1.18-1.83 2.398-1.83 1.37 0 2.175.603 2.175 1.528 0 .947-.64 1.145-2.088 1.379-1.61.259-5.437.344-5.437 3.573 0 1.892 1.582 3.315 3.958 3.315 1.786 0 3.003-.73 3.566-2.089h.022v1.81h2.457V8.868c0-2.995-1.508-4.607-4.697-4.607Zm2.283 6.214c0 2.334-1.155 3.833-3 3.833-1.306 0-2.088-.732-2.088-1.788 0-.99.804-1.678 2.348-1.961 1.58-.29 2.375-.648 2.74-1.507v1.423Zm29.826-6.192c-1.88 0-3.121 1.033-3.653 2.585V4.585h-2.61V20h2.588v-6.568h.022c.576 1.681 1.775 2.606 3.653 2.606 2.979 0 5.11-2.454 5.11-5.921 0-3.443-2.131-5.833-5.11-5.833Zm-.642 9.688c-2.063 0-3.207-1.497-3.207-3.822s1.28-3.822 3.207-3.822c1.926 0 3.208 1.57 3.208 3.822 0 2.253-1.28 3.822-3.208 3.822ZM75.172 15.665v.07l-10.1.003v-.073c1.457-.823 2.462-1.66 3.367-2.536h4.147l2.586 2.536ZM72.67 2.51 70.11 0h-.075s.043 4.68-4.255 8.936c-4.206 4.166-9.152 4.175-9.152 4.175v.073l2.608 2.555s4.874.048 9.18-4.175c4.29-4.21 4.254-9.053 4.254-9.053Z" />
      </g>
      <defs>
        <clipPath id="ramp-logo-clip">
          <path fill="#fff" d="M0 0h75v20H0z" />
        </clipPath>
      </defs>
    </svg>
  );
}
