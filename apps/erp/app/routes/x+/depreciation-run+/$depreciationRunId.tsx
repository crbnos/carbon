import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { LuEllipsisVertical, LuRepeat, LuTrash } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { usePermissions, useSettings, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import {
  getDepreciationRun,
  getDepreciationRunLines
} from "~/modules/accounting";
import { DepreciationRunStatus } from "~/modules/accounting/ui/FixedAssets";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Depreciation",
  to: path.to.depreciationRuns
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });

  const { depreciationRunId } = params;
  if (!depreciationRunId) throw new Error("Could not find depreciationRunId");

  const [run, lines] = await Promise.all([
    getDepreciationRun(client, depreciationRunId),
    getDepreciationRunLines(client, depreciationRunId)
  ]);

  if (run.error) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(run.error, "Failed to load depreciation run"))
    );
  }

  return {
    run: run.data,
    lines: lines.data ?? []
  };
}

export default function DepreciationRunDetailRoute() {
  const { depreciationRunId } = useParams();
  const { run, lines } = useLoaderData<typeof loader>();
  const settings = useSettings();
  const taxDepreciationEnabled =
    (settings as any).assetTaxDepreciationEnabled ?? false;
  const permissions = usePermissions();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });
  const deleteModal = useDisclosure();
  const repeatModal = useDisclosure();

  if (!depreciationRunId) throw new Error("Could not find depreciationRunId");

  const isDraft = run.status === "Draft";
  const isPosted = run.status === "Posted";
  const totalAmount = lines.reduce((sum, line) => sum + Number(line.amount), 0);
  const totalTaxAmount = taxDepreciationEnabled
    ? lines.reduce((sum, line) => sum + Number((line as any).taxAmount ?? 0), 0)
    : 0;

  const gridCols = taxDepreciationEnabled
    ? "grid-cols-[auto_1fr_1fr_120px_120px_120px_120px_120px]"
    : "grid-cols-[auto_1fr_1fr_120px_120px_120px_120px]";

  return (
    <div className="flex h-[calc(100dvh-49px)] overflow-y-auto scrollbar-hide w-full">
      <div className="h-full p-4 pb-16 w-full max-w-5xl mx-auto">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <HStack>
              <Heading as="h1" size="h3">
                {run.depreciationRunId}
              </Heading>
              <Copy text={run.depreciationRunId} />
              {(isDraft || isPosted) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="More options"
                      icon={<LuEllipsisVertical />}
                      variant="secondary"
                      size="sm"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {isPosted && (
                      <DropdownMenuItem
                        disabled={!permissions.can("create", "accounting")}
                        onClick={repeatModal.onOpen}
                      >
                        <DropdownMenuIcon icon={<LuRepeat />} />
                        Repeat Run
                      </DropdownMenuItem>
                    )}
                    {isDraft && (
                      <DropdownMenuItem
                        disabled={!permissions.can("delete", "accounting")}
                        destructive
                        onClick={deleteModal.onOpen}
                      >
                        <DropdownMenuIcon icon={<LuTrash />} />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <DepreciationRunStatus status={run.status} />
            </HStack>
            <HStack>
              {isDraft && permissions.can("update", "accounting") && (
                <fetcher.Form method="post" action="post">
                  <Button
                    variant="primary"
                    type="submit"
                    isLoading={fetcher.state !== "idle"}
                  >
                    Post Run
                  </Button>
                </fetcher.Form>
              )}
            </HStack>
          </CardHeader>

          <CardContent>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-3 w-full mb-6">
              <div>
                <p className="text-sm text-muted-foreground">Period End</p>
                <p className="text-sm">{formatDate(run.periodEnd)}</p>
              </div>
              {run.postedAt && (
                <div>
                  <p className="text-sm text-muted-foreground">Posted At</p>
                  <p className="text-sm">{formatDate(run.postedAt)}</p>
                </div>
              )}
            </div>

            {/* Depreciation Lines */}
            <div className="rounded-lg border border-border overflow-hidden w-full">
              {/* Column Headers */}
              <div
                className={`grid ${gridCols} items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground font-medium bg-muted/50 border-b border-border`}
              >
                <div className="w-6" />
                <div>Asset</div>
                <div>Name</div>
                <div className="text-right">Cost</div>
                <div className="text-right">Accum. Depr.</div>
                <div className="text-right">Amount</div>
                {taxDepreciationEnabled && (
                  <div className="text-right">Tax Amount</div>
                )}
                <div className="text-right">NBV After</div>
              </div>

              {/* Lines */}
              <div className="divide-y divide-border">
                {lines.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                    No assets to depreciate for this period.
                  </div>
                ) : (
                  lines.map((line, index) => {
                    const asset = line.fixedAsset as any;
                    const cost = Number(asset?.acquisitionCost ?? 0);
                    const accDepr = Number(asset?.accumulatedDepreciation ?? 0);
                    const nbvAfter = cost - accDepr - Number(line.amount);
                    return (
                      <div
                        key={line.id}
                        className={`grid ${gridCols} items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors`}
                      >
                        <div className="w-6 text-muted-foreground tabular-nums">
                          {index + 1}
                        </div>
                        <div>
                          {asset?.id ? (
                            <Link
                              to={path.to.fixedAsset(asset.id)}
                              className="text-foreground hover:underline"
                            >
                              {asset.fixedAssetId ?? "—"}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </div>
                        <div className="text-muted-foreground">
                          {asset?.name ?? "—"}
                        </div>
                        <div className="text-right tabular-nums">
                          {currencyFormatter.format(cost)}
                        </div>
                        <div className="text-right tabular-nums">
                          {currencyFormatter.format(accDepr)}
                        </div>
                        <div className="text-right tabular-nums font-medium">
                          {currencyFormatter.format(Number(line.amount))}
                        </div>
                        {taxDepreciationEnabled && (
                          <div className="text-right tabular-nums font-medium">
                            {currencyFormatter.format(
                              Number((line as any).taxAmount ?? 0)
                            )}
                          </div>
                        )}
                        <div className="text-right tabular-nums">
                          {currencyFormatter.format(nbvAfter)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Totals */}
              {lines.length > 0 && (
                <div
                  className={`grid ${gridCols} items-center gap-3 px-4 py-3 bg-muted/50 border-t border-border`}
                >
                  <div className="w-6" />
                  <div className="text-sm font-medium">
                    {lines.length} {lines.length === 1 ? "Asset" : "Assets"}
                  </div>
                  <div />
                  <div />
                  <div />
                  <div className="text-right font-mono text-sm tabular-nums font-medium">
                    {currencyFormatter.format(totalAmount)}
                  </div>
                  {taxDepreciationEnabled && (
                    <div className="text-right font-mono text-sm tabular-nums font-medium">
                      {currencyFormatter.format(totalTaxAmount)}
                    </div>
                  )}
                  <div />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Outlet />

        <ConfirmDelete
          action={path.to.deleteDepreciationRun(depreciationRunId)}
          isOpen={deleteModal.isOpen}
          name={run.depreciationRunId}
          text={`Are you sure you want to delete ${run.depreciationRunId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={() => {
            deleteModal.onClose();
            navigate(path.to.depreciationRuns);
          }}
        />

        <Confirm
          action={path.to.repeatDepreciationRun(depreciationRunId)}
          isOpen={repeatModal.isOpen}
          title="Repeat Run"
          text={`This will create a new draft depreciation run for the same period (${formatDate(run.periodEnd)}), including only active assets not already covered by an existing run.`}
          confirmText="Create Repeat Run"
          onCancel={repeatModal.onClose}
          onSubmit={repeatModal.onClose}
        />
      </div>
    </div>
  );
}
