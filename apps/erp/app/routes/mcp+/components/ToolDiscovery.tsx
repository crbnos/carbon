import { FlowDiagram } from "./FlowDiagram";

export function ToolDiscovery({ total }: { total: number }) {
  return (
    <>
      <p className="text-muted-foreground max-w-[64ch] mb-6 text-[0.95rem] [text-wrap:pretty]">
        Carbon doesn&apos;t pour {total.toLocaleString()} tools into the model
        at once. Three meta-tools let assistants discover what they need, just
        in time.
      </p>
      <FlowDiagram
        label="DISCOVERY LOOP"
        caption="Search → describe → call. Auth context is injected automatically."
        steps={[
          {
            name: "search_tools",
            tag: "READ",
            text: "Find tools by query, module, or classification."
          },
          {
            name: "describe_tool",
            tag: "READ",
            text: "Get parameters & schema for one tool."
          },
          {
            name: "call_tool",
            tag: "WRITE",
            text: "Execute it with arguments and get the result."
          }
        ]}
      />
      <p className="text-muted-foreground max-w-[64ch] mt-[26px] mb-6 text-[0.95rem] [text-wrap:pretty]">
        You ask for an outcome; the assistant chains the calls itself.
        Here&apos;s the real sequence behind one request.
      </p>
      <FlowDiagram
        vertical
        label={'WORKFLOW — "CHASE DOWN EVERYTHING SHIPPING LATE THIS WEEK"'}
        caption="One sentence from you → three tool calls → a summary back."
        steps={[
          {
            name: "search_tools",
            tag: "READ",
            text: "Finds the sales-order and shipment tools."
          },
          {
            name: "sales_getSalesOrders",
            tag: "READ",
            text: "Filters to orders due this week that are still open."
          },
          {
            name: "production_getJobs",
            tag: "READ",
            text: "Flags the linked jobs running behind schedule."
          },
          {
            name: "Summary",
            text: "Returns the list and the delays — for your review."
          }
        ]}
      />
    </>
  );
}
