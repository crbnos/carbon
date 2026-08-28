import { HStack } from "@carbon/react";
import { isWorkflowServiceUserId } from "@carbon/workflows";
import { Trans } from "@lingui/react/macro";
import { LuBuilding } from "react-icons/lu";
import EmployeeAvatar from "~/components/EmployeeAvatar";

type WorkflowOwnerProps = {
  ownerId: string | null;
  withName?: boolean;
};

/**
 * The owner of a workflow or of one of its runs.
 *
 * A company-owned workflow's owner is the company's service identity, which has
 * no employee row on purpose — so it is absent from `usePeople` and
 * `EmployeeAvatar` would render it as a nameless blank circle. Detect it by id
 * rather than threading `ownerKind` through the run tables, which record the id
 * they actually ran as and nothing else.
 */
const WorkflowOwner = ({ ownerId, withName = true }: WorkflowOwnerProps) => {
  if (isWorkflowServiceUserId(ownerId)) {
    return (
      <HStack className="truncate no-underline hover:no-underline">
        <LuBuilding className="size-4 text-muted-foreground" />
        {withName && (
          <span>
            <Trans>Company</Trans>
          </span>
        )}
      </HStack>
    );
  }

  return <EmployeeAvatar employeeId={ownerId} withName={withName} />;
};

export default WorkflowOwner;
