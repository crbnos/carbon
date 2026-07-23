// "Thinking" bubble shown while the agent is processing before visible text arrives.
export function AgentThinking() {
  return (
    <div
      className="self-start inline-flex items-center gap-1.5 rounded-lg border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
      aria-label="Assistant is thinking"
    >
      <span>Thinking</span>
      <span className="flex items-center gap-0.5">
        <span className="size-1 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.3s]" />
        <span className="size-1 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.15s]" />
        <span className="size-1 rounded-full bg-muted-foreground/70 animate-bounce" />
      </span>
    </div>
  );
}
