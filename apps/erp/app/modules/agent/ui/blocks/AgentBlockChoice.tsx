import { Fragment, useState } from "react";
import { LuArrowUp, LuCheck } from "react-icons/lu";
import { choiceBlock } from "../../agent.blocks";
import { useAgentActions } from "../AgentActionsContext";

const JOIN = ", ";

export function AgentBlockChoice({ input }: { input: unknown }) {
  const { sendMessage } = useAgentActions();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [answered, setAnswered] = useState(false);

  const parsed = choiceBlock.safeParse(input);
  if (!parsed.success) return null;
  const block = parsed.data;
  const isMulti = !!block.multiSelect;

  function send(text: string) {
    const t = text.trim();
    if (!t || answered) return;
    setAnswered(true);
    sendMessage(t);
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmMulti() {
    const ordered = block.options
      .filter((o) => selectedIds.has(o.id))
      .map((o) => o.value);
    const trimmed = freeText.trim();
    const values = trimmed ? [...ordered, trimmed] : ordered;
    if (values.length) send(values.join(JOIN));
  }

  const canConfirm = selectedIds.size > 0 || freeText.trim().length > 0;

  return (
    <div className="my-1 overflow-hidden rounded-lg border bg-background">
      {block.prompt && (
        <p className="px-3 pb-1.5 pt-2.5 text-xs text-muted-foreground">
          {block.prompt}
        </p>
      )}

      {block.options.map((option, i) => {
        const isSelected = isMulti && selectedIds.has(option.id);
        return (
          <Fragment key={option.id}>
            {i > 0 && <div className="mx-3 h-px bg-border" />}
            <div className="px-3 py-0.5">
              <button
                type="button"
                disabled={answered}
                onClick={() =>
                  isMulti ? toggle(option.id) : send(option.value)
                }
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors disabled:opacity-50 ${
                  isSelected
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/85 hover:bg-muted"
                }`}
              >
                {isMulti && (
                  <span
                    className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                      isSelected ? "border-primary bg-primary text-white" : ""
                    }`}
                  >
                    {isSelected && <LuCheck className="size-3" />}
                  </span>
                )}
                {option.label}
              </button>
            </div>
          </Fragment>
        );
      })}

      {block.allowFreeText && (
        <div className="flex items-center gap-1 border-t px-2 py-1.5">
          <input
            type="text"
            value={freeText}
            disabled={answered}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (isMulti) confirmMulti();
                else send(freeText);
              }
            }}
            placeholder={
              block.freeTextPlaceholder ?? "Or type your own answer…"
            }
            className="flex-1 bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <button
            type="button"
            aria-label="Send"
            disabled={answered || !canConfirm}
            onClick={() => (isMulti ? confirmMulti() : send(freeText))}
            className="rounded-md p-1 hover:bg-muted disabled:opacity-40"
          >
            <LuArrowUp className="size-4" />
          </button>
        </div>
      )}

      {isMulti && !block.allowFreeText && (
        <div className="border-t px-2 py-1.5">
          <button
            type="button"
            disabled={answered || !canConfirm}
            onClick={confirmMulti}
            className="w-full rounded-md bg-primary px-2 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
          >
            Confirm
          </button>
        </div>
      )}
    </div>
  );
}
