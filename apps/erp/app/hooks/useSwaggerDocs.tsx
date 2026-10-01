// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useMount } from "@carbon/react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

type SwaggerDocsSchema = {
  paths: Record<string, any>;
  definitions: Record<string, any>;
};

export const useSwaggerDocs = () => {
  const docsFetcher = useFetcher<SwaggerDocsSchema>();

  useMount(() => {
    docsFetcher.load(path.to.api.docs);
  });

  return docsFetcher.data;
};
