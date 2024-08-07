import { Button, HStack, Menubar, MenubarItem } from "@carbon/react";
import { Link, useFetcher, useLocation, useParams } from "@remix-run/react";
import { LuDownload, LuUpload } from "react-icons/lu";
import { RiProgress4Line } from "react-icons/ri";
import { BreadcrumbItem, Breadcrumbs } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Quotation, QuotationLine } from "../../types";

const QuoteBreadcrumbs = () => {
  const permissions = usePermissions();
  const { quoteId, lineId, makeMethodId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const fetcher = useFetcher<{ error: null | { message: string } }>();
  const routeData = useRouteData<{ quote: Quotation; lines: QuotationLine[] }>(
    path.to.quote(quoteId)
  );
  const line = routeData?.lines.find((line) => line.id === lineId);
  const { pathname } = useLocation();

  const getMethod = async (itemId: string, quoteLineId: string) => {
    const formData = new FormData();
    formData.append("itemId", itemId);
    formData.append("quoteId", quoteId);
    formData.append("quoteLineId", quoteLineId);

    fetcher.submit(formData, {
      method: "post",
      action: path.to.quoteMethodGet,
    });
  };

  return (
    <Menubar>
      <HStack className="w-full justify-between">
        <Breadcrumbs>
          <BreadcrumbItem>
            <Button leftIcon={<RiProgress4Line />} variant="ghost" asChild>
              <Link to={path.to.quoteDetails(quoteId)}>
                {routeData?.quote?.quoteId}
              </Link>
            </Button>
          </BreadcrumbItem>
          {line && (
            <BreadcrumbItem>
              <Button variant="ghost" asChild>
                <Link to={path.to.quoteLine(quoteId, line.id!)}>
                  {line.itemReadableId}
                </Link>
              </Button>
            </BreadcrumbItem>
          )}
        </Breadcrumbs>
        {line &&
          permissions.can("update", "sales") &&
          pathname === path.to.quoteLine(quoteId, lineId!) && (
            <HStack spacing={0}>
              <MenubarItem
                leftIcon={<LuDownload />}
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formAction === path.to.quoteMethodGet
                }
                onClick={() => getMethod(line.itemId!, line.id!)}
              >
                Get Method
              </MenubarItem>
              <MenubarItem leftIcon={<LuUpload />}>Save Method</MenubarItem>
            </HStack>
          )}
      </HStack>
    </Menubar>
  );
};

export default QuoteBreadcrumbs;
