import type {
  getAbilities,
  getAbility,
  getContractors,
  getEmployeeAbilities,
  getLocations,
  getPartners,
  getProcesses,
  getWorkCenters,
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
  Complete = "Complete",
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
