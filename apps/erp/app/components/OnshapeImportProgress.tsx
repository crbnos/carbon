import { useCarbon } from "@carbon/auth";
import { OnshapeLogo } from "@carbon/ee";
import type { OnshapeImportStage } from "@carbon/ee/onshape";
import { Button, HStack, Progress, Spinner, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuCircleCheck, LuTriangleAlert } from "react-icons/lu";
import { useOnshapeImportStatus } from "~/hooks/useOnshapeImportStatus";
import { useUser } from "~/hooks/useUser";

/** How long to wait for a body's thumbnail before going anyway. */
const THUMBNAIL_WAIT_MS = 12_000;
const THUMBNAIL_POLL_MS = 2_000;

/**
 * How long to wait for the marker to say ANYTHING before giving up on it.
 *
 * The create route opens the marker before dispatching, so it is normally there
 * on the first read. But that write is best-effort — it is an affordance, not
 * the import, and the route logs a failure rather than undoing a part it has
 * already made. Without this the modal would then block on a record that is
 * never coming, spinning forever with only the escape button, which is the one
 * failure mode a blocking UI must not have.
 */
const MARKER_GRACE_MS = 8_000;

type Props = {
  itemId: string;
  /** What the user picked, for a heading they recognise. */
  partNumber: string;
  revision: string;
  /**
   * The selection was a Part Studio BODY. Its preview is rendered by the
   * model-optimize chain AFTER the import closes, unlike a whole-element export
   * whose thumbnail Onshape renders and the pull attaches inline. Only a body
   * needs the extra wait — see below.
   */
  isBody: boolean;
  /**
   * Something the create route decided that the user still has to be told —
   * today, only that the bill of materials was refused for want of permission.
   * It used to ride a success toast; there is no success toast any more, and a
   * refusal that nothing downstream mentions again cannot be dropped.
   */
  notice?: string | null;
  /** Go to the part. Called automatically when there is nothing left to wait for. */
  onDone: () => void;
};

const STAGE_ORDER: OnshapeImportStage[] = [
  "reading",
  "parts",
  "materials",
  "assets",
  "drawings"
];

/**
 * Hold the user here until the part is actually finished.
 *
 * Creating a part from Onshape returns as soon as the ITEM exists — the bill of
 * materials, the models and the drawings land seconds to minutes later, in a
 * job. Navigating on that response drops the user onto a part with no structure
 * and no geometry, which reads as a broken import rather than an unfinished one.
 *
 * So this blocks. Not helplessly, though: "Go to the part now" is offered the
 * whole time, because the item genuinely does exist and a nine-element assembly
 * against a rate-limited API is minutes of waiting that nobody should be unable
 * to leave.
 */
export const OnshapeImportProgress = ({
  itemId,
  partNumber,
  revision,
  isBody,
  notice,
  onDone
}: Props) => {
  const { t } = useLingui();
  const status = useOnshapeImportStatus(itemId);
  const { carbon } = useCarbon();
  const { company } = useUser();

  // Only a body waits, and only for a bounded time. `null` means "not waiting".
  const [thumbnailWait, setThumbnailWait] = useState<number | null>(null);
  const doneRef = useRef(false);
  /** Whether the marker has ever reported anything. See MARKER_GRACE_MS. */
  const sawMarkerRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  const reported = status.running || status.justFinished || status.failed;
  useEffect(() => {
    if (reported) sawMarkerRef.current = true;
  }, [reported]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!sawMarkerRef.current) finish();
    }, MARKER_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [finish]);

  // The import itself is over. For a whole-element export everything the user
  // came for is already attached, so leave immediately. A body's preview is
  // still rendering, so give it a moment rather than landing on a part with a
  // blank tile.
  useEffect(() => {
    if (!status.justFinished || thumbnailWait !== null) return;
    if (!isBody) {
      finish();
      return;
    }
    setThumbnailWait(Date.now());
  }, [status.justFinished, thumbnailWait, isBody, finish]);

  useEffect(() => {
    if (thumbnailWait === null || !carbon) return;
    let cancelled = false;

    const check = async () => {
      if (cancelled) return;

      if (Date.now() - thumbnailWait > THUMBNAIL_WAIT_MS) {
        // The preview is cosmetic and its chain is the same one every uploaded
        // model in Carbon goes through. Waiting past this point trades a
        // finished part for a picture.
        finish();
        return;
      }

      const { data } = await carbon
        .from("item")
        .select("modelUpload(thumbnailPath)")
        .eq("id", itemId)
        .eq("companyId", company.id)
        .maybeSingle();

      const model = data?.modelUpload as {
        thumbnailPath?: string | null;
      } | null;
      if (model?.thumbnailPath) {
        finish();
        return;
      }
      if (!cancelled) window.setTimeout(check, THUMBNAIL_POLL_MS);
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, [thumbnailWait, carbon, itemId, company.id, finish]);

  const stageLabel = (stage: OnshapeImportStage | null) => {
    switch (stage) {
      case "reading":
        return t`Reading the bill of materials from Onshape`;
      case "parts":
        return t`Matching and creating parts`;
      case "materials":
        return t`Writing the bill of materials`;
      case "assets":
        return t`Pulling 3D models`;
      case "drawings":
        return t`Attaching drawings`;
      default:
        return t`Starting`;
    }
  };

  const stepNumber = status.stage ? STAGE_ORDER.indexOf(status.stage) + 1 : 0;
  const withinStage =
    status.total && status.total > 0 && typeof status.done === "number"
      ? Math.round((status.done / status.total) * 100)
      : null;

  return (
    <VStack spacing={4} className="w-full py-2">
      <HStack className="w-full items-center gap-2">
        <OnshapeLogo className="h-5 w-auto" />
        <p className="text-sm">
          <span className="font-medium">{partNumber}</span>{" "}
          <span className="text-muted-foreground">{revision}</span>
        </p>
      </HStack>

      {notice && (
        <div className="flex w-full items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
          <LuTriangleAlert className="mt-0.5 shrink-0 text-muted-foreground" />
          <span>{notice}</span>
        </div>
      )}

      {status.failed ? (
        <VStack spacing={2} className="w-full">
          <HStack className="items-start gap-2">
            <LuTriangleAlert className="mt-0.5 shrink-0 text-destructive" />
            <div className="text-sm">
              <p className="font-medium">
                <Trans>The import did not finish</Trans>
              </p>
              <p className="text-muted-foreground">
                {status.stalled ? (
                  <Trans>
                    Carbon stopped hearing from it. The part was created — open
                    it to see what landed, and import the bill of materials
                    again from its BoM explorer if it is missing.
                  </Trans>
                ) : (
                  (status.error ?? (
                    <Trans>
                      The part was created, but building it out from Onshape
                      failed.
                    </Trans>
                  ))
                )}
              </p>
            </div>
          </HStack>
        </VStack>
      ) : status.running || !status.justFinished ? (
        <VStack spacing={2} className="w-full">
          <HStack className="w-full items-center gap-2">
            <Spinner className="size-4" />
            <p className="text-sm">{stageLabel(status.stage)}</p>
          </HStack>
          {withinStage !== null ? (
            <Progress value={withinStage} className="w-full" />
          ) : null}
          <p className="text-xs text-muted-foreground">
            {stepNumber > 0 ? (
              <Trans>
                Step {stepNumber} of {STAGE_ORDER.length}. The part already
                exists — this is Carbon filling it in.
              </Trans>
            ) : (
              <Trans>
                The part already exists — this is Carbon filling it in.
              </Trans>
            )}
          </p>
        </VStack>
      ) : (
        <HStack className="w-full items-center gap-2">
          <LuCircleCheck className="shrink-0 text-emerald-600" />
          <p className="text-sm">
            <Trans>Finished. Opening the part…</Trans>
          </p>
        </HStack>
      )}

      <HStack className="w-full justify-end">
        <Button
          variant={status.failed ? "primary" : "secondary"}
          onClick={finish}
        >
          {status.failed ? (
            <Trans>Open the part</Trans>
          ) : (
            <Trans>Go to the part now</Trans>
          )}
        </Button>
      </HStack>
    </VStack>
  );
};

export default OnshapeImportProgress;
