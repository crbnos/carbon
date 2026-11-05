// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import { Await, useParams } from "react-router";
import { CadModel } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { PartMethodPage } from "~/modules/items/items.service";
import type { PartSummary } from "~/modules/items/types";
import { BillOfMaterialTable } from "~/modules/items/ui/Item/BillOfMaterialTable";
import type { getModelByItemId } from "~/modules/shared/shared.service";
import { path } from "~/utils/path";

export default function PartBillOfMaterialIndexRoute() {
  const { t } = useLingui();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const permissions = usePermissions();
  const partData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId)
  );
  const page = useRouteData<
    PartMethodPage & {
      subAssemblyModel: ReturnType<typeof getModelByItemId> | null;
    }
  >(path.to.partBillOfMaterial(itemId));

  if (!page) return null;

  return (
    <>
      <BillOfMaterialTable
        itemId={itemId}
        page={page}
        replenishmentSystem={partData?.partSummary?.replenishmentSystem}
      />
      {page.subAssemblyModel && (
        <div className="w-full px-4 pb-4">
          <Suspense fallback={null}>
            <Await resolve={page.subAssemblyModel}>
              {(model) => (
                <CadModel
                  key={`cad:${model.itemId}`}
                  isReadOnly={!permissions.can("update", "parts")}
                  metadata={{ itemId: model?.itemId ?? undefined }}
                  modelUpload={model ?? null}
                  title={t`CAD Model`}
                  uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
                  viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
                />
              )}
            </Await>
          </Suspense>
        </div>
      )}
    </>
  );
}
