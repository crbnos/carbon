// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo } from "react";
import { LuFactory, LuMapPin, LuTags } from "react-icons/lu";
import { useFetcher } from "react-router";
import { usePeople } from "~/stores";

// The responsibleEmployee ownership tree (spec §P1.3), configured the way
// printer assignments are (AssignmentsCard): company default → per-location →
// per-(location, item group). Unset rows show the value they inherit. Sparse:
// only configured cells persist; clearing a row returns it to inheritance.

type OwnershipUpdate = {
  intent: "setCompanyDefault" | "setLocation" | "setItemGroup";
  locationId?: string;
  itemPostingGroupId?: string;
  employeeId: string;
};

export function ResponsibleEmployeeCard({
  defaultResponsibleEmployee,
  locations,
  itemGroups,
  responsibilities
}: {
  defaultResponsibleEmployee: string | null;
  locations: { id: string; name: string; responsibleEmployee: string | null }[];
  itemGroups: { id: string; name: string }[];
  responsibilities: {
    locationId: string;
    itemPostingGroupId: string;
    responsibleEmployee: string | null;
  }[];
}) {
  const { t } = useLingui();
  const [people] = usePeople();
  const ownershipFetcher = useFetcher<{ success: boolean; message: string }>();

  const peopleOptions = useMemo(
    () => [
      { value: "", label: t`Unassigned` },
      ...people
        .filter((person) => person.active !== false)
        .map((person) => ({ value: person.id, label: person.name }))
    ],
    [people, t]
  );

  const personName = useCallback(
    (id: string | null | undefined) =>
      id ? (people.find((p) => p.id === id)?.name ?? null) : null,
    [people]
  );

  const responsibilityByCell = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const row of responsibilities) {
      map.set(
        `${row.locationId}:${row.itemPostingGroupId}`,
        row.responsibleEmployee
      );
    }
    return map;
  }, [responsibilities]);

  // On every finished save, as the page's other cards do. Keyed on the
  // message, a second save answering with the same text showed nothing.
  useEffect(() => {
    if (ownershipFetcher.state !== "idle" || !ownershipFetcher.data?.message) {
      return;
    }
    if (ownershipFetcher.data.success) {
      toast.success(ownershipFetcher.data.message);
    } else {
      toast.error(ownershipFetcher.data.message);
    }
  }, [ownershipFetcher.state, ownershipFetcher.data]);

  const submitOwnership = useCallback(
    (update: OwnershipUpdate) => {
      const formData = new FormData();
      formData.set("intent", update.intent);
      if (update.locationId) formData.set("locationId", update.locationId);
      if (update.itemPostingGroupId) {
        formData.set("itemPostingGroupId", update.itemPostingGroupId);
      }
      formData.set("employeeId", update.employeeId);
      ownershipFetcher.submit(formData, { method: "POST" });
    },
    [ownershipFetcher]
  );

  const companyDefaultName = personName(defaultResponsibleEmployee);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Planning Ownership</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Who owns MRP planning actions. Locations inherit the company
            default; item groups inherit their location. The most specific
            assignment wins, and each item can override on its Planning tab.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col">
          <OwnershipRow
            label={t`Company default`}
            icon={<LuFactory />}
            isBold
            value={defaultResponsibleEmployee}
            inheritedName={null}
            options={peopleOptions}
            onChange={(employeeId) =>
              submitOwnership({ intent: "setCompanyDefault", employeeId })
            }
          />
          {locations.map((location) => {
            const locationInheritedName =
              personName(location.responsibleEmployee) ?? companyDefaultName;
            return (
              <div
                key={location.id}
                className="border-t border-border mt-1 pt-1"
              >
                <OwnershipRow
                  label={location.name}
                  icon={<LuMapPin />}
                  isBold
                  value={location.responsibleEmployee}
                  inheritedName={companyDefaultName}
                  options={peopleOptions}
                  onChange={(employeeId) =>
                    submitOwnership({
                      intent: "setLocation",
                      locationId: location.id,
                      employeeId
                    })
                  }
                />
                {itemGroups.map((group) => (
                  <OwnershipRow
                    key={group.id}
                    label={group.name}
                    icon={<LuTags />}
                    isIndented
                    value={
                      responsibilityByCell.get(`${location.id}:${group.id}`) ??
                      null
                    }
                    inheritedName={locationInheritedName}
                    options={peopleOptions}
                    onChange={(employeeId) =>
                      submitOwnership({
                        intent: "setItemGroup",
                        locationId: location.id,
                        itemPostingGroupId: group.id,
                        employeeId
                      })
                    }
                  />
                ))}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function OwnershipRow({
  label,
  icon,
  isBold,
  isIndented,
  value,
  inheritedName,
  options,
  onChange
}: {
  label: string;
  icon: ReactNode;
  isBold?: boolean;
  isIndented?: boolean;
  value: string | null;
  inheritedName: string | null;
  options: { value: string; label: string }[];
  onChange: (employeeId: string) => void;
}) {
  const { t } = useLingui();
  const placeholder = value
    ? undefined
    : inheritedName
      ? t`inherits ${inheritedName}`
      : t`Unassigned`;

  return (
    <div
      className={`flex items-center justify-between py-2.5 ${isIndented ? "pl-7" : ""} ${!isBold ? "border-t border-border/50" : ""}`}
    >
      <div className="flex items-center gap-2">
        <div className="size-7 bg-muted rounded-lg flex items-center justify-center shrink-0">
          <span className="size-4 text-muted-foreground">{icon}</span>
        </div>
        <span
          className={`text-sm ${isBold ? "font-medium" : "text-muted-foreground"}`}
        >
          {label}
        </span>
      </div>

      <div className="w-[320px]">
        <Combobox
          size="sm"
          value={value ?? ""}
          options={options}
          onChange={(selected) => onChange(selected)}
          isClearable
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
