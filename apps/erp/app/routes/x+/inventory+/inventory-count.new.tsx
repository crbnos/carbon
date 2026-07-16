import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { pluckUnique } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  deleteInventoryCount,
  expandStorageUnitIdsWithDescendants,
  generateInventoryCountLines,
  InventoryCountForm,
  insertInventoryCount,
  inventoryCountValidator
} from "~/modules/inventory";
import { getNextSequence } from "~/modules/settings";
import { getTagsList } from "~/modules/shared";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "inventory"
  });

  const tags = await getTagsList(client, companyId);

  return { tags: pluckUnique(tags.data, (t) => t.name) };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(inventoryCountValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    locationId,
    isBlind,
    notes,
    storageUnitIds,
    storageTypeIds,
    itemType,
    materialSubstanceId,
    materialFormId,
    finishId,
    gradeId,
    dimensionId,
    materialTypeId,
    tags
  } = validation.data;

  // An unselected multi-select submits [""], which would otherwise scope the
  // count to an id that matches no stock.
  const scopedStorageUnitIds = storageUnitIds?.filter(Boolean) ?? [];
  const scopedStorageTypeIds = storageTypeIds?.filter(Boolean) ?? [];
  const scopedTags = tags?.filter(Boolean) ?? [];

  // Selecting a parent unit means "count everything inside it", so resolve the
  // subtree before generating lines. The unexpanded selection is what gets
  // persisted to `scope` (see below).
  const expandedStorageUnitIds = scopedStorageUnitIds.length
    ? await expandStorageUnitIdsWithDescendants(client, scopedStorageUnitIds)
    : [];

  const sequence = await getNextSequence(client, "inventoryCount", companyId);
  if (sequence.error || !sequence.data) {
    return data(
      {},
      await flash(
        request,
        error(sequence.error, "Failed to generate inventory count id")
      )
    );
  }

  // Persisted for a future "regenerate from current stock while Draft" action:
  // it records the filter this count was generated with so the snapshot can be
  // rebuilt with the same scope. Written now, not yet read back.
  //
  // Stores the user's ORIGINAL storage-unit selection, not the expanded
  // subtree, so a later regenerate re-expands against the tree as it stands
  // then rather than freezing today's descendants.
  const itemFilter = {
    ...(itemType ? { type: itemType } : {}),
    ...(materialSubstanceId ? { materialSubstanceId } : {}),
    ...(materialFormId ? { materialFormId } : {}),
    ...(finishId ? { finishId } : {}),
    ...(gradeId ? { gradeId } : {}),
    ...(dimensionId ? { dimensionId } : {}),
    ...(materialTypeId ? { materialTypeId } : {}),
    ...(scopedTags.length > 0 ? { tags: scopedTags } : {})
  };

  const scope = {
    ...(scopedStorageUnitIds.length > 0
      ? { storageUnitIds: scopedStorageUnitIds }
      : {}),
    ...(scopedStorageTypeIds.length > 0
      ? { storageTypeIds: scopedStorageTypeIds }
      : {}),
    ...(Object.keys(itemFilter).length > 0 ? { itemFilter } : {})
  };

  const created = await insertInventoryCount(client, {
    inventoryCountId: sequence.data as string,
    locationId,
    isBlind,
    notes: notes ?? null,
    scope: scope as Json,
    companyId,
    createdBy: userId
  });

  if (created.error || !created.data) {
    return data(
      {},
      await flash(
        request,
        error(created.error, "Failed to create inventory count")
      )
    );
  }

  // Snapshot current on-hand into count lines (multi-row, transactional). The
  // header insert above and this snapshot aren't a single transaction, so if
  // line generation fails, delete the just-created header rather than leaving an
  // orphan empty Draft count behind.
  try {
    await generateInventoryCountLines(getDatabaseClient(), {
      inventoryCountId: created.data.id,
      companyId,
      locationId,
      createdBy: userId,
      storageUnitIds: expandedStorageUnitIds,
      storageTypeIds: scopedStorageTypeIds,
      itemType,
      materialSubstanceId,
      materialFormId,
      finishId,
      gradeId,
      dimensionId,
      materialTypeId,
      tags: scopedTags
    });
  } catch (err) {
    await deleteInventoryCount(client, created.data.id, companyId);
    return data(
      {},
      await flash(request, error(err, "Failed to generate count lines"))
    );
  }

  throw redirect(
    path.to.inventoryCount(created.data.id),
    await flash(request, success("Inventory count created"))
  );
}

export default function NewInventoryCountRoute() {
  const navigate = useNavigate();
  const { tags } = useLoaderData<typeof loader>();

  return (
    <InventoryCountForm
      initialValues={{ locationId: "", isBlind: false }}
      availableTags={tags.map((name) => ({ name }))}
      onClose={() => navigate(-1)}
    />
  );
}
