import { HStack, Heading } from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import { Copy } from "~/components";
import { useRouteData } from "~/hooks";
import type { BatchDetails } from "~/modules/inventory";
import { path } from "~/utils/path";

const BatchHeader = () => {
  const { batchId } = useParams();
  if (!batchId) throw new Error("batchId not found");

  const routeData = useRouteData<{
    batch: BatchDetails;
  }>(path.to.batch(batchId));

  if (!routeData?.batch) throw new Error("Failed to load batch");
  const { batch } = routeData;

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between py-2 px-4 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08),_0px_0px_10px_rgba(0,_0,_0,_0.12),_0px_0px_24px_rgba(0,_0,_0,_0.16),_0px_0px_80px_rgba(0,_0,_0,_0.2)]">
        <HStack className="w-full justify-between">
          <HStack>
            <Link to={path.to.batch(batchId)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>Batch {batch.number}</span>
              </Heading>
            </Link>
            <Copy text={batch?.number ?? ""} />
          </HStack>
          <HStack></HStack>
        </HStack>
      </div>
    </>
  );
};

export default BatchHeader;
