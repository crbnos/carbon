// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import type { StandardFieldId } from "@carbon/ee";
import { everyPushTargets } from "@carbon/ee";
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
import { useDateFormatter, useUser } from "~/hooks";
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
 * Self-loading card for the item's `onshape-v2` link: the fields a push
 * replaces, last push time, Open in Onshape and Detach. Renders nothing when
 * the item has no link.
 */
export function ExternalSourceCard({
  itemId,
  canDetach
}: {
  itemId: string;
  canDetach: boolean;
}) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const { t } = useLingui();
  const { formatDateTime } = useDateFormatter();
  const [mapping, setMapping] = useState<ExternalSourceMapping | null>(null);
  const [confirmingDetach, setConfirmingDetach] = useState(false);
  // Bumped after a detach: the card re-reads the link and goes once it is gone.
  const [reload, setReload] = useState(0);
  // Null until read, or when this user lacks settings view.
  const [replaced, setReplaced] = useState<string[] | null>(null);
  const itemFieldLabel: Record<StandardFieldId, string> = {
    mpn: t`Manufacturer Part Number`,
    replenishmentSystem: t`Replenishment`,
    defaultMethodType: t`Default Method Type`,
    sourcingType: t`Sourcing`,
    itemTrackingType: t`Tracking Type`,
    unitOfMeasureCode: t`Unit of Measure`
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload re-reads the link
  useEffect(() => {
    if (!carbon) return;
    let cancelled = false;
    carbon
      .from("externalIntegrationMapping")
      .select("externalId, lastSyncedAt, metadata")
      .eq("companyId", company.id)
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
  }, [carbon, company.id, itemId, reload]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the labels follow the locale, not the read
  useEffect(() => {
    if (!carbon || !mapping) return;
    let cancelled = false;
    void (async () => {
      const integration = await carbon
        .from("companyIntegration")
        .select("metadata")
        .eq("companyId", company.id)
        .eq("id", ONSHAPE_V2_INTEGRATION_ID)
        .maybeSingle();
      if (cancelled) return;
      if (!integration.data) {
        setReplaced(null);
        return;
      }
      const targets = everyPushTargets(integration.data.metadata);
      const fieldNames = new Map<string, string>();
      if (targets.customFieldIds.length > 0) {
        const fields = await carbon
          .from("customField")
          .select("id, name")
          .eq("companyId", company.id)
          .in("id", targets.customFieldIds);
        for (const field of fields.data ?? []) {
          fieldNames.set(field.id, field.name);
        }
      }
      if (cancelled) return;
      setReplaced([
        ...targets.descriptions.map((field) =>
          field === "name" ? t`Short Description` : t`Long Description`
        ),
        ...targets.itemFields.map((field) => itemFieldLabel[field]),
        ...targets.customFieldIds.flatMap((id) => {
          const name = fieldNames.get(id);
          return name ? [name] : [];
        })
      ]);
    })();
    return () => {
      cancelled = true;
    };
  }, [carbon, company.id, mapping]);

  if (!mapping) return null;

  const meta = mapping.metadata ?? {};
  // A child linked by an assembly push records no workspace, so it opens the
  // document.
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
            {replaced === null ? (
              <Trans>
                Pushes replace only the fields that Onshape's Fields page sets
                to Update on every push.
              </Trans>
            ) : replaced.length === 0 ? (
              <Trans>
                Pushes don't change this item's fields, so edits made here stay.
              </Trans>
            ) : (
              <Trans>
                Each push replaces: {replaced.join(", ")}. Other edits stay.
              </Trans>
            )}
            {lastPushed ? (
              <>
                {" "}
                <Trans>Last pushed {lastPushed}.</Trans>
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
          text={t`Pushes from Onshape stop updating this item. Pushing this part from Onshape again links it back.`}
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
