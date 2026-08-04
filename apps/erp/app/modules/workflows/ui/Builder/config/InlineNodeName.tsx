import { slugifyNodeName } from "@carbon/workflows";
import { useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { LuPencil } from "react-icons/lu";
import { nodeNameLabel } from "../labelKeys";

type Props = {
  name: string;
  isReadOnly: boolean;
  isTaken: (candidate: string) => boolean;
  onCommit: (name: string) => void;
};

export function InlineNodeName({ name, isReadOnly, isTaken, onCommit }: Props) {
  const { t } = useLingui();
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Prevents onBlur from re-committing after Enter or Escape already resolved
  const settled = useRef(false);

  function tryCommit(raw: string) {
    if (settled.current) return;
    const slug = slugifyNodeName(raw);
    if (slug === "") {
      setError(t`A step needs a name.`);
      return;
    }
    if (isTaken(slug)) {
      setError(t`That name is already used by another step.`);
      return;
    }
    settled.current = true;
    onCommit(slug);
    setIsEditing(false);
    setError(undefined);
  }

  function discard() {
    settled.current = true;
    setIsEditing(false);
    setError(undefined);
  }

  function startEditing() {
    settled.current = false;
    setIsEditing(true);
    setError(undefined);
  }

  if (isReadOnly) {
    return (
      <span className="truncate text-xs font-semibold">
        {nodeNameLabel(name)}
      </span>
    );
  }

  if (isEditing) {
    return (
      <div className="nodrag nopan min-w-0">
        <input
          autoFocus
          // `block`: an inline-block input adds a baseline descender gap that the
          // static label's flex box has not, which nudged the whole card down.
          className="block h-4 w-full bg-transparent text-xs font-semibold leading-4 focus:outline-none"
          defaultValue={name}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => tryCommit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              tryCommit((e.target as HTMLInputElement).value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              discard();
            }
          }}
        />
        {error && (
          <p className="mt-0.5 text-[10px] text-destructive">{error}</p>
        )}
      </div>
    );
  }

  return (
    // `nodrag` sits on the button, not the row: the empty space beside a short
    // name belongs to the card and has to stay draggable.
    <div className="flex min-w-0">
      <button
        type="button"
        className="nodrag nopan group/name flex min-w-0 items-center gap-1 text-left"
        onClick={startEditing}
        title={t`Click to rename`}
      >
        <span className="truncate text-xs font-semibold">
          {nodeNameLabel(name)}
        </span>
        <LuPencil className="size-2.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100" />
      </button>
    </div>
  );
}
