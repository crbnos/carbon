import type { InputProps } from "@carbon/react";
import { Input, useDebounce } from "@carbon/react";
import { useState } from "react";
import { useUrlParams } from "~/hooks";

type DebounceInputProps = InputProps & {
  param: string;
};

const DebouncedInput = ({ param, ...props }: DebounceInputProps) => {
  const [params, setParams] = useUrlParams();
  const [query, setQuery] = useState(params.get(param) || "");
  const debounceQuery = useDebounce((q: string) => {
    setParams({ [param]: q });
  }, 500);

  return (
    <Input
      value={query}
      onChange={(e) => {
        setQuery(e.target.value);
        debounceQuery(e.target.value);
      }}
      className="w-[100px] sm:w-[200px]"
      {...props}
    />
  );
};

export default DebouncedInput;
