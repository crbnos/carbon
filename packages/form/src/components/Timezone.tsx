import {
  getTimezoneAbbreviations,
  getTimezoneDisplayName,
  getTimezones,
  type TimezoneGroup
} from "@carbon/utils";
import { useMemo } from "react";
import type { ComboboxProps } from "./Combobox";
import Combobox from "./Combobox";

type TimezoneProps = Omit<ComboboxProps, "options"> & {
  /**
   * Grouped zone options. Pass the database-sourced list (pg_timezone_names
   * via the ERP wrapper) when available; falls back to the runtime's Intl
   * list, whose canonicalization/freshness varies by engine.
   */
  options?: TimezoneGroup[];
};

/**
 * Timezone picker. One line per zone — "America/New York (GMT-04:00)". The
 * family name ("Eastern Time") and abbreviations (EST/EDT) go in `keywords`,
 * which the Combobox searches but never renders.
 */
const Timezone = ({ options, ...props }: TimezoneProps) => {
  const flatOptions = useMemo(() => {
    const groups = options?.length ? options : getTimezones();
    return groups.flatMap((group) =>
      group.options
        .map((option) => {
          const offset = /[+-]\d{2}:\d{2}/.exec(option.label)?.[0];
          const abbreviations = getTimezoneAbbreviations(option.value)
            .filter((a) => a !== option.value)
            .join(" ");
          return {
            value: option.value,
            label: `${option.value.replace(/_/g, " ")}${
              offset ? ` (GMT${offset})` : ""
            }`,
            keywords: [
              option.value,
              getTimezoneDisplayName(option.value),
              abbreviations
            ]
              .filter(Boolean)
              .join(" ")
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label))
    );
  }, [options]);

  return <Combobox {...props} options={flatOptions} />;
};

Timezone.displayName = "Timezone";

export default Timezone;
