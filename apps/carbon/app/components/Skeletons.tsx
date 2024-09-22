import { Skeleton } from "@carbon/react";

export function ExplorerSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  );
}
