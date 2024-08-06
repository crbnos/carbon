import { Badge, Button, HStack, Heading } from "@carbon/react";

import { useParams } from "@remix-run/react";
import { LuCheckCheck, LuEye } from "react-icons/lu";
import { RiProgress4Line } from "react-icons/ri";
import { Assignee, useOptimisticAssignment } from "~/components";

import { usePermissions, useRouteData } from "~/hooks";
import type { Quotation } from "~/modules/sales";
import { path } from "~/utils/path";

const QuoteHeader = () => {
  const permissions = usePermissions();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const routeData = useRouteData<{ quote: Quotation }>(path.to.quote(quoteId));

  const optimisticAssignment = useOptimisticAssignment({
    id: quoteId,
    table: "quote",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.quote?.assignee;

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border">
      <HStack className="w-full justify-between">
        <HStack>
          <Heading size="h2">{routeData?.quote?.quoteId}</Heading>
          <Badge variant="secondary">
            <Badge variant="secondary">
              <RiProgress4Line />
            </Badge>
          </Badge>
        </HStack>
        <HStack>
          <Assignee
            id={quoteId}
            table="quote"
            value={assignee ?? ""}
            className="h-8"
            isReadOnly={!permissions.can("update", "sales")}
          />
          <Button leftIcon={<LuEye />} variant="secondary" asChild>
            <a
              target="_blank"
              href={path.to.file.quote(quoteId)}
              rel="noreferrer"
            >
              Preview
            </a>
          </Button>
          {/* <DropdownMenu>
            <DropdownMenuTrigger>
              <Button rightIcon={<LuChevronDown />} variant="secondary">
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Download</DropdownMenuItem>
              <DropdownMenuItem>Print</DropdownMenuItem>
              <DropdownMenuItem>Export</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu> */}
          <Button
            isDisabled={!permissions.can("update", "sales")}
            leftIcon={<LuCheckCheck />}
          >
            Send
          </Button>
        </HStack>
      </HStack>
    </div>
  );
};

export default QuoteHeader;
