import { useCarbon } from "@carbon/auth";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuExternalLink, LuUnlink } from "react-icons/lu";
import { Confirm } from "~/components/Modals";
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
  const { t } = useLingui();
  const { formatDateTime } = useDateFormatter();
  const [mapping, setMapping] = useState<ExternalSourceMapping | null>(null);
  const [confirmingDetach, setConfirmingDetach] = useState(false);
  // Bumped after a detach so the link is read again: the card goes only when
  // the link is gone, and stays (with Confirm's error toast) when it is not.
  const [reload, setReload] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload re-reads the link
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
  }, [carbon, itemId, reload]);

  if (!mapping) return null;

  const meta = mapping.metadata ?? {};
  // A child linked by an assembly push records no workspace or version, so it
  // opens its document rather than an exact tab.
  const onshapeUrl = !meta.documentId
    ? null
    : meta.wvId && meta.elementId
      ? `https://cad.onshape.com/documents/${meta.documentId}/${meta.wv ?? "w"}/${meta.wvId}/e/${meta.elementId}`
      : `https://cad.onshape.com/documents/${meta.documentId}`;
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
              <Button
                variant="ghost"
                leftIcon={<LuUnlink />}
                onClick={() => setConfirmingDetach(true)}
              >
                <Trans>Detach</Trans>
              </Button>
            ) : null}
          </HStack>
        </div>
      </CardContent>
      {confirmingDetach ? (
        <Confirm
          action={path.to.api.onShapeDetach}
          title={t`Detach from Onshape?`}
          text={t`Name and description become editable in Carbon and stop following Onshape. Pushing this part from Onshape again links it back.`}
          confirmText={t`Detach`}
          onCancel={() => setConfirmingDetach(false)}
          onSubmit={() => {
            setConfirmingDetach(false);
            setReload((n) => n + 1);
          }}
        >
          <input type="hidden" name="itemId" value={itemId} />
        </Confirm>
      ) : null}
    </Card>
  );
}
