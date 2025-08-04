import {
  Button,
  cn,
  copyToClipboard,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@carbon/react";
import { useState } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";

const Share = ({
  text,
  className,
  withTextInTooltip = false,
}: {
  text: string;
  className?: string;
  withTextInTooltip?: boolean;
}) => {
  const [isCopied, setIsCopied] = useState(false);

  const onCopy = () => {
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
          className={cn(
            "text-white",
            isCopied && "text-emerald-500 hover:text-emerald-500",
            className
          )}
          rightIcon={
            isCopied ? (
              <LuCheck className="w-3 h-3" />
            ) : (
              <LuCopy className="w-3 h-3" />
            )
          }
          onClick={onCopy}
        >
          Share
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <span>
          {isCopied
            ? "Copied!"
            : withTextInTooltip
            ? text
            : "Copy link to clipboard"}
        </span>
      </TooltipContent>
    </Tooltip>
  );
};

export default Share;
