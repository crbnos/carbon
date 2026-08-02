import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { memo, useMemo } from "react";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { nettingStatementStatuses } from "../../accounting.models";
import NettingStatementStatus from "./NettingStatementStatus";

type NettingStatementLine = {
  id: string;
  companyId: string;
  appliedAmount: number;
  openAmount: number;
  salesInvoiceId: string | null;
  purchaseInvoiceId: string | null;
};

type NettingStatement = {
  id: string;
  statementId: string;
  companyAId: string;
  companyBId: string;
  currencyCode: string;
  nettedAmount: number;
  residualAmount: number;
  residualPayerCompanyId: string | null;
  status: string;
  companyA: { name: string } | null;
  companyB: { name: string } | null;
  lines: NettingStatementLine[];
};

type NettingStatementDrawerProps = {
  statement: NettingStatement;
  onClose: () => void;
};

const NettingStatementDrawer = memo(
  ({ statement, onClose }: NettingStatementDrawerProps) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const proposeFetcher = useFetcher();
    const agreeFetcher = useFetcher();
    const settleFetcher = useFetcher();
    const cancelFetcher = useFetcher();

    const canUpdate = permissions.can("update", "accounting");
    const status =
      statement.status as (typeof nettingStatementStatuses)[number];

    const formatAmount = (amount: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: statement.currencyCode || "USD"
      }).format(amount);

    const companyName = (companyId: string) =>
      companyId === statement.companyAId
        ? (statement.companyA?.name ?? companyId)
        : companyId === statement.companyBId
          ? (statement.companyB?.name ?? companyId)
          : companyId;

    // Group lines by company, then by AR (sales invoice) vs AP (purchase invoice).
    const grouped = useMemo(() => {
      const byCompany = new Map<
        string,
        { ar: NettingStatementLine[]; ap: NettingStatementLine[] }
      >();
      for (const line of statement.lines) {
        const bucket = byCompany.get(line.companyId) ?? { ar: [], ap: [] };
        if (line.salesInvoiceId) {
          bucket.ar.push(line);
        } else if (line.purchaseInvoiceId) {
          bucket.ap.push(line);
        }
        byCompany.set(line.companyId, bucket);
      }
      return Array.from(byCompany.entries());
    }, [statement.lines]);

    const anyBusy =
      proposeFetcher.state !== "idle" ||
      agreeFetcher.state !== "idle" ||
      settleFetcher.state !== "idle" ||
      cancelFetcher.state !== "idle";

    return (
      <Drawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DrawerContent size="lg">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <span>{statement.statementId}</span>
              <NettingStatementStatus status={status} />
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              <div className="grid grid-cols-2 gap-4 w-full">
                <VStack spacing={0}>
                  <span className="text-xs text-muted-foreground">
                    <Trans>Company A</Trans>
                  </span>
                  <span className="text-sm font-medium">
                    {statement.companyA?.name ?? "—"}
                  </span>
                </VStack>
                <VStack spacing={0}>
                  <span className="text-xs text-muted-foreground">
                    <Trans>Company B</Trans>
                  </span>
                  <span className="text-sm font-medium">
                    {statement.companyB?.name ?? "—"}
                  </span>
                </VStack>
                <VStack spacing={0}>
                  <span className="text-xs text-muted-foreground">
                    <Trans>Netted Amount</Trans>
                  </span>
                  <span className="text-sm font-medium">
                    {formatAmount(statement.nettedAmount)}
                  </span>
                </VStack>
                <VStack spacing={0}>
                  <span className="text-xs text-muted-foreground">
                    <Trans>Residual</Trans>
                  </span>
                  <span className="text-sm font-medium">
                    {formatAmount(statement.residualAmount)}
                    {statement.residualPayerCompanyId &&
                    statement.residualAmount > 0 ? (
                      <span className="text-muted-foreground">
                        {" "}
                        ({companyName(statement.residualPayerCompanyId)})
                      </span>
                    ) : null}
                  </span>
                </VStack>
              </div>

              {grouped.map(([companyId, buckets]) => (
                <div key={companyId} className="w-full">
                  <h3 className="text-sm font-semibold mb-2">
                    {companyName(companyId)}
                  </h3>
                  <LineGroup
                    label={t`Receivables`}
                    lines={buckets.ar}
                    formatAmount={formatAmount}
                  />
                  <LineGroup
                    label={t`Payables`}
                    lines={buckets.ap}
                    formatAmount={formatAmount}
                  />
                </div>
              ))}
            </VStack>
          </DrawerBody>
          {canUpdate && (
            <DrawerFooter>
              <HStack spacing={2}>
                {status === "Draft" && (
                  <proposeFetcher.Form
                    method="post"
                    action={`${path.to.intercompanyNettingStatement(statement.id)}/propose`}
                  >
                    <Button
                      type="submit"
                      isDisabled={anyBusy}
                      isLoading={proposeFetcher.state !== "idle"}
                    >
                      <Trans>Propose</Trans>
                    </Button>
                  </proposeFetcher.Form>
                )}
                {status === "Proposed" && (
                  <agreeFetcher.Form
                    method="post"
                    action={`${path.to.intercompanyNettingStatement(statement.id)}/agree`}
                  >
                    <Button
                      type="submit"
                      isDisabled={anyBusy}
                      isLoading={agreeFetcher.state !== "idle"}
                    >
                      <Trans>Agree</Trans>
                    </Button>
                  </agreeFetcher.Form>
                )}
                {status === "Agreed" && (
                  <settleFetcher.Form
                    method="post"
                    action={`${path.to.intercompanyNettingStatement(statement.id)}/settle`}
                  >
                    <Button
                      type="submit"
                      isDisabled={anyBusy}
                      isLoading={settleFetcher.state !== "idle"}
                    >
                      <Trans>Settle</Trans>
                    </Button>
                  </settleFetcher.Form>
                )}
                {(status === "Draft" ||
                  status === "Proposed" ||
                  status === "Agreed") && (
                  <cancelFetcher.Form
                    method="post"
                    action={`${path.to.intercompanyNettingStatement(statement.id)}/cancel`}
                  >
                    <Button
                      variant="secondary"
                      type="submit"
                      isDisabled={anyBusy}
                      isLoading={cancelFetcher.state !== "idle"}
                    >
                      <Trans>Cancel</Trans>
                    </Button>
                  </cancelFetcher.Form>
                )}
              </HStack>
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>
    );
  }
);

NettingStatementDrawer.displayName = "NettingStatementDrawer";
export default NettingStatementDrawer;

function LineGroup({
  label,
  lines,
  formatAmount
}: {
  label: string;
  lines: NettingStatementLine[];
  formatAmount: (amount: number) => string;
}) {
  if (lines.length === 0) return null;
  return (
    <div className="mb-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <table className="w-full text-sm mt-1">
        <thead>
          <tr className="border-b">
            <th className="text-left p-1 font-medium text-muted-foreground">
              <Trans>Invoice</Trans>
            </th>
            <th className="text-right p-1 font-medium text-muted-foreground">
              <Trans>Open</Trans>
            </th>
            <th className="text-right p-1 font-medium text-muted-foreground">
              <Trans>Applied</Trans>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b">
              <td className="p-1">
                {line.salesInvoiceId || line.purchaseInvoiceId || "—"}
              </td>
              <td className="text-right p-1">
                {formatAmount(line.openAmount)}
              </td>
              <td className="text-right p-1">
                {formatAmount(line.appliedAmount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
