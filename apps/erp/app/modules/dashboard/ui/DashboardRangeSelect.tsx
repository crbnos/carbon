import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useUrlParams
} from "@carbon/react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import { useDashboardRangeLabels } from "../dashboard.labels";
import type { DashboardRange } from "../dashboard.models";
import { DASHBOARD_RANGES } from "../dashboard.models";

/**
 * Page-wide range. Writes `?range=` (so the URL is shareable and the loader
 * picks it up on the next render) AND saves it as the user's preference.
 */
export function DashboardRangeSelect({ value }: { value: DashboardRange }) {
  const rangeLabels = useDashboardRangeLabels();
  const [, setParams] = useUrlParams();
  const fetcher = useFetcher();

  const onChange = (next: string) => {
    if (next === value) return;
    fetcher.submit(JSON.stringify({ range: next }), {
      method: "post",
      action: path.to.api.dashboardPreference,
      encType: "application/json"
    });
    setParams({ range: next });
  };

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DASHBOARD_RANGES.map((range) => (
          <SelectItem key={range} value={range}>
            {rangeLabels[range]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
