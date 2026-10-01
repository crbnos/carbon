import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";
import type { ButtonProps } from "./Button";
import { IconButton } from "./IconButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
import { cn } from "./utils/cn";
import { copyToClipboard } from "./utils/dom";

const Copy = ({
  text,
  icon,
  label,
  className,
  tooltipClassName,
  withTextInTooltip = false,
  size = "sm",
  variant = "secondary"
}: {
  text: string;
  icon?: JSX.Element;
  /** Names what is copied: the tooltip text and the button's aria-label. */
  label?: string;
  className?: string;
  tooltipClassName?: string;
  withTextInTooltip?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: ButtonProps["variant"];
}) => {
  const { t } = useLingui();
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    // Only confirm a copy that happened.
    if (!(await copyToClipboard(text))) return;
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton
          variant={variant}
          aria-label={label ?? t`Copy`}
          icon={
            isCopied ? (
              // Keep a custom icon's sizing so the button does not resize
              <LuCheck className={icon?.props?.className} />
            ) : (
              (icon ?? <LuCopy />)
            )
          }
          size={size}
          className={cn(
            isCopied && "text-emerald-500 hover:text-emerald-500",
            className
          )}
          onClick={handleCopy}
        />
      </TooltipTrigger>
      <TooltipContent className={tooltipClassName}>
        <span>
          {isCopied
            ? t`Copied!`
            : (label ?? (withTextInTooltip ? text : t`Copy to clipboard`))}
        </span>
      </TooltipContent>
    </Tooltip>
  );
};

export default Copy;
