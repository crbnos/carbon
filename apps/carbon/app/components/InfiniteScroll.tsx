"use client";

import { Skeleton } from "@carbon/react";
import { useEffect } from "react";
import { useInView } from "react-intersection-observer";

interface InfiniteScrollProps<T extends { id: string }> {
  component: React.FC<{ item: T }>;
  items: T[];
  loadMore: () => Promise<void>;
  hasMore: boolean;
}

export function LoadingSkeleton({
  ref,
}: {
  ref?: React.RefObject<HTMLDivElement>;
}) {
  return (
    <>
      <div ref={ref} className="flex items-center space-x-4 p-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
      </div>
      <div className="flex items-center space-x-4 p-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
      </div>
      <div className="flex items-center space-x-4 p-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
      </div>
    </>
  );
}

export default function InfiniteScroll<T extends { id: string }>({
  component: Component,
  items,
  loadMore,
  hasMore,
}: InfiniteScrollProps<T>) {
  const { ref, inView } = useInView({
    threshold: 0,
  });

  useEffect(() => {
    if (inView) {
      loadMore();
    }
  }, [inView, loadMore]);

  return (
    <div className="w-full">
      <ul className="relative h-full overflow-y-auto ">
        {items.map((item) => (
          <Component key={item.id} item={item} />
        ))}
        <div ref={ref}>{hasMore && <LoadingSkeleton />}</div>
      </ul>
    </div>
  );
}
