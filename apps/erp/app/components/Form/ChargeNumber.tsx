// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox, useControlField } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useLocalStorage } from "@carbon/react";
import { useMemo } from "react";
import type { ChargeNumber as ChargeNumberRow } from "~/modules/projects";
import { path } from "~/utils/path";

const RECENT_KEY = "charge-numbers-recent";
const RECENT_LIMIT = 8;
const NO_CHARGE_NUMBERS: ChargeNumberRow[] = [];

/** The charge numbers a user can pick, loaded once and cached. */
export function useChargeNumbers(): ChargeNumberRow[] {
  const { data } = useLoaderQuery<{ data: ChargeNumberRow[] }>(
    path.to.api.projectChargeNumbers
  );
  return data?.data ?? NO_CHARGE_NUMBERS;
}

/** Joins a project and an element into the picker's value. */
export function chargeNumberValue(
  projectId?: string | null,
  projectElementId?: string | null
) {
  return projectId ? `${projectId}|${projectElementId ?? ""}` : "";
}

/** Splits the picker's value into a project and an element. */
export function splitChargeNumber(value?: string | null) {
  const [projectId = "", projectElementId = ""] = (value ?? "").split("|");
  return { projectId, projectElementId };
}

type ChargeNumberProps = Omit<
  ComboboxProps,
  "name" | "options" | "value" | "onChange"
> & {
  /** Form field names of the two hidden inputs. */
  projectName?: string;
  projectElementName?: string;
  onChange?: (selected: ChargeNumberRow | null) => void;
};

/**
 * Picks a charge number: a Released project, or a chargeable element of
 * one. The form receives two fields, `projectId` and `projectElementId`.
 * The last 8 picks show first.
 */
const ChargeNumber = ({
  projectName = "projectId",
  projectElementName = "projectElementId",
  label,
  onChange,
  ...props
}: ChargeNumberProps) => {
  const chargeNumbers = useChargeNumbers();
  const [recent, setRecent] = useLocalStorage<string[]>(RECENT_KEY, []);

  const [projectId, setProjectId] = useControlField<string | undefined>(
    projectName
  );
  const [projectElementId, setProjectElementId] = useControlField<
    string | undefined
  >(projectElementName);

  const options = useMemo(() => {
    const rank = new Map(recent.map((value, index) => [value, index]));
    return [...chargeNumbers]
      .sort(
        (a, b) =>
          (rank.get(a.value) ?? RECENT_LIMIT) -
          (rank.get(b.value) ?? RECENT_LIMIT)
      )
      .map((row) => ({
        value: row.value,
        label: (
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 whitespace-nowrap font-medium">
              {row.readableId}
            </span>
            <span className="truncate">{row.name}</span>
          </span>
        ),
        helper: row.projectElementId ? row.projectName : undefined,
        keywords: [row.readableId, row.name, row.projectName].join(" ")
      }));
  }, [chargeNumbers, recent]);

  const fieldName = `${projectName}__${projectElementName}`;

  return (
    <>
      <input type="hidden" name={projectName} value={projectId ?? ""} />
      <input
        type="hidden"
        name={projectElementName}
        value={projectElementId ?? ""}
      />
      <Combobox
        {...props}
        name={fieldName}
        label={label}
        options={options}
        value={chargeNumberValue(projectId, projectElementId)}
        onChange={(selected) => {
          const value = selected?.value ?? "";
          const split = splitChargeNumber(value);
          setProjectId(split.projectId || undefined);
          setProjectElementId(split.projectElementId || undefined);
          if (value) {
            setRecent((previous) =>
              [value, ...previous.filter((v) => v !== value)].slice(
                0,
                RECENT_LIMIT
              )
            );
          }
          onChange?.(chargeNumbers.find((row) => row.value === value) ?? null);
        }}
      />
    </>
  );
};

ChargeNumber.displayName = "ChargeNumber";

export default ChargeNumber;
