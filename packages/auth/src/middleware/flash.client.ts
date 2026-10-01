// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast } from "@carbon/react";
import type { MiddlewareFunction } from "react-router";
import type { Result } from "../types";

type ClientMiddlewareResult = Record<
  string,
  { type: "data" | "error"; result: unknown }
>;

export const flashClientMiddleware: MiddlewareFunction<
  ClientMiddlewareResult
> = async (_args, next) => {
  const data = await next();

  const rootData = data?.root;
  if (rootData?.type === "data" && rootData.result) {
    const result = (rootData.result as Record<string, unknown>)
      .result as Result | null;
    if (result?.success === true) {
      toast.success(result.message, { description: result.description });
    } else if (result?.message) {
      toast.error(result.message, { description: result.description });
    }
  }

  return data;
};
