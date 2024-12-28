import { useRouteData } from "@carbon/remix";
import { useCallback } from "react";
import type { Integration } from "~/modules/settings";
import { path } from "~/utils/path";

export function useIntegrations(): {
  list: Integration[];
  has: (id: string) => boolean;
} {
  const list = useRouteData<{
    integrations: Integration[];
  }>(path.to.authenticatedRoot);

  const has = useCallback(
    (id: string) => {
      return list?.integrations.find((i) => i.id === id)?.active ?? false;
    },
    [list?.integrations]
  );

  return {
    list: list?.integrations ?? [],
    has,
  };
}
