import { Timezone as TimezoneBase } from "@carbon/form";
import { useMount } from "@carbon/react";
import type { TimezoneGroup } from "@carbon/utils";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import type { getTimezoneNames } from "~/modules/shared/shared.service";
import { path } from "~/utils/path";

/**
 * Timezone picker fed by the DATABASE's tzdata (pg_timezone_names via
 * api/timezones) — the authoritative list for what AT TIME ZONE resolves.
 * While loading (or if the fetch fails) the base component falls back to the
 * runtime's Intl list.
 */
const Timezone = (props: ComponentProps<typeof TimezoneBase>) => {
  const fetcher = useFetcher<Awaited<ReturnType<typeof getTimezoneNames>>>();

  useMount(() => {
    fetcher.load(path.to.api.timezones);
  });

  const options = useMemo<TimezoneGroup[] | undefined>(() => {
    const zones = fetcher.data?.data;
    if (!zones?.length) return undefined;

    const groups = new Map<string, TimezoneGroup["options"]>();
    for (const { name, utcOffset } of zones) {
      const [region = "Other", ...rest] = name.split("/");
      const city = rest.join("/").replace(/_/g, " ");
      const group = rest.length === 0 ? "Other" : region;
      // pg interval text: "05:30:00" / "-06:00:00" / "00:00:00" → "±HH:MM"
      // (relative-to-UTC is implied; no "UTC" prefix noise in the label)
      const offset = utcOffset.startsWith("-")
        ? `-${utcOffset.slice(1, 6)}`
        : `+${utcOffset.slice(0, 5)}`;
      const label = `${city || name} (${offset})`;
      const list = groups.get(group) ?? [];
      list.push({ label, value: name });
      groups.set(group, list);
    }

    const regionOrder = [
      "America",
      "Europe",
      "Asia",
      "Africa",
      "Australia",
      "Pacific",
      "Atlantic",
      "Indian",
      "Antarctica",
      "Arctic",
      "Other"
    ];

    return [...groups.entries()]
      .sort(
        ([a], [b]) =>
          (regionOrder.indexOf(a) + 1 || 99) -
          (regionOrder.indexOf(b) + 1 || 99)
      )
      .map(([label, list]) => ({
        label,
        options: list.sort((a, b) => a.label.localeCompare(b.label))
      }));
  }, [fetcher.data]);

  return <TimezoneBase {...props} options={options} />;
};

export default Timezone;
