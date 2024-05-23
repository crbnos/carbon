import { serve } from "https://deno.land/std@0.175.0/http/server.ts";

import { corsHeaders } from "../lib/headers.ts";
import { jobs, workCenters } from "./data.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // const client = getSupabaseServiceRole(req.headers.get("Authorization"));
    const workCenterManager = new LoadBalancer(workCenters);

    const operationsByType = jobs.reduce((acc, job) => {
      job.operations.forEach((operation) => {
        if (operation.status === "DONE") return;
        acc[operation.workCenterType] = acc[operation.workCenterType] || [];
        acc[operation.workCenterType].push({
          ...operation,
          jobId: job.id,
          deadlineDate: job.deadlineDate,
          deadlineType: job.deadlineType,
        });
      });
      return acc;
    }, {} as Record<string, Operation[]>);

    const sortedOperationsByType = Object.entries(operationsByType).reduce(
      (acc, [workCenterType, operations]) => {
        acc[workCenterType] = sortOperations(operations);
        return acc;
      },
      {} as Record<string, Operation[]>
    );

    const operationsWithWorkCenter: OperationWithWorkCenter[] = Object.values(
      sortedOperationsByType
    ).flatMap((operations) =>
      operations.map((operation) => {
        const { workCenterType } = operation;

        const workCenter =
          workCenterManager.getWorkCenterWithLeastWork(workCenterType);

        workCenterManager.addWorkToWorkCenter(
          workCenterType,
          workCenter.id,
          operation.duration
        );

        return { ...operation, workCenterId: workCenter.id };
      })
    );

    return new Response(
      JSON.stringify({
        operationsWithWorkCenter,
        workCenters,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

type WorkCenter = {
  id: string;
  name: string;
  workCenterType: string;
};

type Operation = {
  id: string;
  jobId: string;
  deadlineDate: string;
  deadlineType: string;
  duration: number;
  status: string;
  workCenterType: string;
  timecards?: {
    start: string;
    end?: string;
    machine?: string;
  }[];
};

type OperationWithWorkCenter = Operation & {
  workCenterId: string;
};

function sortOperations(operations: Operation[]) {
  return operations.sort((a, b) => {
    // First should come anything that's in progress
    if (a.status === "IN_PROGRESS" && b.status !== "IN_PROGRESS") {
      return -1;
    } else if (a.status !== "IN_PROGRESS" && b.status === "IN_PROGRESS") {
      return 1;
    }
    // Then anything that's paused
    else if (a.status === "PAUSED" && b.status !== "PAUSED") {
      return -1;
    } else if (a.status !== "PAUSED" && b.status === "PAUSED") {
      return 1;
    }
    // Then anything that's ASAP
    else if (a.deadlineType === "ASAP" && b.deadlineType !== "ASAP") {
      return -1;
    } else if (a.deadlineType !== "ASAP" && b.deadlineType === "ASAP") {
      return 1;
    }
    // Then we sort deadlines
    else if (
      a.deadlineType === "HARD_DEADLINE" ||
      a.deadlineType === "SOFT_DEADLINE"
    ) {
      if (
        b.deadlineType === "HARD_DEADLINE" ||
        b.deadlineType === "SOFT_DEADLINE"
      ) {
        return a.deadlineDate.localeCompare(b.deadlineDate);
      } else {
        return -1;
      }
    }
    // Finally we add anything that has no deadline
    else if (
      a.deadlineType === "NO_DEADLINE" &&
      b.deadlineType !== "NO_DEADLINE"
    ) {
      return 1;
    } else if (
      a.deadlineType === "NO_DEADLINE" &&
      b.deadlineType === "NO_DEADLINE"
    ) {
      return a.deadlineDate.localeCompare(b.deadlineDate);
    } else {
      return 0;
    }
  });
}

type WorkCenterWithDuration = WorkCenter & {
  duration: number;
};

class LoadBalancer {
  private workCentersByType: Record<string, WorkCenterWithDuration[]> = {};

  constructor(workCenters: WorkCenter[]) {
    this.workCentersByType = workCenters.reduce<
      Record<string, WorkCenterWithDuration[]>
    >((acc, machine) => {
      acc[machine.workCenterType] = acc[machine.workCenterType] || [];
      acc[machine.workCenterType].push({ ...machine, duration: 0 });
      return acc;
    }, {});
  }

  public getWorkCenterWithLeastWork(workCenterType: string) {
    const workCenters = this.workCentersByType[workCenterType];
    return workCenters.reduce((minWorkCenter, workCenter) =>
      workCenter.duration < minWorkCenter.duration ? workCenter : minWorkCenter
    );
  }

  public addWorkToWorkCenter(
    workCenterType: string,
    workCenterId: string,
    duration: number
  ) {
    this.workCentersByType[workCenterType] = this.workCentersByType[
      workCenterType
    ].map((workCenter) => {
      if (workCenter.id === workCenterId) {
        return { ...workCenter, duration: workCenter.duration + duration };
      }
      return workCenter;
    });
  }
}
