// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Card, CardContent } from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useCallback, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { PartMethodPage } from "../../items.service";
import type {
  Material,
  MaterialOperation,
  TemporaryMaterials
} from "./BillOfMaterial";
import {
  initialMethodMaterial,
  MaterialForm,
  makeMaterialItem
} from "./BillOfMaterial";
import {
  MethodLineNav,
  useMethodAccess,
  useMethodConfigurator
} from "./MethodPageFrame";
import { getMethodSearch } from "./methodPageUtils";

const noop = () => {};

export function MaterialLineWorkspace({
  itemId,
  page,
  lineId,
  replenishmentSystem
}: {
  itemId: string;
  page: PartMethodPage;
  /** Omit it to add a new line. */
  lineId?: string;
  replenishmentSystem?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const search = getMethodSearch(location.search);
  const { isReadOnly } = useMethodAccess(page);
  const { onConfigure, rulesByField, editor } = useMethodConfigurator(page);
  const [items] = useItems();

  const materials = [...page.methodMaterials].sort((a, b) => a.order - b.order);
  const saved = materials.find((material) => material.id === lineId);
  const isNew = !lineId;

  const [newLineId] = useState(() => nanoid());
  const data = saved ?? {
    ...initialMethodMaterial,
    id: newLineId,
    makeMethodId: page.makeMethod.id,
    order: Math.max(0, ...materials.map((m) => m.order)) + 1
  };
  const item = makeMaterialItem(
    items,
    data as unknown as Material,
    data.order,
    false
  );
  const temporaryItems: TemporaryMaterials = isNew
    ? { [item.id]: item.data as Material }
    : {};

  // The form stays mounted and re-runs its save handler when this changes.
  const onSubmit = useCallback(
    (savedId?: string) => {
      if (isNew && savedId) {
        navigate(`${path.to.partBillOfMaterialLine(itemId, savedId)}${search}`);
      }
    },
    [isNew, itemId, navigate, search]
  );

  // Deleted, a changed version, or a read-only method with nothing to add to.
  if (isNew ? isReadOnly : !saved) {
    return (
      <Navigate replace to={`${path.to.partBillOfMaterial(itemId)}${search}`} />
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <MethodLineNav
        page={page}
        backLabel={<Trans>Bill of Material</Trans>}
        backTo={path.to.partBillOfMaterial(itemId)}
        title={
          isNew ? (
            <Trans>New Item</Trans>
          ) : (
            getItemReadableId(items, saved?.itemId)
          )
        }
        subtitle={saved?.description}
        lineIds={materials.map((material) => material.id!)}
        currentId={item.id}
        getLinePath={(id) => path.to.partBillOfMaterialLine(itemId, id)}
      />
      <Card>
        <CardContent className="pt-6">
          <MaterialForm
            // A new form after a save: what it holds is now what is saved.
            key={JSON.stringify(saved)}
            configurable={page.configurable}
            isReadOnly={isReadOnly}
            item={item}
            methodOperations={
              page.methodOperations as unknown as MaterialOperation[]
            }
            orderState={{ [item.id]: item.data.order }}
            temporaryItems={temporaryItems}
            rulesByField={rulesByField}
            onConfigure={onConfigure}
            replenishmentSystem={replenishmentSystem}
            setOrderState={noop}
            setSelectedItemId={noop}
            setTemporaryItems={noop}
            onSubmit={onSubmit}
          />
        </CardContent>
      </Card>
      {editor}
    </div>
  );
}
