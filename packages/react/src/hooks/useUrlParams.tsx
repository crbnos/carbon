// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback } from "react";
import { useSearchParams, useSubmit } from "react-router";

export function useUrlParams(): [
  URLSearchParams,
  (
    params: Record<string, string | string[] | number | undefined | null>
  ) => void
] {
  const submit = useSubmit();
  const [searchParams] = useSearchParams();

  const setSearchParams = useCallback(
    (params: Record<string, string | string[] | number | undefined | null>) => {
      Object.entries(params).forEach(([name, value]) => {
        if (value) {
          if (Array.isArray(value)) {
            if (value.length === 0) {
              searchParams.delete(name);
            } else {
              value.forEach((v, i) => {
                if (i === 0) {
                  searchParams.set(name, v.toString());
                } else {
                  searchParams.append(name, v.toString());
                }
              });
            }
          } else {
            searchParams.set(name, value.toString());
          }
        } else {
          searchParams.delete(name);
        }
      });

      submit(searchParams);
    },
    [submit, searchParams]
  );

  return [searchParams, setSearchParams];
}
