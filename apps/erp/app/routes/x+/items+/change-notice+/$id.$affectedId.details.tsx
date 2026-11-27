// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { getChangeNoticeAffectedItemDraft } from "~/modules/items/items.service";
import type { ChangeNotice } from "~/modules/items/types";
import type {
  AffectedItemDraft,
  AffectedItemListEntry
} from "~/modules/items/ui/ChangeNotice";
import { useChangeNoticeEngineeringLock } from "~/modules/items/ui/ChangeNotice";
import AffectedItemDetail from "~/modules/items/ui/ChangeNotice/AffectedItemDetail";
import { path } from "~/utils/path";

const logger = getLogger("erp", "change-notice");

// The open affected item's draft, loaded here and not by the $id loader: a
// change notice can hold hundreds of items, and each draft takes many reads.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api, client, companyId } = await authorize(request, {
    "parts.changeNotices": "View"
  });

  const { id, affectedId } = params;
  if (!id) throw new Error("Could not find id");
  if (!affectedId) throw new Error("Could not find affectedId");

  // Company locations feed the embedded PartProperties pick-method editor.
  const [locations, partTags, operationTags] = await Promise.all([
    api.resources.getLocationsList({}),
    api.shared.getTagsList({ table: "part" }),
    api.shared.getTagsList({ table: "operation" })
  ]);
  // Only the pickers read these, so a failed read degrades them, not the page.
  for (const [name, result] of Object.entries({
    locations,
    partTags,
    operationTags
  })) {
    if (result.error)
      logger.error("Failed to load change notice item options", {
        list: name,
        changeNoticeId: id,
        error: result.error
      });
  }

  const draft = await getChangeNoticeAffectedItemDraft(client, companyId, {
    changeNoticeId: id,
    affectedId,
    locations: locations.data ?? [],
    partTags: partTags.data ?? [],
    operationTags: operationTags.data ?? []
  });

  if (draft.error) {
    throw redirect(
      path.to.changeNoticeDetails(id),
      await flash(
        request,
        error(draft.error, "Failed to load affected item", {
          changeNoticeId: id,
          affectedId
        })
      )
    );
  }

  return {
    draft: draft.data satisfies Omit<AffectedItemDraft, "diff"> | null
  };
}

// The selected affected item's line detail, addressed by the URL (not client
// state) — mirrors the sales order line route `$orderId.$lineId.details`, so
// refresh + back/forward reselect it.
export default function ChangeNoticeAffectedItemRoute() {
  const { id, affectedId } = useParams();
  if (!id) throw new Error("Could not find id");

  const { draft } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{
    changeNotice: ChangeNotice;
    affectedItems: AffectedItemListEntry[];
  }>(path.to.changeNotice(id));
  const { isDisabled, reason: disabledReason } =
    useChangeNoticeEngineeringLock(id);

  const changeNotice = routeData?.changeNotice;
  if (!changeNotice) throw new Error("Could not find change notice data");

  if (!draft) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <Trans>Affected item not found.</Trans>
      </div>
    );
  }

  // The diff is computed once for the whole notice by the $id loader.
  const affected: AffectedItemDraft = {
    ...draft,
    diff: routeData?.affectedItems.find((a) => a.affectedItem.id === affectedId)
      ?.diff
  };

  return (
    <VStack spacing={4} className="p-4">
      <AffectedItemDetail
        key={affected.affectedItem.id}
        changeOrderId={id}
        affected={affected}
        isDisabled={isDisabled}
        disabledReason={disabledReason}
      />
    </VStack>
  );
}
