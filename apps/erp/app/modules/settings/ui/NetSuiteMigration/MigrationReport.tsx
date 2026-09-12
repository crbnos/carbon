import { GAP_CATALOG } from "@carbon/netsuite/gaps";
import { PLAN_SECTIONS, type PlanSection } from "@carbon/netsuite/plan";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { MigrationRunReport } from "~/modules/settings";

/**
 * What the migration did, and what it left behind.
 *
 * The gap list is the reason this screen exists. A one-click migration that
 * quietly leaves things behind is worse than one that leaves the same things
 * behind and says so — the customer finds the hole at month-end close instead of
 * on day one. The prose comes from `@carbon/netsuite`'s gap catalog; the run only
 * stores which gaps applied and what they cost THIS account.
 */

const SECTION_LABELS: Record<PlanSection, string> = {
  currencies: "Currencies",
  unitsOfMeasure: "Units of measure",
  paymentTerms: "Payment terms",
  shippingMethods: "Shipping methods",
  locations: "Locations",
  departments: "Departments",
  accounts: "Chart of accounts",
  customerTypes: "Customer types",
  supplierTypes: "Supplier types",
  customers: "Customers",
  suppliers: "Suppliers",
  items: "Items",
  supplierParts: "Supplier parts",
  billsOfMaterial: "Bills of material",
  openingStock: "Opening stock",
  salesOrders: "Sales orders",
  purchaseOrders: "Purchase orders"
};

const SEVERITY_VARIANT = {
  high: "destructive",
  medium: "secondary",
  low: "outline"
} as const;

export function MigrationReport({
  report,
  dryRun
}: {
  report: MigrationRunReport;
  dryRun: boolean;
}) {
  const { t } = useLingui();

  const rows = PLAN_SECTIONS.map((section) => ({
    section,
    label: SECTION_LABELS[section],
    extracted: report.extracted[section] ?? 0,
    counts: report.counts[section] ?? { inserted: 0, updated: 0, skipped: 0 }
  })).filter((row) => row.extracted > 0 || row.counts.inserted > 0);

  const gaps = report.gaps
    .map((gap) => {
      const definition = GAP_CATALOG.find((entry) => entry.id === gap.id);
      return definition ? { ...definition, ...gap } : null;
    })
    .filter((gap): gap is NonNullable<typeof gap> => gap !== null);

  return (
    <VStack spacing={4} className="w-full">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            {dryRun ? (
              <Trans>What a migration would bring across</Trans>
            ) : (
              <Trans>What came across</Trans>
            )}
          </CardTitle>
          <CardDescription>
            <Trans>
              Every record keeps a link back to the NetSuite record it came
              from, so running this again updates rather than duplicates.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs">
                  <th className="text-left font-medium py-1.5">
                    <Trans>Records</Trans>
                  </th>
                  <th className="text-right font-medium py-1.5">
                    <Trans>Found</Trans>
                  </th>
                  <th className="text-right font-medium py-1.5">
                    <Trans>Created</Trans>
                  </th>
                  <th className="text-right font-medium py-1.5">
                    <Trans>Updated</Trans>
                  </th>
                  <th className="text-right font-medium py-1.5">
                    <Trans>Already there</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.section} className="border-t">
                    <td className="py-1.5">{row.label}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {row.extracted.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {row.counts.inserted.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {row.counts.updated.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {row.counts.skipped.toLocaleString()}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr className="border-t">
                    <td
                      colSpan={5}
                      className="py-3 text-center text-muted-foreground"
                    >
                      <Trans>
                        Nothing was found to migrate. Check that the NetSuite
                        role you connected can read these records.
                      </Trans>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {report.warnings.length > 0 && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>
              <Trans>Records that needed a decision</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                These came across, but something about them did not line up
                exactly.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm list-disc pl-5 space-y-1">
              {report.warnings.map((warning) => (
                <li key={warning} className="text-muted-foreground">
                  {warning}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {report.notes.length > 0 && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>
              <Trans>About this NetSuite account</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm list-disc pl-5 space-y-1">
              {report.notes.map((note) => (
                <li key={note} className="text-muted-foreground">
                  {note}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            <Trans>What stays in NetSuite</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              A migration cannot bring everything. This is the complete list of
              what it did not, and what to do about each one.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VStack spacing={3} className="w-full">
            {gaps.map((gap) => (
              <VStack
                key={gap.id}
                spacing={1}
                className="w-full border rounded-lg p-3"
              >
                <HStack className="w-full justify-between items-start gap-2">
                  <span className="text-sm font-medium">{gap.title}</span>
                  <HStack spacing={2} className="shrink-0">
                    {gap.count !== null && gap.count > 0 && (
                      <Badge variant="outline">
                        {t`${gap.count.toLocaleString()} records`}
                      </Badge>
                    )}
                    <Badge variant={SEVERITY_VARIANT[gap.severity]}>
                      {gap.id}
                    </Badge>
                  </HStack>
                </HStack>
                <p className="text-xs text-muted-foreground">{gap.detail}</p>
                {gap.examples.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {gap.examples.join(" · ")}
                  </p>
                )}
                <p className="text-xs">
                  <span className="font-medium">
                    <Trans>What to do instead:</Trans>{" "}
                  </span>
                  <span className="text-muted-foreground">
                    {gap.workaround}
                  </span>
                </p>
              </VStack>
            ))}
            {gaps.length === 0 && (
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Nothing this migration leaves behind applies to your account.
                </Trans>
              </p>
            )}
          </VStack>
        </CardContent>
      </Card>
    </VStack>
  );
}
