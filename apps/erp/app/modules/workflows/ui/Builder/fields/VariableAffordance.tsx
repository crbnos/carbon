/** The browse affordance for controls you cannot type a `{` into. It sits inside the
 * control's own border, so its parent must be `relative`. */
export function VariableAffordance({
  title,
  onClick
}: {
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // `after:-inset-2` buys the ~40px hit area without growing the visual.
      className="absolute right-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-xs font-medium text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:bg-accent hover:text-accent-foreground"
      onClick={onClick}
    >
      {"{}"}
    </button>
  );
}
