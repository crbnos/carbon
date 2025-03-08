import type { ReactNode } from "react";
import { useState } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";
import { copyToClipboard } from "./utils/dom";
import { cn } from "./utils/cn";
import { Button } from "./Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";

const Copy = ({
  text,
  icon,
  className,
  withTextInTooltip = false,
}: {
  text: string;
  icon?: ReactNode;
  className?: string;
  withTextInTooltip?: boolean;
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
        <Button
          variant="secondary"
          aria-label="Copy"
          size="sm"
          className={cn(
            "p-1 w-6 h-6",
            isCopied && "text-emerald-500 hover:text-emerald-500",
            className
          )}
          onClick={handleCopy}
        >
          {isCopied ? (
            <LuCheck className="w-3 h-3" />
          ) : (
            icon ?? <LuCopy className="w-3 h-3" />
          )}
        </Button>
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
