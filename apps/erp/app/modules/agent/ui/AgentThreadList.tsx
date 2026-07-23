import { useEffect, useState } from "react";
import { LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

type Thread = {
  id: string;
  title: string | null;
  createdAt: string;
};

export function AgentThreadList({
  onSelect,
  onDelete
}: {
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const fetcher = useFetcher<{ threads: Thread[] }>();
  const deleteFetcher = useFetcher();
  const [query, setQuery] = useState("");
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) {
      fetcher.load(path.to.api.agentThreads);
    }
  }, [fetcher]);

  const threads = (fetcher.data?.threads ?? []).filter(
    (t) => !deletedIds.has(t.id)
  );
  const q = query.trim().toLowerCase();
  const filtered = q
    ? threads.filter((t) =>
        (t.title ?? "Untitled chat").toLowerCase().includes(q)
      )
    : threads;

  const handleDelete = (id: string) => {
    setDeletedIds((prev) => new Set(prev).add(id));
    deleteFetcher.submit(
      { threadId: id },
      { method: "DELETE", action: path.to.api.agentThreads }
    );
    onDelete?.(id);
  };

  return (
    <div className="flex flex-col max-h-[60vh]">
      <div className="p-2 border-b shrink-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats…"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            {threads.length === 0 ? "No past chats yet." : "No matches."}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((t) => (
              <li key={t.id} className="group relative">
                <button
                  type="button"
                  className="w-full text-left rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  onClick={() => onSelect(t.id)}
                >
                  <div className="truncate pr-6">
                    {t.title ?? "Untitled chat"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(t.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit"
                    })}
                  </div>
                </button>
                <button
                  type="button"
                  aria-label="Delete chat"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive hover:bg-muted transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(t.id);
                  }}
                >
                  <LuTrash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
