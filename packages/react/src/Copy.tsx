import { useState } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";
import { IconButton } from "./IconButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
import { cn } from "./utils/cn";
import { copyToClipboard } from "./utils/dom";

const Copy = ({
  text,
  icon,
  className,
  withTextInTooltip = false,
  size = "sm",
}: {
  text: string;
  icon?: JSX.Element;
  className?: string;
  withTextInTooltip?: boolean;
  size?: "sm" | "md" | "lg";
}) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton
          variant="secondary"
          aria-label="Copy"
          icon={isCopied ? <LuCheck /> : icon ?? <LuCopy />}
          size={size}
          className={cn(
            isCopied && "text-emerald-500 hover:text-emerald-500",
            className
          )}
          onClick={handleCopy}
        />
      </TooltipTrigger>
      <TooltipContent>
        <span>
          {isCopied
            ? "Copied!"
            : withTextInTooltip
            ? text
            : "Copy to clipboard"}
        </span>
      </TooltipContent>
    </Tooltip>
  );
};

export default Copy;
