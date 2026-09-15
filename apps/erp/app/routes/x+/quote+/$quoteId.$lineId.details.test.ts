import { beforeEach, describe, expect, it, vi } from "vitest";

// The action writes through Kysely by line id alone, so the company-scoped
// line read at the top of it is the only company check on the write. Pin that
// a line the read cannot find is refused before anything is written.

const mocks = vi.hoisted(() => ({
  saveQuoteLineWithPrices: vi.fn(),
  flash: vi.fn(async (_request: Request, result: { message: string }) => ({
    headers: { "X-Flash": result.message }
  })),
  line: null as { itemId: string } | null
}));

function fakeServiceRole() {
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: mocks.line, error: null }),
    // The price read is awaited without a terminal method.
    then: (resolve: (value: unknown) => unknown) =>
      resolve({ data: [], error: null })
  };
  return { from: () => builder };
}

vi.mock("@carbon/auth", () => ({
  assertIsPost: vi.fn(),
  error: (_error: unknown, message: string) => ({ success: false, message })
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn(async () => ({
    client: {},
    companyId: "company-1",
    userId: "user-1"
  }))
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => fakeServiceRole()
}));
vi.mock("@carbon/auth/session.server", () => ({ flash: mocks.flash }));
vi.mock("@carbon/form", () => ({
  validationError: vi.fn(),
  validator: () => ({
    validate: async () => ({
      data: {
        id: "line-1",
        quoteId: "quote-1",
        itemId: "item-1",
        methodType: "Make to Stock",
        quantity: [1]
      },
      error: undefined
    })
  })
}));
vi.mock("@carbon/react", () => ({ VStack: () => null }));
vi.mock("@lingui/react/macro", () => ({ useLingui: vi.fn() }));
vi.mock("~/components", () => ({ CadModel: vi.fn(), DeferredFiles: vi.fn() }));
vi.mock("~/hooks", () => ({}));
vi.mock("~/modules/sales", () => ({
  getQuote: vi.fn(async () => ({ data: { status: "Draft" }, error: null })),
  isQuoteLocked: () => false,
  quoteLineValidator: {},
  reconcileQuantityBreaks: () => ({ added: [], removed: [] })
}));
vi.mock("~/modules/sales/sales.server", () => ({
  getQuoteLineItemIssue: vi.fn(async () => null),
  saveQuoteLineWithPrices: mocks.saveQuoteLineWithPrices
}));
vi.mock("~/modules/sales/ui/Opportunity", () => ({}));
vi.mock("~/modules/sales/ui/Quotes", () => ({}));
vi.mock("~/modules/sales/ui/Quotes/QuoteLinePricingHistory", () => ({
  default: () => null
}));
vi.mock("~/modules/sales/ui/Quotes/QuoteLineRiskRegister", () => ({
  default: () => null
}));
vi.mock("~/modules/shared", () => ({}));
vi.mock("~/utils/form", () => ({
  getCustomFields: vi.fn(),
  setCustomFields: () => ({})
}));
vi.mock("~/utils/lockedGuard.server", () => ({
  requireUnlocked: vi.fn(async () => undefined)
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: {
      quote: (quoteId: string) => `/x/quote/${quoteId}`,
      quoteLine: (quoteId: string, lineId: string) =>
        `/x/quote/${quoteId}/${lineId}/details`
    }
  }
}));
vi.mock("~/utils/supabase", () => ({
  sanitize: (value: unknown) => value
}));

const { action } = await import("./$quoteId.$lineId.details");

async function runAction() {
  try {
    await action({
      request: new Request("http://localhost", {
        method: "POST",
        body: new URLSearchParams()
      }),
      params: { quoteId: "quote-1", lineId: "line-1" },
      context: {}
    } as never);
  } catch (thrown) {
    if (!(thrown instanceof Response)) throw thrown;
    return thrown;
  }
  throw new Error("expected the action to throw a redirect");
}

describe("quote line details action", () => {
  beforeEach(() => {
    mocks.saveQuoteLineWithPrices.mockReset();
    mocks.flash.mockClear();
  });

  it("refuses a line that is not in the caller's company, before any write", async () => {
    mocks.line = null;

    const response = await runAction();

    expect(response.headers.get("Location")).toBe("/x/quote/quote-1");
    expect(response.headers.get("X-Flash")).toBe("Failed to find quote line");
    expect(mocks.saveQuoteLineWithPrices).not.toHaveBeenCalled();
  });

  it("saves a line the company-scoped read finds", async () => {
    mocks.line = { itemId: "item-1" };

    const response = await runAction();

    expect(response.headers.get("Location")).toBe(
      "/x/quote/quote-1/line-1/details"
    );
    expect(mocks.saveQuoteLineWithPrices).toHaveBeenCalledOnce();
    expect(mocks.saveQuoteLineWithPrices.mock.calls[0][0].lineId).toBe(
      "line-1"
    );
  });
});
