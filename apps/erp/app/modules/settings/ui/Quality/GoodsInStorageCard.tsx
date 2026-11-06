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
  cn,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useId, useMemo } from "react";
import { LuMapPin } from "react-icons/lu";

// Both goods-in units must be non-nettable, so the loader passes only
// non-nettable, active storage units.

type StoredStorageUnit = {
  name: string;
  effectiveNettable: boolean;
  active: boolean;
};

type GoodsInStorageLocation = {
  id: string;
  name: string;
  inspectionStorageUnitId: string | null;
  rejectedStorageUnitId: string | null;
  inspectionStorageUnit: StoredStorageUnit | null;
  rejectedStorageUnit: StoredStorageUnit | null;
};

type GoodsInStorageUnit = { id: string; name: string; locationId: string };

type GoodsInStorageField = "inspectionStorageUnitId" | "rejectedStorageUnitId";

type Option = { value: string; label: string };

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
    const map = new Map<string, Option[]>();
    for (const unit of storageUnits) {
      const options = map.get(unit.locationId) ?? [];
      options.push({ value: unit.id, label: unit.name });
      map.set(unit.locationId, options);
    }
    return map;
  }, [storageUnits]);

  // A save sends only the field that changed, so a stale page never writes
  // back the other one. The selectors wait for the last save to reload.
  const submit = useCallback(
    (
      locationId: string,
      field: GoodsInStorageField,
      storageUnitId: string | null
    ) => {
      const formData = new FormData();
      formData.set("intent", "setLocationGoodsInStorage");
      formData.set("locationId", locationId);
      formData.set(field, storageUnitId ?? "");
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
                className={cn(
                  "flex flex-col gap-3 py-2.5 md:flex-row md:items-center md:justify-between",
                  index > 0 && "border-t border-border"
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="size-7 bg-muted rounded-lg flex items-center justify-center shrink-0">
                    <span className="size-4 text-muted-foreground">
                      <LuMapPin />
                    </span>
                  </div>
                  <span className="text-sm font-medium">{location.name}</span>
                </div>

                <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:flex md:w-auto md:items-start md:gap-4">
                  <GoodsInStorageSelect
                    label={t`Inspection`}
                    ariaLabel={t`${location.name} inspection storage unit`}
                    value={location.inspectionStorageUnitId}
                    storedUnit={location.inspectionStorageUnit}
                    options={options}
                    placeholder={placeholder}
                    isPending={fetcher.isPending}
                    onChange={(selected) =>
                      submit(location.id, "inspectionStorageUnitId", selected)
                    }
                  />
                  <GoodsInStorageSelect
                    label={t`Rejected`}
                    ariaLabel={t`${location.name} rejected storage unit`}
                    value={location.rejectedStorageUnitId}
                    storedUnit={location.rejectedStorageUnit}
                    options={options}
                    placeholder={placeholder}
                    isPending={fetcher.isPending}
                    onChange={(selected) =>
                      submit(location.id, "rejectedStorageUnitId", selected)
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function GoodsInStorageSelect({
  label,
  ariaLabel,
  value,
  storedUnit,
  options,
  placeholder,
  isPending,
  onChange
}: {
  label: string;
  ariaLabel: string;
  value: string | null;
  storedUnit: StoredStorageUnit | null;
  options: Option[];
  placeholder: string;
  isPending: boolean;
  onChange: (storageUnitId: string | null) => void;
}) {
  const { t } = useLingui();
  const warningId = useId();
  // A stored unit that is no longer offered (made nettable or inactive since)
  // still shows by name, with why it no longer fits.
  const notOffered = !!value && !options.some((o) => o.value === value);
  const name = storedUnit?.name ?? value ?? "";
  const shownOptions = notOffered
    ? [...options, { value: value!, label: name }]
    : options;
  const warning = !notOffered
    ? null
    : storedUnit?.effectiveNettable
      ? t`${name} is nettable now. Choose a non-nettable storage unit.`
      : storedUnit && !storedUnit.active
        ? t`${name} is inactive. Choose an active storage unit.`
        : t`Choose a non-nettable storage unit at this location.`;

  return (
    <div className="flex w-full min-w-0 flex-col gap-1 md:w-[220px]">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Combobox
        size="sm"
        value={value ?? ""}
        options={shownOptions}
        onChange={(selected) => onChange(selected || null)}
        isClearable
        aria-label={ariaLabel}
        aria-describedby={warning ? warningId : undefined}
        aria-invalid={warning ? true : undefined}
        disabled={isPending || (options.length === 0 && !value)}
        placeholder={placeholder}
      />
      {warning && (
        <span id={warningId} className="text-xs text-destructive">
          {warning}
        </span>
      )}
    </div>
  );
}
