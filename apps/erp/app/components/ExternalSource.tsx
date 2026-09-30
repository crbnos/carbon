import { useCarbon } from "@carbon/auth";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  toast
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuExternalLink, LuUnlink } from "react-icons/lu";
import { useFetcher } from "react-router";
import { useDateFormatter } from "~/hooks";
import { path } from "~/utils/path";

type ExternalSourceMapping = {
  externalId: string | null;
  lastSyncedAt: string | null;
  metadata: {
    documentId?: string;
    elementId?: string;
    wv?: string;
    wvId?: string;
    partNumber?: string | null;
    revision?: string | null;
    pushedAt?: string;
  } | null;
};

/**
 * The one item-page footprint of the Onshape panel: a self-contained card
 * that loads the item's panel link and renders nothing when the item was never
 * pushed. No loader changes, no form fields.
 *
 * Only the panel's `onshape-v2` link counts. A sync connection's `onshape`
 * row is BOM-import bookkeeping and never meant Onshape owns the item.
 */
export function ExternalSourceCard({
  itemId,
  canDetach
}: {
  itemId: string;
  canDetach: boolean;
}) {
  const { carbon } = useCarbon();
  const { formatDateTime } = useDateFormatter();
  const [mapping, setMapping] = useState<ExternalSourceMapping | null>(null);
  const detacher = useFetcher<{ success: boolean; message: string }>();

  useEffect(() => {
    if (!carbon) return;
    let cancelled = false;
    carbon
      .from("externalIntegrationMapping")
      .select("externalId, lastSyncedAt, metadata")
      .eq("entityType", "item")
      .eq("entityId", itemId)
      .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setMapping((data as ExternalSourceMapping | null) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [carbon, itemId]);

  useEffect(() => {
    if (detacher.state === "idle" && detacher.data?.success === false) {
      toast.error(detacher.data.message);
    }
  }, [detacher.state, detacher.data]);

  if (detacher.state !== "idle" || detacher.data?.success) return null;
  if (!mapping) return null;

  const meta = mapping.metadata ?? {};
  const onshapeUrl =
    meta.documentId && meta.wvId && meta.elementId
      ? `https://cad.onshape.com/documents/${meta.documentId}/${meta.wv ?? "w"}/${meta.wvId}/e/${meta.elementId}`
      : null;
  const pushedAt = meta.pushedAt ?? mapping.lastSyncedAt;
  const lastPushed = pushedAt ? formatDateTime(pushedAt) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Onshape
          <Badge variant="green">
            <Trans>Linked</Trans>
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            <Trans>Name and description are managed in Onshape.</Trans>
            {lastPushed ? (
              <>
                {" "}
                <Trans>Last pushed {lastPushed}.</Trans>
              </>
            ) : null}
            {canDetach ? (
              <>
                {" "}
                <Trans>Detach to edit them in Carbon.</Trans>
              </>
            ) : null}
          </p>
          <HStack spacing={2} className="shrink-0">
            {onshapeUrl ? (
              <Button variant="secondary" leftIcon={<LuExternalLink />} asChild>
                <a href={onshapeUrl} target="_blank" rel="noreferrer">
                  <Trans>Open in Onshape</Trans>
                </a>
              </Button>
            ) : null}
            {canDetach ? (
              <detacher.Form method="post" action={path.to.api.onShapeDetach}>
                <input type="hidden" name="itemId" value={itemId} />
                <Button variant="ghost" leftIcon={<LuUnlink />} type="submit">
                  <Trans>Detach</Trans>
                </Button>
              </detacher.Form>
            ) : null}
          </HStack>
        </div>
      </CardContent>
    </Card>
  );
}
