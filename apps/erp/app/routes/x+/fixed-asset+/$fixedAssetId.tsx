import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  BarProgress,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useDisclosure
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import {
  LuChevronDown,
  LuCircleX,
  LuClipboardCheck,
  LuHistory,
  LuPencil,
  LuShoppingCart,
  LuStore,
  LuTrash
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  redirect,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { DocumentHeader } from "~/components";
import { AuditLogDrawer } from "~/components/AuditLog";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useSettings, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import {
  getAssetDepreciationHistory,
  getFixedAsset,
  getFixedAssetDisposal
} from "~/modules/accounting";
import {
  DepreciationRunStatus,
  FixedAssetNotes,
  FixedAssetStatus
} from "~/modules/accounting/ui/FixedAssets";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Fixed Assets",
  to: path.to.fixedAssets
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw new Error("Could not find fixedAssetId");

  const [asset, depreciationHistory, disposal] = await Promise.all([
    getFixedAsset(client, fixedAssetId),
    getAssetDepreciationHistory(client, fixedAssetId),
    getFixedAssetDisposal(client, fixedAssetId)
  ]);

  if (asset.error) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(asset.error, "Failed to load fixed asset"))
    );
  }

  return {
    asset: asset.data,
    depreciationHistory: depreciationHistory.data ?? [],
    disposal: disposal.data
  };
}

export default function FixedAssetDetailRoute() {
  const { fixedAssetId } = useParams();
  const { asset, depreciationHistory, disposal } =
    useLoaderData<typeof loader>();
  const settings = useSettings();
  const taxDepreciationEnabled =
    (settings as any).assetTaxDepreciationEnabled ?? false;
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });
  const deleteModal = useDisclosure();
  const auditDrawer = useDisclosure();

  if (!fixedAssetId) throw new Error("Could not find fixedAssetId");

  const acquisitionCost = Number(asset.acquisitionCost);
  const accumulatedDepreciation = Number(asset.accumulatedDepreciation);
  const nbv = acquisitionCost - accumulatedDepreciation;
  const depreciationPercent =
    acquisitionCost > 0
      ? Math.min(100, (accumulatedDepreciation / acquisitionCost) * 100)
      : 0;

  const accumulatedTaxDepreciation = Number(
    (asset as any).accumulatedTaxDepreciation ?? 0
  );
  const taxNbv = acquisitionCost - accumulatedTaxDepreciation;
  const taxDepreciationPercent =
    acquisitionCost > 0
      ? Math.min(100, (accumulatedTaxDepreciation / acquisitionCost) * 100)
      : 0;

  const isDraft = asset.status === "Draft";
  const isActive =
    asset.status === "Active" || asset.status === "Fully Depreciated";
  const canUpdate = permissions.can("update", "accounting");

  return (
    <div className="flex h-[calc(100dvh-49px)] overflow-y-auto scrollbar-hide w-full">
      <div className="h-full p-4 pb-16 w-full max-w-5xl mx-auto space-y-4">
        {/* Main Details */}
        <Card>
          <DocumentHeader
            title={asset.fixedAssetId ?? ""}
            status={<FixedAssetStatus status={asset.status as any} />}
            menuItems={
              <>
                <DropdownMenuItem onClick={auditDrawer.onOpen}>
                  <DropdownMenuIcon icon={<LuHistory />} />
                  History
                </DropdownMenuItem>
                {isDraft && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!permissions.can("delete", "accounting")}
                      destructive
                      onClick={deleteModal.onOpen}
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </>
            }
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="primary"
                    size="md"
                    rightIcon={<LuChevronDown />}
                  >
                    Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={!canUpdate} asChild>
                    <Link to={path.to.fixedAssetDetails(fixedAssetId)}>
                      <DropdownMenuIcon icon={<LuPencil />} />
                      Edit
                    </Link>
                  </DropdownMenuItem>
                  {isDraft && (
                    <>
                      <DropdownMenuItem disabled={!canUpdate} asChild>
                        <Link to={path.to.fixedAssetRegister(fixedAssetId)}>
                          <DropdownMenuIcon icon={<LuClipboardCheck />} />
                          Register
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to={path.to.fixedAssetPurchase(fixedAssetId)}>
                          <DropdownMenuIcon icon={<LuShoppingCart />} />
                          Purchase
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                  {isActive && (
                    <>
                      <DropdownMenuItem asChild>
                        <Link to={path.to.fixedAssetSell(fixedAssetId)}>
                          <DropdownMenuIcon icon={<LuStore />} />
                          Sell
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem disabled={!canUpdate} asChild>
                        <Link to={path.to.fixedAssetDispose(fixedAssetId)}>
                          <DropdownMenuIcon icon={<LuCircleX />} />
                          Dispose
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
          <CardContent className="space-y-0">
            <div
              className={`grid grid-cols-1 gap-3 sm:gap-0 pb-4 ${taxDepreciationEnabled ? "sm:grid-cols-5" : "sm:grid-cols-3"}`}
            >
              <div className="sm:pr-6">
                <p className="text-base text-muted-foreground truncate sm:text-sm">
                  Acquisition Cost
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                  {currencyFormatter.format(acquisitionCost)}
                </p>
              </div>
              <div className="sm:border-l sm:border-border sm:px-6">
                <p className="text-base text-muted-foreground truncate sm:text-sm">
                  Accum. Depreciation
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                  {currencyFormatter.format(accumulatedDepreciation)}
                </p>
              </div>
              <div
                className={`sm:border-l sm:border-border ${taxDepreciationEnabled ? "sm:px-6" : "sm:pl-6"}`}
              >
                <p className="text-base text-muted-foreground truncate sm:text-sm">
                  Net Book Value
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                  {currencyFormatter.format(nbv)}
                </p>
              </div>
              {taxDepreciationEnabled && (
                <>
                  <div className="sm:border-l sm:border-border sm:px-6">
                    <p className="text-base text-muted-foreground truncate sm:text-sm">
                      Accum. Tax Depr.
                    </p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                      {currencyFormatter.format(accumulatedTaxDepreciation)}
                    </p>
                  </div>
                  <div className="sm:border-l sm:border-border sm:pl-6">
                    <p className="text-base text-muted-foreground truncate sm:text-sm">
                      Tax Book Value
                    </p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                      {currencyFormatter.format(taxNbv)}
                    </p>
                  </div>
                </>
              )}
            </div>
            <div className="divide-y divide-border border-t border-border">
              <DetailRow label="Name">{asset.name}</DetailRow>
              <DetailRow label="Asset Class">
                <Enumerable
                  value={(asset.fixedAssetClass as any)?.name ?? null}
                />
              </DetailRow>
              <DetailRow label="Serial Number">
                {asset.serialNumber || "—"}
              </DetailRow>
              <DetailRow label="Location">
                <Enumerable value={(asset as any).location?.name ?? null} />
              </DetailRow>
              <DetailRow label="Depreciation Method">
                {asset.depreciationMethod}
              </DetailRow>
              <DetailRow label="Useful Life">
                {asset.usefulLifeMonths} months
              </DetailRow>
              <DetailRow label="Residual Value">
                {Number(asset.residualValuePercent)}%
              </DetailRow>
              {taxDepreciationEnabled && (
                <>
                  <DetailRow label="Tax Depreciation Method">
                    {(asset as any).taxDepreciationMethod || "—"}
                  </DetailRow>
                  {(asset as any).taxDepreciationMethod === "MACRS" ? (
                    <>
                      <DetailRow label="MACRS Property Class">
                        {(asset as any).macrsPropertyClass
                          ? `${(asset as any).macrsPropertyClass}-Year`
                          : "—"}
                      </DetailRow>
                      <DetailRow label="MACRS Convention">
                        {(asset as any).macrsConvention || "—"}
                      </DetailRow>
                      <DetailRow label="Bonus Depreciation">
                        {(asset as any).bonusDepreciationPercent != null
                          ? `${Number((asset as any).bonusDepreciationPercent)}%`
                          : "—"}
                      </DetailRow>
                    </>
                  ) : (
                    <>
                      <DetailRow label="Tax Useful Life">
                        {(asset as any).taxUsefulLifeMonths
                          ? `${(asset as any).taxUsefulLifeMonths} months`
                          : "—"}
                      </DetailRow>
                      <DetailRow label="Tax Residual Value">
                        {(asset as any).taxResidualValuePercent != null
                          ? `${Number((asset as any).taxResidualValuePercent)}%`
                          : "—"}
                      </DetailRow>
                    </>
                  )}
                </>
              )}
              <DetailRow label="Acquisition Date">
                {asset.acquisitionDate
                  ? formatDate(asset.acquisitionDate)
                  : "—"}
              </DetailRow>
              <DetailRow label="Depreciation Start">
                {asset.depreciationStartDate
                  ? formatDate(asset.depreciationStartDate)
                  : "—"}
              </DetailRow>
            </div>
          </CardContent>
        </Card>

        {/* Depreciation History */}
        {(depreciationHistory.length > 0 || acquisitionCost > 0) && (
          <Card>
            <CardHeader>
              <CardTitle>Depreciation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {acquisitionCost > 0 && (
                <div className="space-y-4">
                  <BarProgress
                    progress={depreciationPercent}
                    label="Book Depreciation"
                    value={`${depreciationPercent.toFixed(1)}%`}
                    gradient
                  />
                  {taxDepreciationEnabled && (
                    <BarProgress
                      progress={taxDepreciationPercent}
                      label="Tax Depreciation"
                      value={`${taxDepreciationPercent.toFixed(1)}%`}
                      gradient
                    />
                  )}
                </div>
              )}
              {depreciationHistory.length > 0 && (
                <div className="overflow-x-auto -mx-6 px-6">
                  <table className="w-full text-base sm:text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                          Run
                        </th>
                        <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                          Period End
                        </th>
                        <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                          Status
                        </th>
                        <th className="text-right py-2.5 sm:py-2 font-medium text-muted-foreground">
                          Amount
                        </th>
                        {taxDepreciationEnabled && (
                          <th className="text-right py-2.5 sm:py-2 font-medium text-muted-foreground">
                            Tax Amount
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {depreciationHistory.map((item) => {
                        const run = item.depreciationRun as any;
                        return (
                          <tr
                            key={item.id}
                            className="border-b border-border last:border-0"
                          >
                            <td className="py-3 sm:py-2.5 tabular-nums">
                              <Link
                                to={path.to.depreciationRun(run?.id ?? item.id)}
                                className="text-foreground hover:underline"
                              >
                                {run?.depreciationRunId ?? "—"}
                              </Link>
                            </td>
                            <td className="py-3 sm:py-2.5">
                              {run?.periodEnd ? formatDate(run.periodEnd) : "—"}
                            </td>
                            <td className="py-3 sm:py-2.5">
                              <DepreciationRunStatus
                                status={run?.status ?? null}
                              />
                            </td>
                            <td className="py-3 sm:py-2.5 text-right tabular-nums">
                              {currencyFormatter.format(Number(item.amount))}
                            </td>
                            {taxDepreciationEnabled && (
                              <td className="py-3 sm:py-2.5 text-right tabular-nums">
                                {currencyFormatter.format(
                                  Number((item as any).taxAmount ?? 0)
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        <FixedAssetNotes
          key={`notes-${fixedAssetId}`}
          id={fixedAssetId}
          notes={asset.notes as JSONContent}
        />

        {/* Disposal */}
        {disposal && (
          <Card>
            <CardContent className="pt-6">
              <div className="divide-y divide-border">
                <DetailRow label="Disposal Method">
                  {disposal.disposalMethod}
                </DetailRow>
                <DetailRow label="Disposal Date">
                  {formatDate(disposal.disposalDate)}
                </DetailRow>
                <DetailRow label="NBV at Disposal">
                  <span className="tabular-nums">
                    {currencyFormatter.format(
                      Number(disposal.netBookValueAtDisposal)
                    )}
                  </span>
                </DetailRow>
                <DetailRow label="Sale Proceeds">
                  <span className="tabular-nums">
                    {currencyFormatter.format(Number(disposal.saleProceeds))}
                  </span>
                </DetailRow>
                <DetailRow label="Gain/Loss">
                  <Badge
                    variant={Number(disposal.gainLoss) >= 0 ? "green" : "red"}
                  >
                    {currencyFormatter.format(Number(disposal.gainLoss))}
                  </Badge>
                </DetailRow>
              </div>
            </CardContent>
          </Card>
        )}

        <Outlet />

        <ConfirmDelete
          action={path.to.deleteFixedAsset(fixedAssetId)}
          isOpen={deleteModal.isOpen}
          name={asset.fixedAssetId}
          text={`Are you sure you want to delete ${asset.fixedAssetId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={() => {
            deleteModal.onClose();
            navigate(path.to.fixedAssets);
          }}
        />
      </div>
      <AuditLogDrawer
        isOpen={auditDrawer.isOpen}
        onClose={auditDrawer.onClose}
        entityType="fixedAsset"
        entityId={fixedAssetId}
        companyId={company.id}
      />
    </div>
  );
}

function DetailRow({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3 text-base sm:text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
