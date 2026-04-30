import {
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  useDebounce,
  useDisclosure
} from "@carbon/react";

import { useUrlParams } from "@carbon/remix";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuMenu, LuSearch, LuTrash } from "react-icons/lu";
import { useDateFormatter } from "~/hooks";

type Chat = {
  id: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function ChatHistorySkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={`chat-skeleton-${i + 1}`} className="flex flex-col gap-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function ChatHistory({
  chats,
  isLoading
}: {
  chats: Chat[];
  isLoading: boolean;
}) {
  const { t } = useLingui();
  const { formatTimeAgo } = useDateFormatter();
  const [, setParams] = useUrlParams();

  const [searchQuery, setSearchQuery] = useState("");
  const historyDisclosure = useDisclosure();

  // Debounced search to avoid too many API calls
  const debouncedSearch = useDebounce(setSearchQuery, 300);

  const handleChatSelect = (chatId: string) => {
    setParams({ chatId });
    historyDisclosure.onClose();
  };

  const handleDeleteChat = (e: React.MouseEvent, chatId: string) => {
    alert(`Delete chat ${chatId}`);
  };

  return (
    <Popover
      open={historyDisclosure.isOpen}
      onOpenChange={historyDisclosure.onToggle}
    >
      <PopoverTrigger asChild>
        <IconButton
          variant="secondary"
          icon={<LuMenu />}
          aria-label={t`Open chat history`}
        />
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="end">
        <div className="p-4">
          <div className="relative mb-4">
            <LuSearch
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground"
              size={14}
            />
            <Input
              placeholder={t`Search history`}
              className="pl-9"
              onChange={(e) => debouncedSearch(e.target.value)}
            />
          </div>

          <div className="max-h-80 overflow-y-auto">
            {isLoading ? (
              <ChatHistorySkeleton />
            ) : chats?.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-sm text-muted-foreground">
                  {searchQuery ? (
                    <Trans>No chats found</Trans>
                  ) : (
                    <Trans>No chat history</Trans>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {chats?.map((chat: Chat) => (
                  <div
                    key={chat.id}
                    className="group relative flex items-center justify-between hover:bg-muted/50 rounded-md p-2 -m-2"
                  >
                    <button
                      type="button"
                      onClick={() => handleChatSelect(chat.id)}
                      className="flex-1 text-left"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="text-sm font-medium line-clamp-1">
                          {chat.title || t`New chat`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatTimeAgo(chat.updatedAt.toISOString())}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteChat(e, chat.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-destructive/10 rounded-sm"
                      title={t`Delete chat`}
                    >
                      <LuTrash
                        size={14}
                        className="text-muted-foreground hover:text-destructive"
                      />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
