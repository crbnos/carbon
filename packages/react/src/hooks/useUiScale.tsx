// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { UiScale } from "@carbon/utils";
import { asDensity, asTextSize, DENSITIES } from "@carbon/utils";
import { useFetchers } from "react-router";
import { useRouteData } from "./useRouteData";

/**
 * The text size and density to render. A pending pick wins, so the change
 * shows before the root loader revalidates with the cookie.
 */
export function useUiScale(): UiScale {
  const fetchers = useFetchers();
  const routeData = useRouteData<Partial<UiScale>>("/");
  const pending = (field: keyof UiScale) =>
    fetchers
      .find((f) => f.formAction === "/" && f.formData?.has(field))
      ?.formData?.get(field);

  return {
    textSize: asTextSize(pending("textSize") ?? routeData?.textSize),
    density: asDensity(pending("density") ?? routeData?.density)
  };
}

/** The density's spacing factor, for a height kept in px (a virtual row). */
export function useDensityScale(): number {
  return DENSITIES[useUiScale().density];
}
