import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  Heading,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useFetcher, useLoaderData } from "react-router";
import { New } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import {
  getIntercompanyDocumentLinks,
  getIntercompanyTransactions,
  getNettingMatrix,
  getNettingStatements
} from "~/modules/accounting";
import {
  IntercompanyBalanceMatrix,
  IntercompanyTransactionTable,
  MirroringTab,
  NettingTab
} from "~/modules/accounting/ui/Intercompany";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Intercompany`,
  to: path.to.intercompany
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const status = searchParams.get("status");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [transactions, nettingMatrix, nettingStatements, documentLinks] =
    await Promise.all([
      getIntercompanyTransactions(client, companyGroupId, {
        status,
        limit,
        offset,
        sorts,
        filters
      }),
      getNettingMatrix(client, companyGroupId),
      getNettingStatements(client, companyGroupId, {
        status: null,
        limit,
        offset,
        sorts,
        filters
      }),
      getIntercompanyDocumentLinks(client, companyGroupId, {
        status: null,
        limit,
        offset,
        sorts,
        filters
      })
    ]);

  return {
    transactions: transactions.data ?? [],
    transactionsCount: transactions.count ?? 0,
    nettingMatrix: nettingMatrix.data ?? [],
    nettingStatements: nettingStatements.data ?? [],
    nettingStatementsCount: nettingStatements.count ?? 0,
    documentLinks: documentLinks.data ?? [],
    documentLinksCount: documentLinks.count ?? 0
  };
}

export default function IntercompanyRoute() {
  const {
    transactions,
    transactionsCount,
    nettingMatrix,
    nettingStatements,
    nettingStatementsCount,
    documentLinks,
    documentLinksCount
  } = useLoaderData<typeof loader>();
  const [params] = useUrlParams();
  const permissions = usePermissions();
  const matchFetcher = useFetcher();
  const eliminateFetcher = useFetcher();

  const tab = params.get("tab") ?? "matching";

  // The netting matrix carries both directional gross receivables per pair.
  // Derive a receivables balance matrix from it as a header for the matching tab.
  const balanceEntries = nettingMatrix.flatMap((row) => [
    {
      sourceCompanyId: row.companyAId,
      sourceCompanyName: row.companyAName,
      targetCompanyId: row.companyBId,
      targetCompanyName: row.companyBName,
      balance: row.grossReceivableAtoB
    },
    {
      sourceCompanyId: row.companyBId,
      sourceCompanyName: row.companyBName,
      targetCompanyId: row.companyAId,
      targetCompanyName: row.companyAName,
      balance: row.grossReceivableBtoA
    }
  ]);

  return (
    <Tabs defaultValue={tab} className="w-full h-full">
      <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full">
        <Heading size="h3">Intercompany</Heading>
        <TabsList>
          <TabsTrigger value="matching">Matching</TabsTrigger>
          <TabsTrigger value="netting">Netting</TabsTrigger>
          <TabsTrigger value="mirroring">Mirroring</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="matching">
        <VStack spacing={4} className="p-4">
          <IntercompanyBalanceMatrix data={balanceEntries} />
          <IntercompanyTransactionTable
            data={transactions}
            count={transactionsCount}
            primaryAction={
              permissions.can("create", "accounting") && (
                <div className="flex items-center gap-2">
                  <matchFetcher.Form method="post" action="match">
                    <Button
                      variant="secondary"
                      type="submit"
                      isLoading={matchFetcher.state !== "idle"}
                    >
                      Run Matching
                    </Button>
                  </matchFetcher.Form>
                  <eliminateFetcher.Form method="post" action="eliminate">
                    <Button
                      variant="secondary"
                      type="submit"
                      isLoading={eliminateFetcher.state !== "idle"}
                    >
                      Generate Eliminations
                    </Button>
                  </eliminateFetcher.Form>
                  <New label="IC Transaction" to={`new?${params.toString()}`} />
                </div>
              )
            }
          />
        </VStack>
      </TabsContent>

      <TabsContent value="netting">
        <NettingTab
          matrix={nettingMatrix}
          statements={nettingStatements}
          statementsCount={nettingStatementsCount}
        />
      </TabsContent>

      <TabsContent value="mirroring">
        <MirroringTab links={documentLinks} linksCount={documentLinksCount} />
      </TabsContent>

      <Outlet />
    </Tabs>
  );
}
