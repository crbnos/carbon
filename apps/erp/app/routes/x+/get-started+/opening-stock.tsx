import { assertIsPost, error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
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
  LuClipboardList,
  LuLoaderCircle,
  LuPrinter,
  LuSparkles,
  LuUpload
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { useUser } from "~/hooks";
import {
  deleteInventoryCount,
  generateInventoryCountLines,
  getInventoryCount,
  insertInventoryCount,
  updateInventoryCountLine
} from "~/modules/inventory";
import { getLocationsList } from "~/modules/resources";
import { getNextSequence } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import {
  extractOpeningStockRows,
  matchOpeningStockRows,
  type OpeningStockProposal,
  topUpOpeningStockLines
} from "./opening-stock.server";

// Opening stock — the cutover importer. The factory counts its stock the
// weekend before switching: Carbon creates an inventory count (sheets print
// from the existing count screen), the customer uploads the filled sheets
// (CSV/XLSX or a photo), and the AI types the counted quantities onto the
// count's lines for review. Posting stays on the EXISTING inventory count
// screen — nothing books stock without the customer's review.

const OPENING_COUNT_FIELD_KEY = "switch.openingCountId";

const createCountValidator = z.object({
  intent: z.literal("createCount"),
  locationId: z.string().min(1, { message: "Location is required" })
});

const parseUploadValidator = z.object({
  intent: z.literal("parseUpload"),
  uploadPath: z.string().min(1),
  uploadName: z.string().min(1)
});

const applyCountsValidator = z.object({
  intent: z.literal("applyCounts"),
  counts: z.string().min(1)
});

const appliedCountsSchema = z
  .array(
    z.object({
      lineId: z.string().min(1),
      quantity: z.number().min(0)
    })
  )
  .max(2000);

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const [locations, fieldValues] = await Promise.all([
    getLocationsList(client, companyId),
    getImplementationFieldValues(client, companyId)
  ]);

  const openingCountId =
    fieldValues.data?.find((f) => f.fieldKey === OPENING_COUNT_FIELD_KEY)
      ?.value ?? null;

  let count: {
    id: string;
    readableId: string;
    status: "Draft" | "Pending" | "Posted";
    totalLines: number;
    countedLines: number;
  } | null = null;

  // Idempotent re-entry: an already-created opening count (that still exists)
  // shows with its progress instead of offering to create another.
  if (openingCountId) {
    const header = await getInventoryCount(client, openingCountId, companyId);
    if (header.data) {
      const base = () =>
        client
          .from("inventoryCountLine")
          .select("id", { count: "exact", head: true })
          .eq("inventoryCountId", openingCountId)
          .eq("companyId", companyId);
      const [total, counted] = await Promise.all([
        base(),
        base().not("countedQuantity", "is", null)
      ]);
      count = {
        id: header.data.id,
        readableId: header.data.inventoryCountId,
        status: header.data.status,
        totalLines: total.count ?? 0,
        countedLines: counted.count ?? 0
      };
    }
  }

  return { locations: locations.data ?? [], count };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    // Create the opening count: the exact create + generate-lines flow the
    // inventory-count.new route runs, remembered via the hub fieldValue so
    // re-entry finds it again.
    case "createCount": {
      const { client, companyId, userId } = await requirePermissions(request, {
        create: "inventory"
      });

      const validation =
        await validator(createCountValidator).validate(formData);
      if (validation.error) {
        return validationError(validation.error);
      }
      const { locationId } = validation.data;

      // Idempotency: if an opening count was already created and still
      // exists, return it instead of creating a second one.
      const fieldValues = await getImplementationFieldValues(client, companyId);
      const existingId = fieldValues.data?.find(
        (f) => f.fieldKey === OPENING_COUNT_FIELD_KEY
      )?.value;
      if (existingId) {
        const existing = await getInventoryCount(client, existingId, companyId);
        if (existing.data) {
          return data({
            intent: "createCount" as const,
            success: true as const,
            countId: existing.data.id
          });
        }
      }

      const sequence = await getNextSequence(
        client,
        "inventoryCount",
        companyId
      );
      if (sequence.error || !sequence.data) {
        return data(
          { intent: "createCount" as const, success: false as const },
          await flash(
            request,
            error(sequence.error, "Failed to generate inventory count id")
          )
        );
      }

      const created = await insertInventoryCount(client, {
        inventoryCountId: sequence.data as string,
        locationId,
        isBlind: false,
        notes: "Opening stock count — created from Get Started",
        scope: {} as Json,
        companyId,
        createdBy: userId
      });
      if (created.error || !created.data) {
        return data(
          { intent: "createCount" as const, success: false as const },
          await flash(
            request,
            error(created.error, "Failed to create inventory count")
          )
        );
      }

      // Snapshot current on-hand into count lines; on failure delete the
      // just-created header rather than leaving an orphan Draft behind
      // (mirrors inventory-count.new).
      try {
        await generateInventoryCountLines(getDatabaseClient(), {
          inventoryCountId: created.data.id,
          companyId,
          locationId,
          createdBy: userId
        });
        // Greenfield cutover: the snapshot only covers items with ledger
        // history, which a factory that hasn't booked stock yet has none of.
        // Top up zero-baseline lines so the whole catalog is countable.
        await topUpOpeningStockLines(getDatabaseClient(), {
          inventoryCountId: created.data.id,
          companyId,
          locationId,
          createdBy: userId
        });
      } catch (err) {
        await deleteInventoryCount(client, created.data.id, companyId);
        return data(
          { intent: "createCount" as const, success: false as const },
          await flash(request, error(err, "Failed to generate count lines"))
        );
      }

      const remembered = await upsertFieldValue(client, {
        companyId,
        fieldKey: OPENING_COUNT_FIELD_KEY,
        value: created.data.id,
        userId
      });
      if (remembered.error) {
        return data(
          { intent: "createCount" as const, success: false as const },
          await flash(
            request,
            error(remembered.error, "Failed to save the opening count")
          )
        );
      }

      return data({
        intent: "createCount" as const,
        success: true as const,
        countId: created.data.id
      });
    }

    // Parse the uploaded filled count and propose matches — READ ONLY. The
    // proposal is returned to the client; nothing is written until the
    // customer applies it.
    case "parseUpload": {
      const { client, companyId } = await requirePermissions(request, {
        view: "inventory"
      });

      const validation =
        await validator(parseUploadValidator).validate(formData);
      if (validation.error) {
        return validationError(validation.error);
      }
      const { uploadPath, uploadName } = validation.data;

      // Only files this flow uploaded for this company are readable here.
      if (!uploadPath.startsWith(`${companyId}/opening-stock/`)) {
        return data(
          { intent: "parseUpload" as const, success: false as const },
          await flash(request, error(null, "Invalid upload path"))
        );
      }

      const fieldValues = await getImplementationFieldValues(client, companyId);
      const countId = fieldValues.data?.find(
        (f) => f.fieldKey === OPENING_COUNT_FIELD_KEY
      )?.value;
      if (!countId) {
        return data(
          { intent: "parseUpload" as const, success: false as const },
          await flash(request, error(null, "Create the opening count first"))
        );
      }

      const header = await getInventoryCount(client, countId, companyId);
      if (!header.data) {
        return data(
          { intent: "parseUpload" as const, success: false as const },
          await flash(request, error(header.error, "Failed to load the count"))
        );
      }
      if (header.data.status !== "Draft") {
        return data(
          { intent: "parseUpload" as const, success: false as const },
          await flash(
            request,
            error(null, "Counts can only be entered while the count is Draft")
          )
        );
      }

      const rows = await extractOpeningStockRows(client, {
        uploadPath,
        uploadName
      });
      if (!rows || rows.length === 0) {
        // Unreadable file / AI failure — reported plainly, never guessed.
        return data({
          intent: "parseUpload" as const,
          success: false as const
        });
      }

      const proposal = await matchOpeningStockRows(client, {
        inventoryCountId: countId,
        companyId,
        rows
      });
      if (!proposal) {
        return data(
          { intent: "parseUpload" as const, success: false as const },
          await flash(request, error(null, "Failed to match the count lines"))
        );
      }

      return data({
        intent: "parseUpload" as const,
        success: true as const,
        proposal
      });
    }

    // Write the reviewed counted quantities onto the count's lines via the
    // same line-update service the count screen's inline entry uses. The
    // Draft-only guard is atomic inside `updateInventoryCountLine`.
    case "applyCounts": {
      const { companyId, userId } = await requirePermissions(request, {
        update: "inventory"
      });

      const validation =
        await validator(applyCountsValidator).validate(formData);
      if (validation.error) {
        return validationError(validation.error);
      }

      let counts: z.infer<typeof appliedCountsSchema>;
      try {
        counts = appliedCountsSchema.parse(JSON.parse(validation.data.counts));
      } catch (err) {
        return data(
          { intent: "applyCounts" as const, success: false as const },
          await flash(request, error(err, "Invalid counts payload"))
        );
      }

      let applied = 0;
      let skipped = 0;
      try {
        for (const { lineId, quantity } of counts) {
          const updated = await updateInventoryCountLine(getDatabaseClient(), {
            id: lineId,
            countedQuantity: quantity,
            companyId,
            countedBy: userId
          });
          if (updated) {
            applied += 1;
          } else {
            // Line gone or the count left Draft — never overwrite blindly.
            skipped += 1;
          }
        }
      } catch (err) {
        return data(
          { intent: "applyCounts" as const, success: false as const },
          await flash(request, error(err, "Failed to apply counts"))
        );
      }

      return data({
        intent: "applyCounts" as const,
        success: true as const,
        applied,
        skipped
      });
    }

    default:
      return data(
        { intent: "unknown" as const, success: false as const },
        await flash(request, error(null, "Invalid intent"))
      );
  }
}

export default function OpeningStockRoute() {
  const { t } = useLingui();
  const { locations, count } = useLoaderData<typeof loader>();
  const { carbon } = useCarbon();
  const { company } = useUser();

  const createFetcher = useFetcher<typeof action>();
  const parseFetcher = useFetcher<typeof action>();
  const applyFetcher = useFetcher<typeof action>();

  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [phase, setPhase] = useState<"idle" | "review" | "applied">("idle");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isCreating = createFetcher.state !== "idle";
  const isParsing = parseFetcher.state !== "idle";
  const isApplying = applyFetcher.state !== "idle";

  const parseData =
    parseFetcher.state === "idle" &&
    parseFetcher.data &&
    "intent" in parseFetcher.data &&
    parseFetcher.data.intent === "parseUpload"
      ? parseFetcher.data
      : null;
  const proposal: OpeningStockProposal | null =
    parseData?.success && "proposal" in parseData ? parseData.proposal : null;
  const parseFailed = parseData ? !parseData.success : false;

  const applyData =
    applyFetcher.state === "idle" &&
    applyFetcher.data &&
    "intent" in applyFetcher.data &&
    applyFetcher.data.intent === "applyCounts" &&
    applyFetcher.data.success
      ? applyFetcher.data
      : null;
  const applyFailed =
    phase === "applied" && applyFetcher.state === "idle" && !applyData;

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Allow re-selecting the same file after a failure.
    event.target.value = "";
    if (!file || !carbon) return;

    setUploadFailed(false);
    setIsUploading(true);
    const extension = file.name.split(".").pop() ?? "csv";
    const storagePath = `${company.id}/opening-stock/${nanoid()}.${extension}`;
    const uploaded = await carbon.storage
      .from("private")
      .upload(storagePath, file);
    setIsUploading(false);

    if (uploaded.error || !uploaded.data) {
      setUploadFailed(true);
      return;
    }

    setPhase("review");
    parseFetcher.submit(
      {
        intent: "parseUpload",
        uploadPath: uploaded.data.path,
        uploadName: file.name
      },
      { method: "post" }
    );
  };

  const onApply = () => {
    if (!proposal) return;
    setPhase("applied");
    applyFetcher.submit(
      {
        intent: "applyCounts",
        counts: JSON.stringify(
          proposal.matched.map(({ lineId, quantity }) => ({
            lineId,
            quantity
          }))
        )
      },
      { method: "post" }
    );
  };

  // -------------------------------------------------------------------------
  // State: no count yet — explain the weekend, pick a location, create it.
  // -------------------------------------------------------------------------
  if (!count) {
    return (
      <div className="w-full max-w-2xl mx-auto flex flex-col gap-8 py-10">
        <div className="flex flex-col gap-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <LuClipboardList className="size-3.5" />
            <Trans>Opening stock</Trans>
          </div>
          <h1 className="text-3xl font-semibold">
            <Trans>Count it. Upload it. We type it.</Trans>
          </h1>
          <p className="text-sm text-muted-foreground">
            <Trans>
              The weekend before you switch, your factory counts its stock.
              Carbon prints the count sheets, you count with paper, and when you
              upload the filled sheets we type the numbers in for your review.
              Nothing books stock until you post the count yourself.
            </Trans>
          </p>
        </div>

        <div className="rounded-xl border bg-card px-5 py-4 flex flex-col gap-4">
          <div className="text-sm font-medium">
            <Trans>Where are you counting?</Trans>
          </div>
          {locations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                Your factory has no location yet — set one up in{" "}
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
          ) : locations.length === 1 ? (
            <p className="text-sm text-muted-foreground">
              {locations[0]?.name}
            </p>
          ) : (
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
          )}
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              leftIcon={
                isCreating ? (
                  <LuLoaderCircle className="animate-spin" />
                ) : (
                  <LuClipboardList />
                )
              }
              isDisabled={locations.length === 0 || isCreating}
              onClick={() =>
                createFetcher.submit(
                  { intent: "createCount", locationId },
                  { method: "post" }
                )
              }
            >
              {isCreating ? (
                <Trans>Snapshotting your stock…</Trans>
              ) : (
                <Trans>Create the opening count</Trans>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              <Trans>
                This creates a real inventory count covering every item with
                stock history at the location — the same count your team can
                also fill in on screen.
              </Trans>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // State: the count exists — print, upload, review, apply.
  // -------------------------------------------------------------------------
  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-6 py-10">
      <div className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <LuClipboardList className="size-3.5" />
          <Trans>Opening stock</Trans>
        </div>
        <h1 className="text-3xl font-semibold">
          <Trans>Your opening count</Trans>
        </h1>
      </div>

      {/* The count card */}
      <div className="rounded-xl border bg-card px-5 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <a
            href={path.to.inventoryCount(count.id)}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary hover:underline inline-flex items-center gap-1"
          >
            {count.readableId}
            <LuArrowUpRight className="size-3.5" />
          </a>
          <div className="text-sm text-muted-foreground">
            {count.status === "Draft" ? (
              <Trans>
                Draft · {count.countedLines} of {count.totalLines} lines counted
              </Trans>
            ) : count.status === "Pending" ? (
              <Trans>Confirmed — waiting to be posted</Trans>
            ) : (
              <Trans>Posted — your opening stock is booked</Trans>
            )}
          </div>
        </div>
        {count.status === "Posted" ? (
          <LuCircleCheck className="size-6 text-emerald-500 shrink-0" />
        ) : null}
      </div>

      {count.status === "Draft" && count.totalLines === 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-3 text-sm text-muted-foreground">
          <Trans>
            This count has no lines yet — count lines come from stock history in
            Carbon, and this location has none. If your items were just
            imported, book their first quantities with inventory adjustments, or
            ask us for a hand.
          </Trans>
        </div>
      ) : null}

      {count.status === "Draft" ? (
        <>
          {/* Step 1 — print */}
          <div className="rounded-xl border bg-card px-5 py-4 flex items-start gap-3">
            <LuPrinter className="size-4 mt-0.5 text-muted-foreground shrink-0" />
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="text-sm font-medium">
                <Trans>1. Print the count sheets</Trans>
              </div>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Open the count and download the sheet (CSV) to print. Walk the
                  factory, count what is really on the shelf, and write it down.
                </Trans>
              </p>
              <a
                href={path.to.inventoryCount(count.id)}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                <Trans>Open the count</Trans>
                <LuArrowUpRight className="size-3.5" />
              </a>
            </div>
          </div>

          {/* Step 2 — upload */}
          <div className="rounded-xl border bg-card px-5 py-4 flex items-start gap-3">
            <LuUpload className="size-4 mt-0.5 text-muted-foreground shrink-0" />
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <div className="flex flex-col gap-0.5">
                <div className="text-sm font-medium">
                  <Trans>2. Upload the filled count</Trans>
                </div>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    A filled spreadsheet or a photo of the paper sheet — we read
                    it and type the numbers in. You review everything before it
                    touches the count.
                  </Trans>
                </p>
              </div>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.txt,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={onFileChange}
                />
                <Button
                  variant="secondary"
                  leftIcon={
                    isUploading || isParsing ? (
                      <LuLoaderCircle className="animate-spin" />
                    ) : (
                      <LuSparkles />
                    )
                  }
                  isDisabled={isUploading || isParsing}
                  onClick={() => fileRef.current?.click()}
                >
                  {isUploading ? (
                    <Trans>Uploading…</Trans>
                  ) : isParsing ? (
                    <Trans>Reading your count…</Trans>
                  ) : (
                    <Trans>Upload the filled sheet</Trans>
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
                    We couldn't read that file. Try a clearer photo or export
                    the sheet as CSV — we never guess at numbers.
                  </Trans>
                </p>
              ) : null}
            </div>
          </div>

          {/* Applied — the payoff */}
          {phase === "applied" && applyData ? (
            <div className="rounded-xl border bg-card px-5 py-4 flex flex-col gap-2">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <LuCircleCheck className="size-4 text-emerald-500" />
                <Trans>
                  {applyData.applied} counted quantities written to the count
                </Trans>
              </div>
              {applyData.skipped > 0 ? (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    {applyData.skipped} lines were skipped — the count may have
                    moved on from Draft.
                  </Trans>
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Now review the count and post it — posting is what books your
                  opening stock, and it stays in your hands.
                </Trans>
              </p>
              <a
                href={path.to.inventoryCount(count.id)}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                <Trans>Review &amp; post the count</Trans>
                <LuArrowUpRight className="size-3.5" />
              </a>
            </div>
          ) : null}

          {applyFailed ? (
            <p className="text-sm text-destructive">
              <Trans>Applying the counts failed — try again.</Trans>
            </p>
          ) : null}

          {/* Step 3 — review the proposal */}
          {proposal && !(phase === "applied" && applyData) ? (
            <div className="rounded-xl border bg-card px-5 py-4 flex flex-col gap-4">
              <div className="flex flex-col gap-0.5">
                <div className="text-sm font-medium">
                  <Trans>
                    3. Review — {proposal.matched.length} lines matched
                  </Trans>
                </div>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    These counted quantities will be written onto the count's
                    lines. Nothing posts — you still review and post the count
                    yourself.
                  </Trans>
                </p>
              </div>

              {proposal.matched.length > 0 ? (
                <div className="max-h-80 overflow-y-auto rounded-lg border">
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>
                          <Trans>Part</Trans>
                        </Th>
                        <Th>
                          <Trans>Name</Trans>
                        </Th>
                        <Th className="text-right">
                          <Trans>Counted</Trans>
                        </Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {proposal.matched.map((match) => (
                        <Tr key={match.lineId}>
                          <Td>{match.partNumber}</Td>
                          <Td>{match.itemName}</Td>
                          <Td className="text-right tabular-nums">
                            {match.quantity}
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </div>
              ) : null}

              {proposal.tracked.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-medium">
                    <Trans>
                      {proposal.tracked.length} lot / serial tracked rows —
                      enter these on the count screen
                    </Trans>
                  </div>
                  <ul className="text-sm text-muted-foreground list-disc pl-5">
                    {proposal.tracked.map((row, index) => (
                      <li key={index}>
                        {row.partNumber}
                        {row.lot ? ` (${row.lot})` : ""} — {row.quantity}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {proposal.unmatched.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-medium">
                    <Trans>
                      {proposal.unmatched.length} rows we couldn't match
                    </Trans>
                  </div>
                  <ul className="text-sm text-muted-foreground list-disc pl-5">
                    {proposal.unmatched.map((row, index) => (
                      <li key={index}>
                        {row.partNumber} — {row.quantity}{" "}
                        {row.reason === "multipleBins" ? (
                          <Trans>
                            (counted in more than one bin — enter it on the
                            count screen)
                          </Trans>
                        ) : (
                          <Trans>
                            (no line with this part number on the count)
                          </Trans>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
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
                  isDisabled={proposal.matched.length === 0 || isApplying}
                  onClick={onApply}
                >
                  {isApplying ? (
                    <Trans>Applying…</Trans>
                  ) : (
                    <Trans>Apply to the count</Trans>
                  )}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="rounded-xl border bg-card px-5 py-4 flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {count.status === "Pending" ? (
              <Trans>
                The count is confirmed. Open it to give the numbers a last look
                and post it — posting books your opening stock.
              </Trans>
            ) : (
              <Trans>
                Your opening stock is booked. Every quantity came from your
                count — welcome to day one.
              </Trans>
            )}
          </p>
          <a
            href={path.to.inventoryCount(count.id)}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <Trans>Open the count</Trans>
            <LuArrowUpRight className="size-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}
