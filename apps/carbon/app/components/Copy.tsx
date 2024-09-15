import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { useState } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";
import { copyToClipboard } from "~/utils/string";

const Copy = ({ text }: { text: string }) => {
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
          className="p-1"
          onClick={handleCopy}
        >
          {isCopied ? (
            <LuCheck className="w-3 h-3" />
          ) : (
            <LuCopy className="w-3 h-3" />
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
