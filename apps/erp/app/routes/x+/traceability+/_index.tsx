import { useCarbon } from "@carbon/auth";
import { Button, cn, toast, useMount } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ComponentProps} from "react";
import { useState , forwardRef } from "react";
import { LuBarcode, LuQrCode } from "react-icons/lu";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Traceability",
  to: path.to.traceability,
  module: "inventory",
};

const RECENT_SEARCHES_KEY = "traceability-searches";

export default function TraceabilityRoute() {
  const { carbon } = useCarbon();
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useMount(() => {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (stored) {
      setRecentSearches(JSON.parse(stored));
    }
  });

  const handleSearch = async (value: string) => {
    if (!value.trim()) return;
    if (!carbon) return;

    const response = await carbon
      .from("trackedEntity")
      .select("*")
      .eq("id", value)
      .maybeSingle();

    if (!response?.data) {
      toast.error("Invalid tracking number");
      setInputValue("");
      return;
    }

    // Save to localStorage
    const updatedSearches = [
      value,
      ...recentSearches.filter((search) => search !== value),
    ].slice(0, 3);

    navigate(
      `${path.to.traceabilityGraph}?trackedEntityId=${encodeURIComponent(
        value
      )}`
    );

    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updatedSearches));

    // Navigate to graph
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch(inputValue);
    }
  };

  const handleBlur = () => {
    handleSearch(inputValue);
  };

  return (
    <div className="flex w-full h-full flex-1 items-center justify-center bg-card pt-[-49px]">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <TrackingInput
            placeholder="Scan or enter a tracking number"
            className="pr-10"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
          />
          <LuQrCode className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>

        {recentSearches.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center">
            {recentSearches.map((search) => (
              <Button
                key={search}
                variant="secondary"
                size="sm"
                leftIcon={<LuBarcode />}
                onClick={() =>
                  navigate(
                    `${
                      path.to.traceabilityGraph
                    }?trackedEntityId=${encodeURIComponent(search)}`
                  )
                }
                className="rounded-full before:rounded-full after:rounded-full"
              >
                {search}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const TrackingInput = forwardRef<HTMLInputElement, ComponentProps<"input">>(
  ({ className, ...props }, ref) => {
    return (
      <input
        className={cn(
          "min-w-[400px] min-h-[40px] flex w-full rounded-lg border border-input bg-background px-4 py-3 text-base text-foreground shadow-sm shadow-black/5 transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
TrackingInput.displayName = "TrackingInput";
