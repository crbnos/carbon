import type { InputProps } from "@carbon/react";
import {
  Input,
  InputGroup,
  InputLeftElement,
  useDebounce,
} from "@carbon/react";
import { useState } from "react";
import { LuSearch } from "react-icons/lu";
import { useUrlParams } from "~/hooks";

type SearchFilterProps = InputProps & {
  param: string;
};

const SearchFilter = ({ param, size, ...props }: SearchFilterProps) => {
  const [params, setParams] = useUrlParams();
  const [query, setQuery] = useState(params.get(param) || "");
  const debounceQuery = useDebounce((q: string) => {
    setParams({ [param]: q });
  }, 500);

  return (
    <InputGroup size={size}>
      <InputLeftElement>
        <LuSearch className="text-muted-foreground w-3.5 h-3.5" />
      </InputLeftElement>
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          debounceQuery(e.target.value);
        }}
        className="w-[100px] sm:w-[200px]"
        {...props}
      />
    </InputGroup>
  );
};

export default SearchFilter;
