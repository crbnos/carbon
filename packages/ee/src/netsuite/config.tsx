import type { SVGProps } from "react";
import { z } from "zod";

import { defineIntegration } from "../fns";

/**
 * NetSuite — the connection a one-click migration runs on.
 *
 * Two auth methods, and the choice matters. OAuth 2.0 **Client Credentials
 * (M2M)** is the one to use: no browser redirect, no refresh token to expire
 * mid-run, and it is where NetSuite is going. Token-Based Authentication is
 * offered only because many accounts already have a TBA integration record set
 * up — NetSuite accepts no NEW TBA integrations from 2027.1, so it is a bridge,
 * not a choice.
 *
 * Every credential field is `type: "secret"` or a plain id. The secrets go to
 * Supabase Vault via `SECRET_KEYS` and never come back to the browser: a secret
 * field loads empty, and leaving it empty keeps what is stored.
 */

const AUTH_METHODS = [
  "OAuth 2.0 (recommended)",
  "Token-Based Authentication"
] as const;

export const NetSuite = defineIntegration({
  name: "NetSuite",
  id: "netsuite",
  active: true,
  category: "Migration",
  logo: Logo,
  description:
    "Move your whole NetSuite account into Carbon in one click: chart of accounts, customers, suppliers, items, bills of material, on-hand stock, and open sales and purchase orders. Carbon reads NetSuite and never writes to it, and every migrated record keeps a link back to the NetSuite record it came from.",
  shortDescription: "Migrate your NetSuite data into Carbon.",
  setupInstructions: SetupInstructions,
  images: [],
  settings: [
    {
      name: "accountId",
      label: "Account ID",
      description:
        "Setup → Company → Company Information → Account ID. A sandbox looks like 1234567_SB1.",
      type: "text",
      required: true,
      value: ""
    },
    {
      name: "authMethod",
      label: "Authentication",
      type: "options",
      listOptions: [...AUTH_METHODS],
      required: true,
      value: AUTH_METHODS[0]
    },
    {
      name: "clientId",
      label: "Client ID",
      description: "From the Integration record you created in NetSuite.",
      type: "text",
      required: false,
      value: "",
      visibleWhen: { field: "authMethod", equals: AUTH_METHODS[0] }
    },
    {
      name: "certificateId",
      label: "Certificate ID",
      description:
        "Shown by NetSuite after you upload the public certificate under OAuth 2.0 Client Credentials (M2M) Setup. Not the Client ID.",
      type: "text",
      required: false,
      value: "",
      visibleWhen: { field: "authMethod", equals: AUTH_METHODS[0] }
    },
    {
      name: "privateKey",
      label: "Private Key (PEM)",
      description:
        "The private key matching that certificate. RSA keys must be 3072 or 4096 bits.",
      type: "secret",
      required: false,
      value: "",
      visibleWhen: { field: "authMethod", equals: AUTH_METHODS[0] }
    },
    {
      name: "consumerKey",
      label: "Consumer Key",
      type: "text",
      required: false,
      value: "",
      visibleWhen: { field: "authMethod", equals: AUTH_METHODS[1] }
    },
    {
      name: "consumerSecret",
      label: "Consumer Secret",
      type: "secret",
      required: false,
      value: "",
      visibleWhen: { field: "authMethod", equals: AUTH_METHODS[1] }
    },
    {
      name: "tokenId",
      label: "Token ID",
      type: "text",
      required: false,
      value: "",
      visibleWhen: { field: "authMethod", equals: AUTH_METHODS[1] }
    },
    {
      name: "tokenSecret",
      label: "Token Secret",
      type: "secret",
      required: false,
      value: "",
      visibleWhen: { field: "authMethod", equals: AUTH_METHODS[1] }
    }
  ],
  schema: z.object({
    // NetSuite writes the account id with an underscore (`1234567_SB1`); the
    // hostname needs it hyphenated. Both forms are accepted and normalized at
    // connection time, so a user pasting either does not get a DNS failure.
    accountId: z
      .string()
      .trim()
      .min(1, { message: "Account ID is required" })
      .regex(/^[A-Za-z0-9]+([_-][A-Za-z0-9]+)*$/, {
        message: "That does not look like a NetSuite account id"
      }),
    authMethod: z.enum(AUTH_METHODS),
    clientId: z.string().trim().optional().default(""),
    certificateId: z.string().trim().optional().default(""),
    // Empty means "keep the vaulted value" — a secret field is never sent to
    // the browser, so a blank submission is an untouched field, not a deletion.
    privateKey: z.string().optional().default(""),
    consumerKey: z.string().trim().optional().default(""),
    consumerSecret: z.string().optional().default(""),
    tokenId: z.string().trim().optional().default(""),
    tokenSecret: z.string().optional().default("")
  })
});

export type NetSuiteAuthMethod = (typeof AUTH_METHODS)[number];
export const NETSUITE_AUTH_METHODS = AUTH_METHODS;

function SetupInstructions() {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Carbon only ever <strong>reads</strong> from NetSuite. Nothing in your
        NetSuite account is created, changed or deleted by this integration.
      </p>
      <p className="text-sm text-muted-foreground">
        In NetSuite, go to Setup → Company → Enable Features → SuiteCloud and
        turn on <strong>REST Web Services</strong>, <strong>OAuth 2.0</strong>{" "}
        and <strong>SuiteAnalytics Workbook</strong>. The last one is what
        allows the queries this migration runs — without it every read fails
        with a permission error.
      </p>
      <p className="text-sm text-muted-foreground">
        Create an Integration record (Setup → Integration → Manage Integrations
        → New) with{" "}
        <strong>Client Credentials (machine to machine) Grant</strong> checked,
        then upload a public certificate under Setup → Integration → OAuth 2.0
        Client Credentials (M2M) Setup. NetSuite shows a{" "}
        <strong>Certificate ID</strong> afterwards — that is what goes in the
        Certificate ID field below, not the Client ID.
      </p>
      <p className="text-sm text-muted-foreground">
        The role you map to the integration needs read access to the records you
        want migrated, and its Subsidiary Restriction should be{" "}
        <strong>All</strong>: a role that silently returns fewer rows looks
        exactly like a customer with less data.
      </p>
    </>
  );
}

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={200}
      height={200}
      viewBox="0 0 100 100"
      fill="none"
      role="img"
      aria-label="NetSuite"
      {...props}
    >
      <title>NetSuite</title>
      <rect width="100" height="100" rx="18" fill="#0A6EBD" />
      <path d="M26 72V28h12l24 30V28h12v44H62L38 42v30H26z" fill="#fff" />
    </svg>
  );
}
