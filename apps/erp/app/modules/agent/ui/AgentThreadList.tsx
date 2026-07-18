import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

type Thread = {
  id: string;
  title: string | null;
  createdAt: string;
};

export function AgentThreadList({
  onSelect
}: {
  onSelect: (id: string) => void;
}) {
  const fetcher = useFetcher<{ threads: Thread[] }>();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) {
      fetcher.load(path.to.api.agentThreads);
    }
  }, [fetcher]);

  const threads = fetcher.data?.threads ?? [];
  const q = query.trim().toLowerCase();
  const filtered = q
    ? threads.filter((t) =>
        (t.title ?? "Untitled chat").toLowerCase().includes(q)
      )
    : threads;

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
              <li key={t.id}>
                <button
                  type="button"
                  className="w-full text-left rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  onClick={() => onSelect(t.id)}
                >
                  <div className="truncate">{t.title ?? "Untitled chat"}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(t.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit"
                    })}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
