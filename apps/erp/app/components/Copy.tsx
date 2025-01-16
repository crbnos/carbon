import {
  Button,
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@carbon/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";
import { copyToClipboard } from "~/utils/string";

const Copy = ({
  text,
  icon,
  className,
}: {
  text: string;
  icon?: ReactNode;
  className?: string;
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
        <span>{isCopied ? "Copied!" : "Copy to clipboard"}</span>
      </TooltipContent>
    </Tooltip>
  );
};

export default Copy;
