import { useCarbon } from "@carbon/auth";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack
} from "@carbon/react";
import { useEffect, useState } from "react";
import { LuExternalLink, LuUnlink } from "react-icons/lu";
import { useFetcher } from "react-router";
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
 * The one item-page footprint of the Onshape integration: a self-contained
 * card that loads its own mapping row and renders nothing when the item was
 * never pushed. No loader changes, no form fields — see the items-UI
 * footprint rule in the repo docs.
 */
export function ExternalSourceCard({
  itemId,
  canDetach
}: {
  itemId: string;
  canDetach: boolean;
}) {
  const { carbon } = useCarbon();
  const [mapping, setMapping] = useState<ExternalSourceMapping | null>(null);
  const detacher = useFetcher<{ ok?: boolean }>();

  useEffect(() => {
    if (!carbon) return;
    let cancelled = false;
    carbon
      .from("externalIntegrationMapping")
      .select("externalId, lastSyncedAt, metadata")
      .eq("entityType", "item")
      .eq("entityId", itemId)
      .eq("integration", "onshape")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setMapping((data as ExternalSourceMapping) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [carbon, itemId]);

  // Optimistically drop the card once a detach is in flight/succeeded.
  if (detacher.state !== "idle" || detacher.data?.ok) return null;
  if (!mapping) return null;

  const meta = mapping.metadata ?? {};
  const onshapeUrl =
    meta.documentId && meta.wvId && meta.elementId
      ? `https://cad.onshape.com/documents/${meta.documentId}/${meta.wv ?? "w"}/${meta.wvId}/e/${meta.elementId}`
      : null;
  const pushedAt = meta.pushedAt ?? mapping.lastSyncedAt;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Onshape
          <Badge variant="green">Linked</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Name, description and revision are pushed from Onshape
            {pushedAt
              ? ` · last push ${new Date(pushedAt).toLocaleString()}`
              : ""}
            . Detach to edit them in Carbon.
          </p>
          <HStack spacing={2} className="shrink-0">
            {onshapeUrl ? (
              <Button variant="secondary" leftIcon={<LuExternalLink />} asChild>
                <a href={onshapeUrl} target="_blank" rel="noreferrer">
                  Open in Onshape
                </a>
              </Button>
            ) : null}
            {canDetach ? (
              <detacher.Form method="post" action={path.to.api.onShapeDetach}>
                <input type="hidden" name="itemId" value={itemId} />
                <Button variant="ghost" leftIcon={<LuUnlink />} type="submit">
                  Detach
                </Button>
              </detacher.Form>
            ) : null}
          </HStack>
        </div>
      </CardContent>
    </Card>
  );
}
