import { serve } from "@novu/framework/remix";
import {
  digitalQuoteResponseWorkflow,
  jobAssignmentWorkflow,
  quoteAssignmentWorkflow,
  salesOrderAssignmentWorkflow,
  salesRfqAssignmentWorkflow,
} from "~/novu/workflows";

const handler = serve({
  workflows: [
    salesRfqAssignmentWorkflow,
    quoteAssignmentWorkflow,
    salesOrderAssignmentWorkflow,
    jobAssignmentWorkflow,
    digitalQuoteResponseWorkflow,
  ],
});

export const config = {
  runtime: "nodejs",
};

export { handler as action, handler as loader };
