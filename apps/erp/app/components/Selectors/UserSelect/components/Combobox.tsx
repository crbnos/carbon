// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PropsWithChildren } from "react";
import useUserSelectContext from "../provider";

const Combobox = ({ children }: PropsWithChildren) => {
  const { onKeyDown } = useUserSelectContext();
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- delegated keydown for the inner combobox input and listbox (arrow/enter/escape); the wrapper is not a control
    <div onKeyDown={onKeyDown}>{children}</div>
  );
};

export default Combobox;
