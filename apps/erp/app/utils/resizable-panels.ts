// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { z } from "zod";

const resizableConfig = z
  .object({ layout: z.array(z.number()).optional() })
  .default({ layout: undefined });
type ResizableConfig = z.infer<typeof resizableConfig>;

function getCookieValue(
  cookieHeader: string | null,
  cookieName: string
): ResizableConfig {
  const cookieValue = cookieHeader?.split(`${cookieName}=`)[1]?.split(";")[0];
  if (!cookieValue) {
    return { layout: undefined };
  }
  try {
    const json = JSON.parse(cookieValue);
    return resizableConfig.parse(json);
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  } catch (e) {
    return { layout: undefined };
  }
}

//run page
const runResizableName = "resizable-panels:run";

export async function getResizableGanttSettings(
  request: Request
): Promise<ResizableConfig> {
  const cookieHeader = request.headers.get("Cookie");
  return getCookieValue(cookieHeader, runResizableName);
}

export async function setResizableGanttSettings(
  document: Document,
  layout: number[]
) {
  document.cookie = `${runResizableName}=${JSON.stringify({ layout })}`;
}
