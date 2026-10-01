// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactElement } from "react";
import type { ButtonProps } from "../../Button";
import { IconButton } from "../../IconButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../Tooltip";

type ToolbarButtonProps = Omit<ButtonProps, "aria-label"> & {
  label: string;
  isActive?: boolean;
  icon: ReactElement;
};

const ToolbarButton = ({ label, isActive, ...rest }: ToolbarButtonProps) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton
          variant={isActive ? "solid" : "ghost"}
          aria-label={label}
          {...rest}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

export default ToolbarButton;
