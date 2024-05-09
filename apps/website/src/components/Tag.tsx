"use client";

import { cn } from "@carbon/react";

export function Tag({ status }: { status: string }) {
  return (
    <div
      className={cn(
        "border rounded-md px-2 py-1 inline-block text-[10px] font-medium mb-4 text-foreground border-foreground uppercase",
        status === "Business" && "border-[#ffcc00] text-[#ffcc00]",
        status === "Design" && "border-primary text-primary"
      )}
    >
      {status}
    </div>
  );
}
