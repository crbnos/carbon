import type { ComponentProps, PropsWithChildren } from "react";
import { Spinner } from "./Spinner";
import { cn } from "./utils/cn";

export function Loading({
  children,
  isLoading,
  className,
  spinnerClassName,
  ...props
}: PropsWithChildren<
  ComponentProps<"div"> & { isLoading: boolean; spinnerClassName?: string }
>) {
  return isLoading ? (
    <div
      className={cn(
        "flex flex-grow h-full w-full items-center justify-center",
        className
      )}
      {...props}
    >
      <Spinner className={spinnerClassName ?? "size-8"} />
    </div>
  ) : (
    <>{children}</>
  );
}
