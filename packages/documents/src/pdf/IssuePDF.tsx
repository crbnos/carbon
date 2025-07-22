import type { Database } from "@carbon/database";
import { Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";

import type { JSONContent } from "@carbon/react";
import type { PDF } from "../types";
import { Header, Note, Summary, Template } from "./components";

interface IssuePDFProps extends PDF {
  nonConformance: Database["public"]["Tables"]["nonConformance"]["Row"];
  nonConformanceTypes: Database["public"]["Tables"]["nonConformanceType"]["Row"][];
  investigationTasks: Database["public"]["Tables"]["nonConformanceInvestigationTask"]["Row"][];
  actionTasks: Database["public"]["Tables"]["nonConformanceActionTask"]["Row"][];
  reviewers: Database["public"]["Tables"]["nonConformanceReviewer"]["Row"][];
}

// Initialize tailwind-styled-components
const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Helvetica", "Arial", "sans-serif"],
    },
    extend: {
      colors: {
        gray: {
          500: "#7d7d7d",
        },
      },
    },
  },
});

const IssuePDF = ({
  company,
  locale,
  meta,
  nonConformance,
  nonConformanceTypes,
  investigationTasks,
  actionTasks,
  reviewers,
  title = "Issue Report",
}: IssuePDFProps) => {
  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "issue report",
        subject: meta?.subject ?? "Issue Report",
      }}
    >
      <View>
        <Header title={title} company={company} />
        <Summary
          company={company}
          items={[
            {
              label: "Issue #",
              value: nonConformance.nonConformanceId,
            },
            {
              label: "Type",
              value: nonConformanceTypes.find(
                (type) => type.id === nonConformance.nonConformanceTypeId
              )?.name,
            },
            {
              label: "Status",
              value: nonConformance.status,
            },
            {
              label: "Started",
              value: nonConformance.openDate,
            },
            {
              label: "Completed",
              value: nonConformance.closeDate,
            },
          ]}
        />
        {Object.keys(nonConformance.content ?? {}).length > 0 && (
          <View
            style={tw("flex flex-col gap-2 border-b border-gray-300 mb-10")}
          >
            <View style={tw("flex flex-row justify-between")}>
              <Text style={tw("font-bold")}>Overview</Text>
            </View>

            <Note content={nonConformance.content as JSONContent} />
          </View>
        )}
        {investigationTasks.length > 0 && (
          <View style={tw("mb-10")}>
            {investigationTasks.map((task) => (
              <View
                key={task.id}
                style={tw("flex flex-col gap-2 border-b border-gray-300 mb-10")}
              >
                <View style={tw("flex flex-row justify-between")}>
                  <Text style={tw("font-bold")}>{task.investigationType}</Text>
                </View>
                {task.completedDate && (
                  <Text style={tw("text-sm")}>
                    Completed: {task.completedDate}
                  </Text>
                )}
                {Object.keys(task.notes ?? {}).length > 0 && (
                  <Note content={task.notes as JSONContent} />
                )}
              </View>
            ))}
          </View>
        )}

        {actionTasks.length > 0 && (
          <View style={tw("mb-10")}>
            {actionTasks.map((task) => (
              <View
                key={task.id}
                style={tw("flex flex-col gap-2 border-b border-gray-300 mb-10")}
              >
                <View style={tw("flex flex-row justify-between")}>
                  <Text style={tw("font-bold")}>{task.actionType}</Text>
                </View>
                {task.completedDate && (
                  <Text style={tw("text-sm")}>
                    Completed: {task.completedDate}
                  </Text>
                )}
                {Object.keys(task.notes ?? {}).length > 0 && (
                  <Note content={task.notes as JSONContent} />
                )}
              </View>
            ))}
          </View>
        )}

        {reviewers.length > 0 && (
          <View style={tw("mb-5")}>
            <Text style={tw("font-bold mb-2")}>Reviewers</Text>
            {reviewers.map((reviewer) => (
              <View
                key={reviewer.id}
                style={tw("flex flex-col gap-2 py-2 border-b border-gray-300")}
              >
                <View style={tw("flex flex-row justify-between")}>
                  <Text style={tw("font-bold text-sm")}>{reviewer.title}</Text>
                  <Text style={tw("text-gray-500 text-sm")}>
                    {reviewer.status}
                  </Text>
                </View>

                {Object.keys(reviewer.notes ?? {}).length > 0 && (
                  <Note content={reviewer.notes as JSONContent} />
                )}
              </View>
            ))}
          </View>
        )}
      </View>
    </Template>
  );
};

export default IssuePDF;
