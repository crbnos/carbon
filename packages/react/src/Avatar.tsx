"use client";
import { getColorByValue } from "@carbon/utils";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type {
  ComponentProps,
  Dispatch,
  HTMLAttributes,
  ReactNode,
  SetStateAction,
} from "react";
import {
  Children,
  createContext,
  forwardRef,
  useContext,
  useState,
} from "react";

import { cn } from "./utils/cn";

export const avatarVariants = cva(
  "flex flex-shrink-0 overflow-hidden rounded-full items-center justify-center text-white font-semibold",
  {
    variants: {
      size: {
        "2xl": "h-32 w-32 text-6xl",
        xl: "h-24 w-24 text-4xl",
        lg: "h-16 w-16 text-2xl",
        md: "h-12 w-12 text-base",
        sm: "h-8 w-8 text-xs",
        xs: "h-6 w-6 text-xxs",
      },
      isGroup: {
        true: "ring-2 ring-background",
      },
    },
    defaultVariants: {
      size: "sm",
      isGroup: false,
    },
  }
);

export interface AvatarProps
  extends ComponentProps<"span">,
    VariantProps<typeof avatarVariants> {
  name?: string;
  src?: string;
}

const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, name, src, size, children, ...props }, ref) => {
    const isGroup = !!useAvatarGroupContext()?.limit;
    const avatarInitials = getInitials(name ?? "");
    const [error, setError] = useState(false);

    const { background, color } = getColorByValue(name ?? "", "light");

    return src && !error ? (
      <img
        className={cn(
          avatarVariants({ size, isGroup }),
          "object-cover bg-muted-foreground border border-muted",
          className
        )}
        alt={name ?? "avatar"}
        src={src}
        onError={() => setError(true)}
      />
    ) : (
      <span
        className={cn(
          avatarVariants({
            size,
            isGroup,
          }),
          "bg-muted-foreground",
          className
        )}
        style={name ? { background } : undefined}
        {...props}
        ref={ref}
      >
        <>
          {avatarInitials ? (
            <span className="text-white" style={{ color }}>
              {avatarInitials}
            </span>
          ) : (
            <svg
              viewBox="0 0 128 128"
              className="h-full w-full text-muted"
              role="img"
              aria-label=" avatar"
            >
              <path
                fill="currentColor"
                d="M103,102.1388 C93.094,111.92 79.3504,118 64.1638,118 C48.8056,118 34.9294,111.768 25,101.7892 L25,95.2 C25,86.8096 31.981,80 40.6,80 L87.4,80 C96.019,80 103,86.8096 103,95.2 L103,102.1388 Z"
              ></path>
              <path
                fill="currentColor"
                d="M63.9961647,24 C51.2938136,24 41,34.2938136 41,46.9961647 C41,59.7061864 51.2938136,70 63.9961647,70 C76.6985159,70 87,59.7061864 87,46.9961647 C87,34.2938136 76.6985159,24 63.9961647,24"
              ></path>
            </svg>
          )}
        </>
      </span>
    );
  }
);
Avatar.displayName = "Avatar";

type AvatarGroupContextValue = {
  count?: number;
  limit?: number;
  setCount?: Dispatch<SetStateAction<number>>;
  size: ComponentProps<typeof Avatar>["size"];
};

const AvatarGroupContext = createContext<AvatarGroupContextValue>({
  size: undefined,
});

const AvatarGroupProvider = ({
  children,
  limit,
  size,
}: {
  children?: ReactNode;
  limit?: number;
  size?: ComponentProps<typeof Avatar>["size"];
}) => {
  const [count, setCount] = useState<number>(0);

  return (
    <AvatarGroupContext.Provider
      value={{
        count,
        setCount,
        limit,
        size,
      }}
    >
      {children}
    </AvatarGroupContext.Provider>
  );
};

const useAvatarGroupContext = () => useContext(AvatarGroupContext);

export interface AvatarGroupProps extends HTMLAttributes<HTMLDivElement> {
  limit?: number;
  size?: ComponentProps<typeof Avatar>["size"];
}

const AvatarGroup = forwardRef<HTMLDivElement, AvatarGroupProps>(
  ({ children, className, limit, size = "sm", ...props }, ref) => {
    return (
      <AvatarGroupProvider limit={limit} size={size}>
        <div
          ref={ref}
          className={cn(
            "flex items-center justify-start -space-x-2",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </AvatarGroupProvider>
    );
  }
);
AvatarGroup.displayName = "AvatarGroup";

const AvatarGroupList = ({ children }: { children?: ReactNode }) => {
  const { limit, setCount } = useAvatarGroupContext();

  setCount?.(Children.count(children));

  return <>{limit ? Children.toArray(children).slice(0, limit) : children}</>;
};

export interface AvatarOverflowIndicatorProps
  extends HTMLAttributes<HTMLSpanElement> {}

const AvatarOverflowIndicator = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement> & AvatarOverflowIndicatorProps
>(({ className, ...props }, ref) => {
  const { limit, count, size } = useAvatarGroupContext();
  if (!limit || !count || count <= limit) return null;
  return (
    <span
      ref={ref}
      className={cn(
        avatarVariants({ size, isGroup: true }),
        "relative flex bg-muted-foreground ring-2 ring-background",
        className
      )}
      {...props}
    >
      +{count! - limit!}
    </span>
  );
});
AvatarOverflowIndicator.displayName = "AvatarOverflowIndicator";

function getInitials(name: string) {
  const names = name.trim().split(" ");
  const firstName = names[0] ?? "";
  const lastName = names.length > 1 ? names[names.length - 1] : "";
  return firstName && lastName
    ? `${firstName.charAt(0)}${lastName.charAt(0)}`
    : firstName.charAt(0);
}

export { Avatar, AvatarGroup, AvatarGroupList, AvatarOverflowIndicator };
