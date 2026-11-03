// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Combobox,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useMemo } from "react";
import { LuMapPin } from "react-icons/lu";

// Per-location goods-in storage: where received parts wait for inspection,
// and where rejected stock goes. Both must be non-nettable, so the loader
// passes only non-nettable, active storage units.

type GoodsInStorageLocation = {
  id: string;
  name: string;
  inspectionStorageUnitId: string | null;
  rejectedStorageUnitId: string | null;
};

type GoodsInStorageUnit = { id: string; name: string; locationId: string };

export function GoodsInStorageCard({
  locations,
  storageUnits
}: {
  locations: GoodsInStorageLocation[];
  storageUnits: GoodsInStorageUnit[];
}) {
  const { t } = useLingui();
  const fetcher = useAction({
    onSuccess: ({ data }) => {
      if (data?.locationGoodsInStorage) {
        toast.success(t`Goods-in storage updated`);
      }
    }
  });

  const optionsByLocation = useMemo(() => {
    const map = new Map<string, { value: string; label: string }[]>();
    for (const unit of storageUnits) {
      const options = map.get(unit.locationId) ?? [];
      options.push({ value: unit.id, label: unit.name });
      map.set(unit.locationId, options);
    }
    return map;
  }, [storageUnits]);

  const submit = useCallback(
    (
      locationId: string,
      inspectionStorageUnitId: string | null,
      rejectedStorageUnitId: string | null
    ) => {
      const formData = new FormData();
      formData.set("intent", "setLocationGoodsInStorage");
      formData.set("locationId", locationId);
      formData.set("inspectionStorageUnitId", inspectionStorageUnitId ?? "");
      formData.set("rejectedStorageUnitId", rejectedStorageUnitId ?? "");
      fetcher.submit(formData, { method: "POST" });
    },
    [fetcher]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Goods-in storage</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Received parts that need inspection go to the inspection storage
            unit. Rejected stock moves to the rejected storage unit. Both must
            be non-nettable.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col">
          {locations.map((location, index) => {
            const options = optionsByLocation.get(location.id) ?? [];
            const placeholder =
              options.length === 0
                ? t`No non-nettable storage units`
                : t`Not set`;
            return (
              <div
                key={location.id}
                className={`flex items-center justify-between py-2.5 ${index > 0 ? "border-t border-border" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <div className="size-7 bg-muted rounded-lg flex items-center justify-center shrink-0">
                    <span className="size-4 text-muted-foreground">
                      <LuMapPin />
                    </span>
                  </div>
                  <span className="text-sm font-medium">{location.name}</span>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex flex-col gap-1 w-[220px]">
                    <span className="text-xs text-muted-foreground">
                      <Trans>Inspection</Trans>
                    </span>
                    <Combobox
                      size="sm"
                      value={location.inspectionStorageUnitId ?? ""}
                      options={options}
                      onChange={(selected) =>
                        submit(
                          location.id,
                          selected || null,
                          location.rejectedStorageUnitId
                        )
                      }
                      isClearable
                      disabled={options.length === 0}
                      placeholder={placeholder}
                    />
                  </div>
                  <div className="flex flex-col gap-1 w-[220px]">
                    <span className="text-xs text-muted-foreground">
                      <Trans>Rejected</Trans>
                    </span>
                    <Combobox
                      size="sm"
                      value={location.rejectedStorageUnitId ?? ""}
                      options={options}
                      onChange={(selected) =>
                        submit(
                          location.id,
                          location.inspectionStorageUnitId,
                          selected || null
                        )
                      }
                      isClearable
                      disabled={options.length === 0}
                      placeholder={placeholder}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
