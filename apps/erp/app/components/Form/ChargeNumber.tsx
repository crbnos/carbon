// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox, useControlField } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { Combobox as ComboboxBase, useLocalStorage } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
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
  "name" | "options" | "value" | "onChange" | "inline"
> & {
  /** Render as an inline property (the Properties panel). */
  inline?: boolean;
  /** Form field names of the two hidden inputs. */
  projectName?: string;
  projectElementName?: string;
  /** Only the leave elements (PTO on My Time). */
  leaveOnly?: boolean;
  onChange?: (selected: ChargeNumberRow | null) => void;
};

/**
 * The picker's options, the most recent 8 picks first, and `remember` to
 * record a pick.
 */
function useChargeNumberOptions(leaveOnly = false) {
  const allChargeNumbers = useChargeNumbers();
  const chargeNumbers = useMemo(
    () =>
      leaveOnly
        ? allChargeNumbers.filter((row) => row.isLeave)
        : allChargeNumbers,
    [allChargeNumbers, leaveOnly]
  );
  const [recent, setRecent] = useLocalStorage<string[]>(RECENT_KEY, []);
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
  const remember = (value: string) => {
    if (!value) return;
    setRecent((previous) =>
      [value, ...previous.filter((v) => v !== value)].slice(0, RECENT_LIMIT)
    );
  };
  return { chargeNumbers, options, remember };
}

/**
 * A charge number picker outside a form: the caller holds the value. Used by
 * the coding lines of a document, which submit as one JSON field.
 */
export function ChargeNumberControlled({
  projectId,
  projectElementId,
  onChange,
  isReadOnly
}: {
  projectId: string | null;
  projectElementId: string | null;
  onChange: (projectId: string | null, projectElementId: string | null) => void;
  isReadOnly?: boolean;
}) {
  const { t } = useLingui();
  const { options, remember } = useChargeNumberOptions();
  return (
    <ComboboxBase
      size="sm"
      isClearable
      isReadOnly={isReadOnly}
      placeholder={t`Charge number (optional)`}
      options={options}
      value={chargeNumberValue(projectId, projectElementId)}
      onChange={(value) => {
        const split = splitChargeNumber(value);
        remember(value);
        onChange(split.projectId || null, split.projectElementId || null);
      }}
    />
  );
}

/**
 * Picks a charge number: a Released project, or a chargeable element of
 * one. The form receives two fields, `projectId` and `projectElementId`.
 * The last 8 picks show first.
 */
/** The inline preview: the picked option's label. */
const ChargeNumberPreview = (
  value: string,
  options: { value: string; label: ReactNode }[]
) => options.find((option) => option.value === value)?.label ?? null;

const ChargeNumber = ({
  projectName = "projectId",
  projectElementName = "projectElementId",
  label,
  onChange,
  inline = false,
  leaveOnly = false,
  ...props
}: ChargeNumberProps) => {
  const { chargeNumbers, options, remember } =
    useChargeNumberOptions(leaveOnly);

  const [projectId, setProjectId] = useControlField<string | undefined>(
    projectName
  );
  const [projectElementId, setProjectElementId] = useControlField<
    string | undefined
  >(projectElementName);

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
        inline={inline ? ChargeNumberPreview : undefined}
        name={fieldName}
        label={label}
        options={options}
        value={chargeNumberValue(projectId, projectElementId)}
        onChange={(selected) => {
          const value = selected?.value ?? "";
          const split = splitChargeNumber(value);
          setProjectId(split.projectId || undefined);
          setProjectElementId(split.projectElementId || undefined);
          remember(value);
          onChange?.(chargeNumbers.find((row) => row.value === value) ?? null);
        }}
      />
    </>
  );
};

ChargeNumber.displayName = "ChargeNumber";

export default ChargeNumber;
