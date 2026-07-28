import { IconButton } from "@carbon/react";
import { useLayoutEffect, useRef, useState } from "react";
import { LuArrowUp, LuSquare } from "react-icons/lu";

const MIN_HEIGHT = 54; // ~50% taller than a single row
const MAX_HEIGHT = 160;

export function AgentInput({
  disabled,
  isStreaming,
  onSend,
  onStop
}: {
  disabled: boolean;
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with content up to MAX_HEIGHT, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)}px`;
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  }

  return (
    <div className="flex items-end gap-2 rounded-lg border bg-background p-1.5">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ask anything…"
        rows={1}
        style={{ maxHeight: MAX_HEIGHT }}
        className="flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground overflow-y-auto"
      />
      {isStreaming ? (
        <IconButton
          aria-label="Stop"
          icon={<LuSquare />}
          variant="secondary"
          size="sm"
          onClick={onStop}
        />
      ) : (
        <IconButton
          aria-label="Send"
          icon={<LuArrowUp />}
          variant="primary"
          size="sm"
          isDisabled={!value.trim()}
          onClick={submit}
        />
      )}
    </div>
  );
}
