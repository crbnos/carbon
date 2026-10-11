// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { InputProps } from "@carbon/react";
import {
  cn,
  Input,
  InputGroup,
  InputLeftElement,
  useDebounce
} from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import { LuSearch } from "react-icons/lu";
import { useUrlParams } from "~/hooks";

type SearchFilterProps = InputProps & {
  param: string;
  /** Classes for the input group (the outer box). */
  groupClassName?: string;
};

const SearchFilter = ({
  param,
  size,
  className,
  groupClassName,
  ...props
}: SearchFilterProps) => {
  const [params, setParams] = useUrlParams();
  const urlQuery = params.get(param) || "";
  const [query, setQuery] = useState(urlQuery);
  // What this input last wrote to the URL. A different value there came from
  // elsewhere (a saved view, back/forward, a link) and replaces the text; our
  // own write arriving late must not undo what was typed since.
  const written = useRef(urlQuery);
  const debounceQuery = useDebounce((q: string) => {
    written.current = q.trim();
    setParams({ [param]: q.trim() });
  }, 500);

  useEffect(() => {
    if (urlQuery !== written.current) {
      written.current = urlQuery;
      setQuery(urlQuery);
    }
  }, [urlQuery]);

  return (
    <InputGroup size={size} className={groupClassName}>
      <InputLeftElement>
        <LuSearch className="text-muted-foreground w-3.5 h-3.5 mt-[-2px]" />
      </InputLeftElement>
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          debounceQuery(e.target.value);
        }}
        className={cn("w-[100px] sm:w-[200px] text-sm", className)}
        {...props}
      />
    </InputGroup>
  );
};

export default SearchFilter;
