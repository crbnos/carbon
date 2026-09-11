import type { Database } from "@carbon/database";
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermissions = vi.hoisted(() => vi.fn());
const getCardTransaction = vi.hoisted(() => vi.fn());
const flash = vi.hoisted(() => vi.fn(async () => ({})));
const EmptyComponent = vi.hoisted(() => () => null);

vi.mock("@carbon/auth", () => ({
  error: (cause: unknown, message: string) => ({ cause, message })
}));
vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions }));
vi.mock("@carbon/auth/session.server", () => ({ flash }));
vi.mock("@carbon/react", () => ({
  Button: EmptyComponent,
  Drawer: EmptyComponent,
  DrawerBody: EmptyComponent,
  DrawerContent: EmptyComponent,
  DrawerFooter: EmptyComponent,
  DrawerHeader: EmptyComponent,
  DrawerTitle: EmptyComponent,
  HStack: EmptyComponent,
  Table: EmptyComponent,
  Tbody: EmptyComponent,
  Td: EmptyComponent,
  Th: EmptyComponent,
  Thead: EmptyComponent,
  Tr: EmptyComponent,
  useDisclosure: vi.fn(),
  VStack: EmptyComponent
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: EmptyComponent,
  useLingui: vi.fn()
}));
vi.mock("@react-aria/i18n", () => ({ useLocale: vi.fn() }));
vi.mock("~/components/Enumerable", () => ({ Enumerable: EmptyComponent }));
vi.mock("~/components/Modals", () => ({ Confirm: EmptyComponent }));
vi.mock("~/hooks", () => ({
  useCurrencyFormatter: vi.fn(),
  usePermissions: vi.fn()
}));
vi.mock("~/modules/invoicing", () => ({
  CardTransactionStatus: EmptyComponent,
  getCardTransaction
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: {
      cardTransactions: "/x/invoicing/card-transactions",
      cardTransactionVoid: (id: string) =>
        `/x/invoicing/card-transactions/${id}/void`,
      file: { previewFile: (value: string) => value }
    }
  }
}));

import { loader } from "./card-transactions.$id";

type FailingTable = "account" | "document" | null;

function clientFor(failingTable: FailingTable = null) {
  const requests: URL[] = [];
  const client = createClient<Database>("http://card-detail.test", "key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        const table = url.pathname.split("/").at(-1);
        if (table === failingTable) {
          return Response.json(
            { message: `${table} lookup failed`, code: "XX000" },
            { status: 500 }
          );
        }
        if (table === "account") {
          return Response.json([
            { id: "card-account", number: "2100", name: "Card Liability" },
            { id: "expense-account", number: "6100", name: "Travel" }
          ]);
        }
        if (table === "document") {
          return Response.json([
            {
              id: "receipt-1",
              name: "receipt.pdf",
              path: "company-a/card-transaction/card-1/receipt.pdf"
            }
          ]);
        }
        return Response.json([]);
      }
    }
  });
  return { client, requests };
}

async function runLoader(client: ReturnType<typeof clientFor>["client"]) {
  requirePermissions.mockResolvedValue({
    client,
    companyId: "company-a",
    companyGroupId: "group-a"
  });
  return loader({
    request: new Request(
      "http://localhost/x/invoicing/card-transactions/card-1"
    ),
    params: { id: "card-1" },
    context: {}
  } as never);
}

describe("card transaction detail loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCardTransaction.mockResolvedValue({
      data: {
        id: "card-1",
        companyId: "company-a",
        cardAccountId: "card-account",
        offsetAccountId: null,
        cardTransactionLine: [{ id: "line-1", accountId: "expense-account" }]
      },
      error: null
    });
  });

  it("scopes the primary, account, and document reads to their tenant owner", async () => {
    const { client, requests } = clientFor();

    const result = await runLoader(client);

    expect(getCardTransaction).toHaveBeenCalledWith(
      client,
      "company-a",
      "card-1"
    );
    const accountRequest = requests.find((url) =>
      url.pathname.endsWith("/account")
    );
    expect(accountRequest?.searchParams.get("companyGroupId")).toBe(
      "eq.group-a"
    );
    expect(accountRequest?.searchParams.has("companyId")).toBe(false);
    const documentRequest = requests.find((url) =>
      url.pathname.endsWith("/document")
    );
    expect(documentRequest?.searchParams.get("companyId")).toBe("eq.company-a");
    expect(result.accountsById["expense-account"]).toMatchObject({
      number: "6100",
      name: "Travel"
    });
    expect(result.receipts).toHaveLength(1);
  });

  it.each([
    "account",
    "document"
  ] as const)("fails closed when the %s auxiliary read fails", async (table) => {
    const { client } = clientFor(table);

    await expect(runLoader(client)).rejects.toMatchObject({ status: 302 });

    expect(flash).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        cause: expect.objectContaining({ message: `${table} lookup failed` }),
        message: "Failed to load card transaction"
      })
    );
  });
});
