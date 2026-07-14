import type {
  trainingAssignmentStatusOptions,
  trainingFrequency
} from "./resources.models";
import type {
  getAbilities,
  getAbility,
  getContractors,
  getEmployeeAbilities,
  getFailureMode,
  getFailureModes,
  getLocations,
  getMaintenanceDispatch,
  getMaintenanceDispatchComments,
  getMaintenanceDispatchEvents,
  getMaintenanceDispatches,
  getMaintenanceDispatchesByLocation,
  getMaintenanceDispatchItems,
  getMaintenanceDispatchWorkCenters,
  getMaintenanceSchedule,
  getMaintenanceScheduleItems,
  getMaintenanceSchedules,
  getMaintenanceSchedulesByLocation,
  getPartners,
  getProcesses,
  getSuggestion,
  getSuggestions,
  getTraining,
  getTrainingAssignment,
  getTrainingQuestions,
  getTrainings,
  getWorkCenters
} from "./resources.service";

export type Ability = NonNullable<
  Awaited<ReturnType<typeof getAbility>>["data"]
>;

export type Abilities = NonNullable<
  Awaited<ReturnType<typeof getAbilities>>["data"]
>;

export type AbilityDatum = {
  week: number;
  value: number;
};

export type AbilityEmployees = NonNullable<
  NonNullable<Awaited<ReturnType<typeof getAbility>>["data"]>["employeeAbility"]
>;

export enum AbilityEmployeeStatus {
  NotStarted = "Not Started",
  InProgress = "In Progress",
  Complete = "Complete"
}

export function getTrainingStatus(
  employeeAbility: {
    lastTrainingDate: string | null;
    trainingDays: number;
    trainingCompleted: boolean | null;
  } | null
) {
  if (!employeeAbility) return undefined;
  if (employeeAbility.trainingCompleted) return AbilityEmployeeStatus.Complete;
  if (employeeAbility.trainingDays > 0) return AbilityEmployeeStatus.InProgress;
  return AbilityEmployeeStatus.NotStarted;
}

export type Contractor = NonNullable<
  Awaited<ReturnType<typeof getContractors>>["data"]
>[number];

export type EmployeeAbility = NonNullable<
  Awaited<ReturnType<typeof getEmployeeAbilities>>["data"]
>[number];

export type Location = NonNullable<
  Awaited<ReturnType<typeof getLocations>>["data"]
>[number];

export type Partner = NonNullable<
  Awaited<ReturnType<typeof getPartners>>["data"]
>[number];

export type Process = NonNullable<
  Awaited<ReturnType<typeof getProcesses>>["data"]
>[number];

export type ShiftLocation = NonNullable<
  Awaited<ReturnType<typeof getLocations>>["data"]
>[number];

export type WorkCenter = NonNullable<
  Awaited<ReturnType<typeof getWorkCenters>>["data"]
>[number];

export type Training = NonNullable<
  Awaited<ReturnType<typeof getTraining>>["data"]
>;

export type TrainingListItem = NonNullable<
  Awaited<ReturnType<typeof getTrainings>>["data"]
>[number];

export type TrainingQuestion = NonNullable<
  Awaited<ReturnType<typeof getTrainingQuestions>>["data"]
>[number];

export type TrainingAssignmentStatusItem = {
  trainingAssignmentId: string;
  trainingId: string;
  trainingName: string;
  frequency: (typeof trainingFrequency)[number];
  trainingType: "Mandatory" | "Optional";
  employeeId: string;
  employeeName: string | null;
  avatarUrl: string | null;
  employeeStartDate: string | null;
  companyId: string;
  currentPeriod: string | null;
  completionId: number | null;
  completedAt: string | null;
  status: (typeof trainingAssignmentStatusOptions)[number];
};

export type TrainingAssignmentSummaryItem = {
  trainingId: string;
  trainingName: string;
  frequency: (typeof trainingFrequency)[number];
  currentPeriod: string | null;
  totalAssigned: number;
  completed: number;
  pending: number;
  overdue: number;
  completionPercent: number;
};

export type TrainingAssignment = NonNullable<
  Awaited<ReturnType<typeof getTrainingAssignment>>["data"]
>;

export type Suggestion = NonNullable<
  Awaited<ReturnType<typeof getSuggestion>>["data"]
>;

export type SuggestionListItem = NonNullable<
  Awaited<ReturnType<typeof getSuggestions>>["data"]
>[number];

export type FailureMode = NonNullable<
  Awaited<ReturnType<typeof getFailureModes>>["data"]
>[number];

export type FailureModeDetail = NonNullable<
  Awaited<ReturnType<typeof getFailureMode>>["data"]
>;

export type MaintenanceDispatch = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceDispatches>>["data"]
>[number];

export type MaintenanceDispatchDetail = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceDispatch>>["data"]
>;

export type MaintenanceDispatchComment = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceDispatchComments>>["data"]
>[number];

export type MaintenanceDispatchEvent = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceDispatchEvents>>["data"]
>[number];

export type MaintenanceDispatchItem = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceDispatchItems>>["data"]
>[number];

export type MaintenanceDispatchWorkCenter = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceDispatchWorkCenters>>["data"]
>[number];

export type MaintenanceSchedule = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceSchedules>>["data"]
>[number];

export type MaintenanceScheduleDetail = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceSchedule>>["data"]
>;

export type MaintenanceScheduleItem = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceScheduleItems>>["data"]
>[number];

export type MaintenanceDispatchByLocation = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceDispatchesByLocation>>["data"]
>[number];

export type MaintenanceScheduleByLocation = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceSchedulesByLocation>>["data"]
>[number];
