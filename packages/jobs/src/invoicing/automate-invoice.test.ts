// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// External boundaries only: SMTP, Stripe, the PDF renderer, the rule engine
// and the party-contact policy (each reads its own tables), the Kysely mapping
// write, Inngest, storage, env.
const sendEmail = vi.fn();
const stripeSend = vi.fn();
const evaluateSalesRules = vi.fn();
const contactRequirement = vi.fn();
const raiseMoment = vi.fn();
// The posting server function, set per test by fakeClient.
let postInvoice: (
  input: unknown
) => Promise<{ data: unknown; error: { message: string } | null }>;

vi.mock("@carbon/env", () => ({
  SUPABASE_INTERNAL_URL: "http://internal:8000",
  SUPABASE_URL: "https://db.example.com"
}));
vi.mock("@carbon/lib/email.server", () => ({
  DEFAULT_FROM: "Carbon <no-reply@carbon.ms>",
  sendEmail: (...args: unknown[]) => sendEmail(...args)
}));
vi.mock("@carbon/ee/rules.server", () => ({
  evaluateSalesRulesForSalesDocument: (...args: unknown[]) =>
    evaluateSalesRules(...args),
  dedupeViolations: (violations: unknown[]) => violations
}));
// The Stripe API call only: the connected-account and customer-link reads run
// for real against the fake client. The Stripe SDK module is replaced so
// loading the real reads does not construct a Stripe or Supabase client.
vi.mock("../../../stripe/src/connect.server", () => ({
  createAndSendConnectInvoice: () => {
    throw new Error("The Stripe API is not reachable in tests");
  }
}));
vi.mock("@carbon/stripe/send-sales-invoice.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@carbon/stripe/send-sales-invoice.server")
  >()),
  sendPostedSalesInvoiceViaStripe: (...args: unknown[]) => stripeSend(...args)
}));
vi.mock("@carbon/ee/accounting", () => ({
  createMappingService: () => ({ link: async () => undefined })
}));
vi.mock("@carbon/lib/party-contact.server", () => ({
  checkPartyContactRequirement: (...args: unknown[]) =>
    contactRequirement(...args)
}));
vi.mock("@carbon/server-functions", () => ({
  serverFns: {
    system: () => ({
      invoke: (_name: string, input: unknown) => postInvoice(input)
    })
  }
}));
vi.mock("@carbon/lib/workflows", () => ({
  raiseMoment: (...args: unknown[]) => raiseMoment(...args)
}));
vi.mock("@carbon/lib/sales-invoice-document.server", () => ({
  loadSalesInvoiceDocument: async () => ({
    pdfProps: {},
    email: { company: { name: "Acme", logoLightIcon: null } },
    invoiceReadableId: "INV-1",
    fileName: "Acme - INV-1.pdf"
  }),
  renderSalesInvoicePdf: async () => Buffer.from("%PDF")
}));
vi.mock("@carbon/documents/email", () => ({
  SalesInvoiceEmail: (props: unknown) => props
}));
vi.mock("@react-email/components", () => ({
  renderAsync: async () => "<p>invoice</p>"
}));
vi.mock("@carbon/files", () => ({
  getDocumentType: () => "PDF",
  storage: () => ({
    company: () => ({ upload: async () => ({ data: {}, error: null }) })
  })
}));

import {
  companyFromAddress,
  emailPostedInvoice,
  INVOICE_SEND_NO_EMAIL,
  INVOICE_SEND_NO_STRIPE,
  invoiceEmailCc,
  postSalesInvoiceUnattended,
  resolveInvoiceAutomation,
  sendPostedInvoiceViaStripe
} from "./automate-invoice";

type Row = Record<string, unknown>;

/** A tiny in-memory PostgREST: filters, updates and inserts on plain rows. */
function fakeClient(
  tables: Record<string, Row[]>,
  onInvoke: (rows: Record<string, Row[]>) => {
    error: { message: string } | null;
  } = () => ({
    error: null
  })
) {
  const invoke = vi.fn(async () => ({ data: null, ...onInvoke(tables) }));
  postInvoice = invoke;
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let update: Row | undefined;
    let insert: Row | undefined;
    const rows = () => (tables[table] ??= []);
    const execute = (single: boolean) => {
      if (insert) {
        rows().push(insert);
        return { data: insert, error: null };
      }
      const matched = rows().filter((row) => filters.every((f) => f(row)));
      if (update) for (const row of matched) Object.assign(row, update);
      return {
        data: single ? (matched[0] ?? null) : matched,
        error: null
      };
    };
    const query = {
      select: () => query,
      limit: () => query,
      eq: (key: string, value: unknown) => {
        filters.push((row) => row[key] === value);
        return query;
      },
      in: (key: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[key]));
        return query;
      },
      not: (key: string) => {
        filters.push((row) => row[key] != null);
        return query;
      },
      update: (values: Row) => {
        update = values;
        return query;
      },
      insert: (values: Row) => {
        insert = values;
        return query;
      },
      single: async () => execute(true),
      maybeSingle: async () => execute(true),
      then: (resolve: (value: ReturnType<typeof execute>) => unknown) =>
        Promise.resolve(execute(false)).then(resolve)
    };
    return query;
  };
  return {
    client: { from } as never,
    tables,
    invoke
  };
}

const draftInvoice = (overrides: Row = {}): Row => ({
  id: "inv-1",
  companyId: "co-1",
  invoiceId: "INV-1",
  status: "Draft",
  automationHoldReason: null,
  customerId: "cust-1",
  invoiceCustomerContactId: "cc-1",
  opportunityId: "opp-1",
  sentAt: null,
  sentTo: null,
  sendError: null,
  ...overrides
});

const args = { companyId: "co-1", invoiceId: "inv-1" };
const db = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  evaluateSalesRules.mockResolvedValue({ violations: [] });
  contactRequirement.mockResolvedValue(null);
  sendEmail.mockResolvedValue({ data: { id: "msg-1" }, error: null });
  stripeSend.mockResolvedValue({
    stripeInvoiceId: "in_1",
    hostedInvoiceUrl: "https://invoice.stripe.com/i/1",
    invoicePdf: null
  });
});

describe("resolveInvoiceAutomation", () => {
  it("uses the contract's mode for an invoice drafted from a contract", async () => {
    const { client } = fakeClient({
      salesInvoice: [draftInvoice({ customerContractId: "cc-9" })],
      customerContracts: [
        {
          id: "cc-9",
          companyId: "co-1",
          effectiveInvoiceAutomation: "Post and Send via Stripe"
        }
      ],
      salesInvoiceLine: [
        { invoiceId: "inv-1", companyId: "co-1", rentalAgreementId: "ra-1" }
      ],
      rentalAgreements: [
        { id: "ra-1", companyId: "co-1", effectiveInvoiceAutomation: "Post" }
      ]
    });
    expect(await resolveInvoiceAutomation(client, "co-1", "inv-1")).toBe(
      "Post and Send via Stripe"
    );
  });

  it("falls back to the rental agreement's mode", async () => {
    const { client } = fakeClient({
      salesInvoice: [draftInvoice()],
      salesInvoiceLine: [
        { invoiceId: "inv-1", companyId: "co-1", rentalAgreementId: "ra-1" }
      ],
      rentalAgreements: [
        {
          id: "ra-1",
          companyId: "co-1",
          effectiveInvoiceAutomation: "Post and Email"
        }
      ]
    });
    expect(await resolveInvoiceAutomation(client, "co-1", "inv-1")).toBe(
      "Post and Email"
    );
  });
});

describe("postSalesInvoiceUnattended", () => {
  it("posts a Draft and announces it once", async () => {
    const { client, tables } = fakeClient(
      { salesInvoice: [draftInvoice()] },
      (rows) => {
        rows.salesInvoice![0]!.status = "Submitted";
        return { error: null };
      }
    );
    expect(await postSalesInvoiceUnattended({ client, db, ...args })).toEqual({
      outcome: "posted"
    });
    expect(tables.salesInvoice![0]!.status).toBe("Submitted");
    expect(raiseMoment).toHaveBeenCalledTimes(1);
  });

  it("reports an already-posted invoice as posted without posting again", async () => {
    const { client, invoke } = fakeClient({
      salesInvoice: [draftInvoice({ status: "Submitted" })]
    });
    expect(await postSalesInvoiceUnattended({ client, db, ...args })).toEqual({
      outcome: "posted"
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("leaves a held draft alone", async () => {
    const { client, invoke, tables } = fakeClient({
      salesInvoice: [draftInvoice({ automationHoldReason: "Charges" })]
    });
    expect(await postSalesInvoiceUnattended({ client, db, ...args })).toEqual({
      outcome: "held",
      reason: "Charges"
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(tables.salesInvoice![0]!.status).toBe("Draft");
  });

  it("holds on a sales rule violation and stays Draft", async () => {
    evaluateSalesRules.mockResolvedValue({
      violations: [{ message: "Not sold to Canada" }]
    });
    const { client, invoke, tables } = fakeClient({
      salesInvoice: [draftInvoice()]
    });
    const result = await postSalesInvoiceUnattended({ client, db, ...args });
    expect(result).toEqual({
      outcome: "held",
      reason: "Sales rule: Not sold to Canada"
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(tables.salesInvoice![0]).toMatchObject({
      status: "Draft",
      automationHoldReason: "Sales rule: Not sold to Canada"
    });
  });

  it("holds when the customer misses its required contact", async () => {
    contactRequirement.mockResolvedValue("Acme needs a contact with an email");
    const { client, tables } = fakeClient({ salesInvoice: [draftInvoice()] });
    expect(await postSalesInvoiceUnattended({ client, db, ...args })).toEqual({
      outcome: "held",
      reason: "Acme needs a contact with an email"
    });
    expect(tables.salesInvoice![0]!.automationHoldReason).toBe(
      "Acme needs a contact with an email"
    );
  });

  it("skips when another poster already claimed it", async () => {
    const { client, invoke } = fakeClient({
      salesInvoice: [draftInvoice({ status: "Pending" })]
    });
    expect(await postSalesInvoiceUnattended({ client, db, ...args })).toEqual({
      outcome: "skipped",
      reason: "Invoice is Pending"
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("puts a failed post left Pending back to Draft with the reason", async () => {
    const { client, tables } = fakeClient(
      { salesInvoice: [draftInvoice()] },
      () => {
        throw new Error("gateway timeout");
      }
    );
    expect(await postSalesInvoiceUnattended({ client, db, ...args })).toEqual({
      outcome: "held",
      reason: "gateway timeout"
    });
    expect(tables.salesInvoice![0]).toMatchObject({
      status: "Draft",
      automationHoldReason: "gateway timeout"
    });
  });

  it("holds with the edge function's error when it reset the invoice", async () => {
    const { client, tables } = fakeClient(
      { salesInvoice: [draftInvoice()] },
      (rows) => {
        rows.salesInvoice![0]!.status = "Draft";
        return { error: { message: "Accounting period is closed" } };
      }
    );
    expect(await postSalesInvoiceUnattended({ client, db, ...args })).toEqual({
      outcome: "held",
      reason: "Accounting period is closed"
    });
    expect(tables.salesInvoice![0]!.automationHoldReason).toBe(
      "Accounting period is closed"
    );
    expect(raiseMoment).not.toHaveBeenCalled();
  });
});

describe("emailPostedInvoice", () => {
  const posted = (overrides: Row = {}) =>
    draftInvoice({ status: "Submitted", ...overrides });
  const baseTables = (invoice: Row, email: string | null = "ap@buyer.com") => ({
    salesInvoice: [invoice],
    customerContact: [
      {
        id: "cc-1",
        companyId: "co-1",
        contact: { email, firstName: "Ana", lastName: "Buyer" }
      }
    ],
    company: [{ id: "co-1", name: "Acme Rentals", companyGroupId: "g-1" }],
    companySettings: [
      {
        id: "co-1",
        accountsReceivableEmail: "ar@acme.com",
        defaultCustomerCc: ["ops@acme.com"]
      }
    ],
    customer: [{ id: "cust-1", companyId: "co-1", defaultCc: [] }],
    salesInvoiceLine: [],
    document: []
  });

  it("never sends an invoice twice", async () => {
    const { client } = fakeClient(
      baseTables(posted({ sentAt: "2026-10-01T05:00:00Z" }))
    );
    expect(await emailPostedInvoice({ client, ...args })).toEqual({
      emailed: false
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("records why when the contact has no email", async () => {
    const { client, tables } = fakeClient(baseTables(posted(), null));
    expect(await emailPostedInvoice({ client, ...args })).toEqual({
      emailed: false,
      sendError: INVOICE_SEND_NO_EMAIL
    });
    expect(tables.salesInvoice![0]!.sendError).toBe(INVOICE_SEND_NO_EMAIL);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends from the company, replies to receivables, and stamps it sent", async () => {
    const { client, tables } = fakeClient(baseTables(posted()));
    const result = await emailPostedInvoice({ client, ...args });
    expect(result).toEqual({
      emailed: true,
      sentTo: "ap@buyer.com, ops@acme.com, ar@acme.com"
    });
    const sent = sendEmail.mock.calls[0]![0];
    expect(sent).toMatchObject({
      from: '"Acme Rentals" <no-reply@carbon.ms>',
      to: "ap@buyer.com",
      replyTo: "ar@acme.com",
      subject: "Invoice INV-1 from Acme Rentals"
    });
    expect(sent.attachments[0].filename).toBe("Acme - INV-1.pdf");
    expect(tables.salesInvoice![0]).toMatchObject({
      sentTo: "ap@buyer.com, ops@acme.com, ar@acme.com",
      sendError: null
    });
    expect(tables.salesInvoice![0]!.sentAt).toEqual(expect.any(String));
    expect(tables.document).toHaveLength(1);
  });

  it("stamps the send error and leaves it unsent when delivery fails", async () => {
    sendEmail.mockResolvedValue({
      data: null,
      error: new Error("550 mailbox unavailable")
    });
    const { client, tables } = fakeClient(baseTables(posted()));
    expect(await emailPostedInvoice({ client, ...args })).toEqual({
      emailed: false,
      sendError: "550 mailbox unavailable"
    });
    expect(tables.salesInvoice![0]).toMatchObject({
      sentAt: null,
      sendError: "550 mailbox unavailable"
    });
  });
});

describe("sendPostedInvoiceViaStripe", () => {
  const posted = (overrides: Row = {}) =>
    draftInvoice({
      status: "Submitted",
      invoiceCustomerId: null,
      ...overrides
    });
  const stripeTables = (invoice: Row, links: Row[] = []) => ({
    salesInvoice: [invoice],
    companyIntegration: [
      {
        id: "stripe-connect",
        companyId: "co-1",
        active: true,
        metadata: { chargesEnabled: true, stripeAccountId: "acct_1" }
      }
    ],
    externalIntegrationMapping: links
  });
  const customerLink = (entityId: string): Row => ({
    entityType: "customer",
    entityId,
    integration: "stripe-connect",
    companyId: "co-1",
    externalId: `cus_${entityId}`
  });

  it("holds the send when the billing customer has no Stripe customer", async () => {
    // Linked as the sold-to customer, but the bill-to customer is not.
    const { client, tables } = fakeClient(
      stripeTables(posted({ invoiceCustomerId: "cust-2" }), [
        customerLink("cust-1")
      ])
    );
    expect(await sendPostedInvoiceViaStripe({ client, db, ...args })).toEqual({
      emailed: false,
      sendError: INVOICE_SEND_NO_STRIPE
    });
    expect(tables.salesInvoice![0]).toMatchObject({
      sentAt: null,
      sendError: INVOICE_SEND_NO_STRIPE
    });
    expect(stripeSend).not.toHaveBeenCalled();
  });

  it("sends to the linked Stripe customer and stamps it sent via Stripe", async () => {
    const { client, tables } = fakeClient(
      stripeTables(posted(), [customerLink("cust-1")])
    );
    expect(await sendPostedInvoiceViaStripe({ client, db, ...args })).toEqual({
      emailed: true,
      sentTo: "Stripe"
    });
    expect(stripeSend.mock.calls[0]![0]).toMatchObject({
      stripeAccountId: "acct_1",
      stripeCustomerId: "cus_cust-1"
    });
    expect(tables.salesInvoice![0]).toMatchObject({
      sentTo: "Stripe",
      sendError: null
    });
    expect(tables.salesInvoice![0]!.sentAt).toEqual(expect.any(String));
  });

  it("never sends an invoice already linked to a Stripe invoice", async () => {
    const { client, tables } = fakeClient(
      stripeTables(posted(), [
        customerLink("cust-1"),
        {
          entityType: "salesInvoice",
          entityId: "inv-1",
          integration: "stripe-connect",
          companyId: "co-1",
          externalId: "in_0"
        }
      ])
    );
    expect(await sendPostedInvoiceViaStripe({ client, db, ...args })).toEqual({
      emailed: true,
      sentTo: "Stripe"
    });
    expect(stripeSend).not.toHaveBeenCalled();
    expect(tables.salesInvoice![0]!.sentTo).toBe("Stripe");
  });

  it("stamps the Stripe error and leaves it unsent when the send fails", async () => {
    stripeSend.mockRejectedValue(new Error("No such customer: cus_cust-1"));
    const { client, tables } = fakeClient(
      stripeTables(posted(), [customerLink("cust-1")])
    );
    expect(await sendPostedInvoiceViaStripe({ client, db, ...args })).toEqual({
      emailed: false,
      sendError: "No such customer: cus_cust-1"
    });
    expect(tables.salesInvoice![0]).toMatchObject({
      sentAt: null,
      sendError: "No such customer: cus_cust-1"
    });
  });
});

describe("email headers", () => {
  it("names the company on the platform address", () => {
    expect(
      companyFromAddress("Acme Rentals", "Carbon <no-reply@carbon.ms>")
    ).toBe('"Acme Rentals" <no-reply@carbon.ms>');
    expect(companyFromAddress('Bob "B" Co', "no-reply@carbon.ms")).toBe(
      '"Bob B Co" <no-reply@carbon.ms>'
    );
  });

  it("prefers the customer's CC over the company's and never repeats the recipient", () => {
    expect(
      invoiceEmailCc({
        to: "ap@buyer.com",
        customerDefaultCc: ["boss@buyer.com", "AP@buyer.com"],
        companyDefaultCc: ["ops@acme.com"],
        receivablesEmail: "ar@acme.com"
      })
    ).toEqual(["boss@buyer.com", "ar@acme.com"]);
    expect(
      invoiceEmailCc({
        to: "ap@buyer.com",
        customerDefaultCc: null,
        companyDefaultCc: ["ops@acme.com", "ar@acme.com"],
        receivablesEmail: "ar@acme.com"
      })
    ).toEqual(["ops@acme.com", "ar@acme.com"]);
  });
});
