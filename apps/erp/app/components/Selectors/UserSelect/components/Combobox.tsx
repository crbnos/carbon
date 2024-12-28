import type { PropsWithChildren } from "react";
import useUserSelectContext from "../provider";

const Combobox = ({ children }: PropsWithChildren) => {
  const { onKeyDown } = useUserSelectContext();
  return <div onKeyDown={onKeyDown}>{children}</div>;
};

export default Combobox;
