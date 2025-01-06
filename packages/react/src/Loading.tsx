import type { ComponentProps, PropsWithChildren } from "react";
import { Spinner } from "./Spinner";
import { cn } from "./utils/cn";

export function Loading({
  children,
  isLoading,
  className,
  ...props
}: PropsWithChildren<ComponentProps<"div"> & { isLoading: boolean }>) {
  return isLoading ? (
    <div
      className={cn(
        "flex flex-grow h-full w-full items-center justify-center",
        className
      )}
      {...props}
    >
      <Spinner className="size-8" />
    </div>
  ) : (
    <>{children}</>
  );
}
