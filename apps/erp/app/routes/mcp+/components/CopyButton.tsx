import { cn } from "@carbon/react";
import { useState } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";
import { copyToClipboard } from "~/utils/string";

export function CopyButton({
  text,
  className,
  label = "Copy"
}: {
  text: string;
  className?: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(className, done && "done")}
      onClick={() => {
        copyToClipboard(text, () => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? <LuCheck size={14} /> : <LuCopy size={14} />}
    </button>
  );
}
