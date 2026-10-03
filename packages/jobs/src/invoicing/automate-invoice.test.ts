// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FunctionsHttpError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// External boundaries only: SMTP, the PDF renderer, the rule engine and the
// party-contact policy (each reads its own tables), Inngest, storage, env.
const sendEmail = vi.fn();
const evaluateSalesRules = vi.fn();
const contactRequirement = vi.fn();
const raiseMoment = vi.fn();

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
vi.mock("@carbon/lib/party-contact.server", () => ({
  checkPartyContactRequirement: (...args: unknown[]) =>
    contactRequirement(...args)
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
  invoiceEmailCc,
  postSalesInvoiceUnattended
} from "./automate-invoice";

type Row = Record<string, unknown>;

/** A tiny in-memory PostgREST: filters, updates and inserts on plain rows. */
function fakeClient(
  tables: Record<string, Row[]>,
  onInvoke: (rows: Record<string, Row[]>) => { error: Error | null } = () => ({
    error: null
  })
) {
  const invoke = vi.fn(async () => onInvoke(tables));
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
    client: { from, functions: { invoke } } as never,
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

beforeEach(() => {
  vi.clearAllMocks();
  evaluateSalesRules.mockResolvedValue({ violations: [] });
  contactRequirement.mockResolvedValue(null);
  sendEmail.mockResolvedValue({ data: { id: "msg-1" }, error: null });
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
    expect(await postSalesInvoiceUnattended({ client, ...args })).toEqual({
      outcome: "posted"
    });
    expect(tables.salesInvoice![0]!.status).toBe("Submitted");
    expect(raiseMoment).toHaveBeenCalledTimes(1);
  });

  it("reports an already-posted invoice as posted without posting again", async () => {
    const { client, invoke } = fakeClient({
      salesInvoice: [draftInvoice({ status: "Submitted" })]
    });
    expect(await postSalesInvoiceUnattended({ client, ...args })).toEqual({
      outcome: "posted"
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("leaves a held draft alone", async () => {
    const { client, invoke, tables } = fakeClient({
      salesInvoice: [draftInvoice({ automationHoldReason: "Charges" })]
    });
    expect(await postSalesInvoiceUnattended({ client, ...args })).toEqual({
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
    const result = await postSalesInvoiceUnattended({ client, ...args });
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
    expect(await postSalesInvoiceUnattended({ client, ...args })).toEqual({
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
    expect(await postSalesInvoiceUnattended({ client, ...args })).toEqual({
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
    expect(await postSalesInvoiceUnattended({ client, ...args })).toEqual({
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
        // What supabase-js hands back for a non-2xx: a fixed message, the
        // edge function's reason in the response body.
        return {
          error: new FunctionsHttpError(
            new Response(
              JSON.stringify({ message: "Accounting period is closed" }),
              { status: 500 }
            )
          )
        };
      }
    );
    expect(await postSalesInvoiceUnattended({ client, ...args })).toEqual({
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
