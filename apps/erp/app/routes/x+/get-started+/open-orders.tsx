import { assertIsPost, error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  getImplementationFieldValues,
  upsertFieldValue
} from "@carbon/onboarding/server";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  Tbody,
  Td,
  Textarea,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useRef, useState } from "react";
import {
  LuArrowUpRight,
  LuCircleCheck,
  LuFileStack,
  LuLoaderCircle,
  LuShoppingCart,
  LuSparkles,
  LuTruck,
  LuUpload
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { useUser } from "~/hooks";
import { getLocationsList } from "~/modules/resources";
import { path } from "~/utils/path";
import {
  type AppliedOpenOrders,
  appliedOpenOrdersSchema,
  applyOpenOrders,
  extractOpenOrders,
  matchOpenOrders,
  type OpenOrderApplyOutcome,
  type OpenOrderKind,
  type OpenOrdersProposal,
  readOpenOrdersUpload
} from "./open-orders.server";

// Open orders — the switch-week importer. Paste or upload whatever the old
// system exports (or plain notes); the AI extracts order headers + lines; we
// match suppliers/customers/items against what's already in Carbon; the
// customer reviews the proposal; applying creates DRAFT purchase / sales
// orders through the existing services. Drafts only — every order still gets
// reviewed on its own screen before anything is sent, released, or received.

const OPEN_ORDERS_FIELD_KEY = "switch.openOrdersImportedAt";

const parseValidator = z.object({
  intent: z.literal("parse"),
  kind: z.enum(["po", "so"]),
  text: z.string().max(60000).optional(),
  uploadPath: z.string().optional(),
  uploadName: z.string().optional()
});

const applyValidator = z.object({
  intent: z.literal("apply"),
  kind: z.enum(["po", "so"]),
  locationId: z.string().optional(),
  orders: z.string().min(1)
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const poCount = () =>
    client
      .from("purchaseOrder")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId);
  const soCount = () =>
    client
      .from("salesOrder")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId);

  const [locations, fieldValues, poDraft, poOpen, soDraft, soOpen] =
    await Promise.all([
      getLocationsList(client, companyId),
      getImplementationFieldValues(client, companyId),
      poCount().eq("status", "Draft"),
      poCount().in("status", [
        "To Receive",
        "To Receive and Invoice",
        "To Invoice"
      ]),
      soCount().eq("status", "Draft"),
      soCount().in("status", [
        "In Progress",
        "To Ship and Invoice",
        "To Ship",
        "To Invoice"
      ])
    ]);

  const lastImportedAt =
    fieldValues.data?.find((f) => f.fieldKey === OPEN_ORDERS_FIELD_KEY)
      ?.value ?? null;

  return {
    locations: locations.data ?? [],
    lastImportedAt,
    counts: {
      poDraft: poDraft.count ?? 0,
      poOpen: poOpen.count ?? 0,
      soDraft: soDraft.count ?? 0,
      soOpen: soOpen.count ?? 0
    }
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    // Read the pasted text or uploaded file, extract orders, and match them
    // against existing suppliers/customers/items — READ ONLY. Nothing is
    // written until the customer applies the reviewed proposal.
    case "parse": {
      const validation = await validator(parseValidator).validate(formData);
      if (validation.error) {
        return validationError(validation.error);
      }
      const { kind, text, uploadPath, uploadName } = validation.data;

      const { client, companyId } = await requirePermissions(request, {
        view: kind === "po" ? "purchasing" : "sales"
      });

      let source: string | null = null;
      if (uploadPath) {
        // Only files this flow uploaded for this company are readable here.
        if (!uploadPath.startsWith(`${companyId}/open-orders/`)) {
          return data(
            { intent: "parse" as const, kind, success: false as const },
            await flash(request, error(null, "Invalid upload path"))
          );
        }
        source = await readOpenOrdersUpload(client, {
          uploadPath,
          uploadName: uploadName ?? uploadPath
        });
      } else if (text?.trim()) {
        source = text;
      }

      if (!source?.trim()) {
        // Unreadable file / empty paste — reported plainly, never guessed.
        return data({
          intent: "parse" as const,
          kind,
          success: false as const
        });
      }

      const orders = await extractOpenOrders({ kind, source });
      if (!orders || orders.length === 0) {
        return data({
          intent: "parse" as const,
          kind,
          success: false as const
        });
      }

      const proposal = await matchOpenOrders(client, {
        kind,
        companyId,
        orders
      });
      if (!proposal) {
        return data(
          { intent: "parse" as const, kind, success: false as const },
          await flash(request, error(null, "Failed to match your orders"))
        );
      }

      return data({
        intent: "parse" as const,
        kind,
        success: true as const,
        proposal
      });
    }

    // Create the reviewed orders as DRAFTS through the existing services —
    // sequentially, one try/catch per order, per-order outcomes back to the
    // customer. Never released, sent, or received from here.
    case "apply": {
      const validation = await validator(applyValidator).validate(formData);
      if (validation.error) {
        return validationError(validation.error);
      }
      const { kind, locationId } = validation.data;

      const { client, companyId, companyGroupId, userId } =
        await requirePermissions(request, {
          create: kind === "po" ? "purchasing" : "sales",
          bypassRls: true
        });

      let orders: AppliedOpenOrders;
      try {
        orders = appliedOpenOrdersSchema.parse(
          JSON.parse(validation.data.orders)
        );
      } catch (err) {
        return data(
          { intent: "apply" as const, kind, success: false as const },
          await flash(request, error(err, "Invalid orders payload"))
        );
      }
      if (orders.length === 0) {
        return data({
          intent: "apply" as const,
          kind,
          success: false as const
        });
      }

      // Sales orders (and their lines) need a location — default it the same
      // way the new-sales-order screen does: an explicit, verified pick.
      let resolvedLocationId: string | null = null;
      if (kind === "so") {
        if (!locationId) {
          return data(
            { intent: "apply" as const, kind, success: false as const },
            await flash(
              request,
              error(null, "A location is required for sales orders")
            )
          );
        }
        const location = await client
          .from("location")
          .select("id")
          .eq("id", locationId)
          .eq("companyId", companyId)
          .maybeSingle();
        if (!location.data) {
          return data(
            { intent: "apply" as const, kind, success: false as const },
            await flash(request, error(null, "Location not found"))
          );
        }
        resolvedLocationId = location.data.id;
      }

      const outcomes = await applyOpenOrders(client, {
        kind,
        companyId,
        companyGroupId,
        userId,
        locationId: resolvedLocationId,
        orders
      });

      // Idempotency-light: remember that an import happened so re-entry says
      // so instead of looking untouched.
      if (outcomes.some((outcome) => outcome.orderId)) {
        await upsertFieldValue(client, {
          companyId,
          fieldKey: OPEN_ORDERS_FIELD_KEY,
          value: new Date().toISOString(),
          userId
        });
      }

      return data({
        intent: "apply" as const,
        kind,
        success: true as const,
        outcomes
      });
    }

    default:
      return data(
        { intent: "unknown" as const, success: false as const },
        await flash(request, error(null, "Invalid intent"))
      );
  }
}

export default function OpenOrdersRoute() {
  const { locations, lastImportedAt, counts } = useLoaderData<typeof loader>();

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <LuFileStack className="size-3.5" />
          <Trans>Open orders</Trans>
        </div>
        <h1 className="text-3xl font-semibold">
          <Trans>Paste it. We read it. You approve the drafts.</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans>
            The purchase orders you're still waiting to receive and the customer
            orders you still owe need to exist in Carbon on day one. Paste or
            upload whatever your old system exports — we read it, match it
            against your suppliers, customers, and items, and create draft
            orders for your review. Drafts only: nothing is sent, released, or
            received from here.
          </Trans>
        </p>
        {lastImportedAt ? (
          <p className="text-xs text-muted-foreground">
            <Trans>
              Last imported {new Date(lastImportedAt).toLocaleDateString()} —
              importing again creates additional drafts, it never edits existing
              orders.
            </Trans>
          </p>
        ) : null}
      </div>

      <ImporterSection
        kind="po"
        draftCount={counts.poDraft}
        openCount={counts.poOpen}
        locations={locations}
      />
      <ImporterSection
        kind="so"
        draftCount={counts.soDraft}
        openCount={counts.soOpen}
        locations={locations}
      />
    </div>
  );
}

function ImporterSection({
  kind,
  draftCount,
  openCount,
  locations
}: {
  kind: OpenOrderKind;
  draftCount: number;
  openCount: number;
  locations: { id: string; name: string }[];
}) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();

  const parseFetcher = useFetcher<typeof action>();
  const applyFetcher = useFetcher<typeof action>();

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"idle" | "applied">("idle");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  const isParsing = parseFetcher.state !== "idle";
  const isApplying = applyFetcher.state !== "idle";

  const parseData =
    parseFetcher.state === "idle" &&
    parseFetcher.data &&
    "intent" in parseFetcher.data &&
    parseFetcher.data.intent === "parse" &&
    "kind" in parseFetcher.data &&
    parseFetcher.data.kind === kind
      ? parseFetcher.data
      : null;
  const proposal: OpenOrdersProposal | null =
    parseData?.success && "proposal" in parseData ? parseData.proposal : null;
  const parseFailed = parseData ? !parseData.success : false;

  const applyData =
    applyFetcher.state === "idle" &&
    applyFetcher.data &&
    "intent" in applyFetcher.data &&
    applyFetcher.data.intent === "apply" &&
    "kind" in applyFetcher.data &&
    applyFetcher.data.kind === kind &&
    applyFetcher.data.success &&
    "outcomes" in applyFetcher.data
      ? applyFetcher.data
      : null;
  const outcomes: OpenOrderApplyOutcome[] | null = applyData?.outcomes ?? null;
  const applyFailed =
    phase === "applied" && applyFetcher.state === "idle" && !applyData;

  const readyOrders = proposal?.orders.filter((o) => o.partyId !== null) ?? [];
  const unmatchedParties =
    proposal?.orders.filter((o) => o.partyId === null) ?? [];
  const problemLines = readyOrders.flatMap((order) =>
    order.lines
      .filter((line) => line.reason !== "matched")
      .map((line) => ({ order, line }))
  );

  const needsLocation = kind === "so";
  const canApply =
    readyOrders.length > 0 &&
    !isApplying &&
    (!needsLocation || locationId !== "");

  const submitParse = (fields: Record<string, string>) => {
    setPhase("idle");
    parseFetcher.submit(
      { intent: "parse", kind, ...fields },
      { method: "post" }
    );
  };

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Allow re-selecting the same file after a failure.
    event.target.value = "";
    if (!file || !carbon) return;

    setUploadFailed(false);
    setIsUploading(true);
    const extension = file.name.split(".").pop() ?? "csv";
    const storagePath = `${company.id}/open-orders/${nanoid()}.${extension}`;
    const uploaded = await carbon.storage
      .from("private")
      .upload(storagePath, file);
    setIsUploading(false);

    if (uploaded.error || !uploaded.data) {
      setUploadFailed(true);
      return;
    }

    submitParse({ uploadPath: uploaded.data.path, uploadName: file.name });
  };

  const onApply = () => {
    if (!proposal || readyOrders.length === 0) return;
    setPhase("applied");
    applyFetcher.submit(
      {
        intent: "apply",
        kind,
        ...(needsLocation ? { locationId } : {}),
        orders: JSON.stringify(
          readyOrders.map((order) => ({
            reference: order.reference,
            partyName: order.partyName,
            partyId: order.partyId,
            orderDate: order.orderDate,
            neededBy: order.neededBy,
            lines: order.lines.map((line) => ({
              itemId: line.reason === "matched" ? line.itemId : null,
              partNumber: line.partNumber,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice
            }))
          }))
        )
      },
      { method: "post" }
    );
  };

  const orderUrl = (id: string) =>
    kind === "po" ? path.to.purchaseOrder(id) : path.to.salesOrder(id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          {kind === "po" ? (
            <LuShoppingCart className="size-4 text-muted-foreground" />
          ) : (
            <LuTruck className="size-4 text-muted-foreground" />
          )}
          {kind === "po" ? (
            <Trans>Open purchase orders</Trans>
          ) : (
            <Trans>Open customer orders</Trans>
          )}
        </h2>
        <p className="text-sm text-muted-foreground">
          {kind === "po" ? (
            <Trans>
              Everything you're still waiting to receive from suppliers — so
              day-one material arrivals have a purchase order to receive
              against. Prioritize by expected receipt date.
            </Trans>
          ) : (
            <Trans>
              Everything you still owe customers — so you can ship and invoice
              from Carbon on day one. Orders due in the next 30 days first.
            </Trans>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {kind === "po" ? (
            <Trans>
              Already in Carbon: {draftCount} draft and {openCount} in-flight
              purchase orders.
            </Trans>
          ) : (
            <Trans>
              Already in Carbon: {draftCount} draft and {openCount} in-flight
              customer orders.
            </Trans>
          )}
        </p>
      </div>

      {/* Input — paste or upload */}
      <div className="rounded-xl border bg-card px-5 py-4 flex flex-col gap-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={60000}
          placeholder={
            kind === "po"
              ? t`Paste your open PO list — a CSV export, a report, or plain notes ("PO-1042, Acme Steel, 40 × 1018 bar, due Aug 12...")`
              : t`Paste your open order list — a CSV export, a report, or plain notes ("SO-2210, Vandelay, 12 × pump housing, ships Aug 5...")`
          }
        />
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            className="hidden"
            onChange={onFileChange}
          />
          <Button
            leftIcon={
              isParsing && !isUploading ? (
                <LuLoaderCircle className="animate-spin" />
              ) : (
                <LuSparkles />
              )
            }
            isDisabled={isUploading || isParsing || !text.trim()}
            onClick={() => submitParse({ text })}
          >
            {isParsing ? <Trans>Reading…</Trans> : <Trans>Read it</Trans>}
          </Button>
          <Button
            variant="secondary"
            leftIcon={
              isUploading ? (
                <LuLoaderCircle className="animate-spin" />
              ) : (
                <LuUpload />
              )
            }
            isDisabled={isUploading || isParsing}
            onClick={() => fileRef.current?.click()}
          >
            {isUploading ? (
              <Trans>Uploading…</Trans>
            ) : (
              <Trans>Upload a file instead</Trans>
            )}
          </Button>
        </div>
        {uploadFailed ? (
          <p className="text-sm text-destructive">
            <Trans>The upload didn't go through — try again.</Trans>
          </p>
        ) : null}
        {parseFailed ? (
          <p className="text-sm text-destructive">
            <Trans>
              We couldn't read that. Try a CSV/XLSX export or cleaner pasted
              text — we never guess at orders. Up to 40 orders per read; import
              in batches if you have more.
            </Trans>
          </p>
        ) : null}
      </div>

      {/* Applied — per-order results */}
      {phase === "applied" && outcomes ? (
        <div className="rounded-xl border bg-card px-5 py-4 flex flex-col gap-3">
          <div className="text-sm font-medium flex items-center gap-1.5">
            <LuCircleCheck className="size-4 text-emerald-500" />
            {kind === "po" ? (
              <Trans>
                {outcomes.filter((o) => o.orderId).length} draft purchase orders
                created
              </Trans>
            ) : (
              <Trans>
                {outcomes.filter((o) => o.orderId).length} draft sales orders
                created
              </Trans>
            )}
          </div>
          <ul className="flex flex-col gap-1.5 text-sm">
            {outcomes.map((outcome, index) => (
              <li key={index} className="flex items-start gap-2">
                {outcome.orderId && outcome.readableId ? (
                  <>
                    <a
                      href={orderUrl(outcome.orderId)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1 shrink-0"
                    >
                      {outcome.readableId}
                      <LuArrowUpRight className="size-3.5" />
                    </a>
                    <span className="text-muted-foreground">
                      {outcome.partyName}
                      {outcome.reference ? ` · ${outcome.reference}` : ""} —{" "}
                      <Trans>{outcome.linesCreated} lines</Trans>
                      {outcome.commentLines > 0 ? (
                        <>
                          {", "}
                          <Trans>{outcome.commentLines} comment lines</Trans>
                        </>
                      ) : null}
                      {outcome.linesSkipped > 0 ? (
                        <>
                          {", "}
                          <Trans>{outcome.linesSkipped} skipped</Trans>
                        </>
                      ) : null}
                      {outcome.linesFailed > 0 ? (
                        <>
                          {", "}
                          <span className="text-destructive">
                            <Trans>{outcome.linesFailed} failed</Trans>
                          </span>
                        </>
                      ) : null}
                    </span>
                  </>
                ) : (
                  <span className="text-destructive">
                    {outcome.reference ?? outcome.partyName} —{" "}
                    {outcome.error === "partyNotFound" ? (
                      kind === "po" ? (
                        <Trans>
                          the supplier wasn't found in Carbon, so no draft was
                          created
                        </Trans>
                      ) : (
                        <Trans>
                          the customer wasn't found in Carbon, so no draft was
                          created
                        </Trans>
                      )
                    ) : (
                      <Trans>creating the draft failed — try again</Trans>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            {kind === "po" ? (
              <Trans>
                These are drafts — open each one, check supplier, dates,
                quantities, and prices, and take it from there yourself.
                Prioritize the ones with the earliest expected receipt dates.
              </Trans>
            ) : (
              <Trans>
                These are drafts — open each one, check customer, dates,
                quantities, and prices, and take it from there yourself.
                Prioritize the ones due to ship soonest.
              </Trans>
            )}
          </p>
        </div>
      ) : null}

      {applyFailed ? (
        <p className="text-sm text-destructive">
          <Trans>Creating the drafts failed — try again.</Trans>
        </p>
      ) : null}

      {/* Review — the proposal */}
      {proposal && !(phase === "applied" && outcomes) ? (
        <div className="rounded-xl border bg-card px-5 py-4 flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium">
              <Trans>
                Review — we found {proposal.orders.length} orders,{" "}
                {readyOrders.length} ready to create
              </Trans>
            </div>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Every value below came from your file or paste — we never invent
                references, dates, quantities, or prices. Totals are shown only
                where the source had prices.
              </Trans>
            </p>
          </div>

          <div className="max-h-80 overflow-y-auto rounded-lg border">
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Order</Trans>
                  </Th>
                  <Th>
                    {kind === "po" ? (
                      <Trans>Supplier</Trans>
                    ) : (
                      <Trans>Customer</Trans>
                    )}
                  </Th>
                  <Th>
                    {kind === "po" ? (
                      <Trans>Expected</Trans>
                    ) : (
                      <Trans>Due</Trans>
                    )}
                  </Th>
                  <Th className="text-right">
                    <Trans>Lines</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Total</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {proposal.orders.map((order, index) => {
                  const matched = order.lines.filter(
                    (line) => line.reason === "matched"
                  ).length;
                  return (
                    <Tr key={index}>
                      <Td>{order.reference ?? "—"}</Td>
                      <Td>
                        {order.partyId ? (
                          <span className="inline-flex items-center gap-1">
                            <LuCircleCheck className="size-3.5 text-emerald-500 shrink-0" />
                            {order.partyMatchedName ?? order.partyName}
                          </span>
                        ) : (
                          <span className="text-destructive">
                            {order.partyName} ·{" "}
                            {order.partyDetail === "ambiguousParty" ? (
                              <Trans>ambiguous</Trans>
                            ) : (
                              <Trans>no match</Trans>
                            )}
                          </span>
                        )}
                      </Td>
                      <Td>{order.neededBy ?? "—"}</Td>
                      <Td className="text-right tabular-nums">
                        {matched}
                        {order.lines.length !== matched
                          ? ` / ${order.lines.length}`
                          : ""}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {order.total !== null
                          ? `${order.total.toLocaleString(undefined, {
                              maximumFractionDigits: 2
                            })}${order.totalIsPartial ? "*" : ""}`
                          : "—"}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </div>
          {proposal.orders.some((order) => order.totalIsPartial) ? (
            <p className="text-xs text-muted-foreground">
              <Trans>
                * some lines had no price in the source — the total covers only
                the priced lines.
              </Trans>
            </p>
          ) : null}

          {unmatchedParties.length > 0 ? (
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium">
                {kind === "po" ? (
                  <Trans>
                    {unmatchedParties.length} orders we can't create — supplier
                    not found
                  </Trans>
                ) : (
                  <Trans>
                    {unmatchedParties.length} orders we can't create — customer
                    not found
                  </Trans>
                )}
              </div>
              <ul className="text-sm text-muted-foreground list-disc pl-5 max-h-40 overflow-y-auto">
                {unmatchedParties.map((order, index) => (
                  <li key={index}>
                    {order.partyName}
                    {order.reference ? ` (${order.reference})` : ""} —{" "}
                    {order.partyDetail === "ambiguousParty" ? (
                      <Trans>
                        matches more than one record — fix the name in the
                        source and read it again
                      </Trans>
                    ) : kind === "po" ? (
                      <Trans>
                        no supplier with this name in Carbon. We never create
                        suppliers for you — add them first, then read the file
                        again.
                      </Trans>
                    ) : (
                      <Trans>
                        no customer with this name in Carbon. We never create
                        customers for you — add them first, then read the file
                        again.
                      </Trans>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {problemLines.length > 0 ? (
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium">
                {kind === "po" ? (
                  <Trans>
                    {problemLines.length} lines without a matching item — left
                    off the drafts
                  </Trans>
                ) : (
                  <Trans>
                    {problemLines.length} lines without a matching item — kept
                    as comment lines
                  </Trans>
                )}
              </div>
              <ul className="text-sm text-muted-foreground list-disc pl-5 max-h-40 overflow-y-auto">
                {problemLines.map(({ order, line }, index) => (
                  <li key={index}>
                    {line.partNumber ?? line.description} × {line.quantity}
                    {order.reference ? ` (${order.reference})` : ""}
                    {line.detail === "ambiguousItem" ? (
                      <>
                        {" — "}
                        <Trans>
                          matches more than one item; use the full ID with
                          revision
                        </Trans>
                      </>
                    ) : line.detail === "unsupportedType" ? (
                      <>
                        {" — "}
                        <Trans>
                          this item type can't go on a sales order line
                        </Trans>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                <Trans>
                  We never create items for you — import your items first, then
                  read the file again, or fix the drafts on their own screens.
                </Trans>
              </p>
            </div>
          ) : null}

          {needsLocation ? (
            locations.length === 0 ? (
              <p className="text-sm text-destructive">
                <Trans>
                  Sales orders need a location and your factory has none yet —
                  set one up in{" "}
                  <a
                    href={path.to.locations}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    Locations
                  </a>{" "}
                  first, then come back.
                </Trans>
              </p>
            ) : locations.length > 1 ? (
              <div className="flex flex-col gap-1.5">
                <div className="text-sm font-medium">
                  <Trans>Which location fulfills these orders?</Trans>
                </div>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t`Choose a location`} />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null
          ) : null}

          <div>
            <Button
              size="lg"
              leftIcon={
                isApplying ? (
                  <LuLoaderCircle className="animate-spin" />
                ) : (
                  <LuCircleCheck />
                )
              }
              isDisabled={!canApply}
              onClick={onApply}
            >
              {isApplying ? (
                <Trans>Creating drafts…</Trans>
              ) : kind === "po" ? (
                <Trans>Create {readyOrders.length} draft purchase orders</Trans>
              ) : (
                <Trans>Create {readyOrders.length} draft sales orders</Trans>
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
