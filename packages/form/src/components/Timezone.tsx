import {
  getTimezoneAbbreviations,
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
 * Searchable timezone picker. Options are flattened to full IANA names with
 * their colloquial abbreviations and current offset —
 * "America/Chicago (CST/CDT, -06:00)" — so search matches by city, region,
 * offset, or the abbreviation people actually type (CST, EST, IST, …). The
 * offset is relative to UTC by definition, so no "UTC" prefix.
 */
const Timezone = ({ options, ...props }: TimezoneProps) => {
  const flatOptions = useMemo(() => {
    const groups = options?.length ? options : getTimezones();
    return groups.flatMap((group) =>
      group.options.map((option) => {
        const offset = /[+-]\d{2}:\d{2}/.exec(option.label)?.[0];
        const abbreviations = getTimezoneAbbreviations(option.value)
          .filter((a) => a !== option.value)
          .join("/");
        const detail = [abbreviations, offset].filter(Boolean).join(", ");
        return {
          value: option.value,
          label: `${option.value.replace(/_/g, " ")}${
            detail ? ` (${detail})` : ""
          }`
        };
      })
    );
  }, [options]);

  return <Combobox {...props} options={flatOptions} />;
};

Timezone.displayName = "Timezone";

export default Timezone;
