import { Avatar, cn } from "@carbon/react";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full items-end justify-end gap-2 py-4",
      from === "user" ? "is-user" : "is-assistant flex-row-reverse justify-end",
      "[&>div]:max-w-[80%]",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex flex-col gap-2 overflow-hidden rounded-lg px-4 py-3 text-foreground text-sm bg-card",
      "group-[.is-user]:!bg-muted group-[.is-user]:!text-foreground group-[.is-user]:!px-4 group-[.is-user]:!py-2 group-[.is-user]:max-w-fit group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-none",
      "group-[.is-assistant]:!bg-transparent group-[.is-assistant]:!shadow-none group-[.is-assistant]:!border-none group-[.is-assistant]:!px-0 group-[.is-assistant]:!py-0 group-[.is-assistant]:!rounded-none group-[.is-assistant]:!text-muted-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageAvatarProps = ComponentProps<typeof Avatar>;

export const MessageAvatar = ({ ...props }: MessageAvatarProps) => (
  <Avatar {...props} />
);
