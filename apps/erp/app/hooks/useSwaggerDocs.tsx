// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLoaderQuery } from "@carbon/query";
import { path } from "~/utils/path";

type SwaggerDocsSchema = {
  paths: Record<string, any>;
  definitions: Record<string, any>;
};

export const useSwaggerDocs = () => {
  const docsFetcher = useLoaderQuery<SwaggerDocsSchema>(path.to.api.docs);

  return docsFetcher.data;
};
