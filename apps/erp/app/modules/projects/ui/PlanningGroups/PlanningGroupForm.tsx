// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Hyperlink } from "~/components";
import {
  Boolean,
  Hidden,
  Input,
  Location,
  Select,
  SelectControlled,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  planningGroupExcessRules,
  planningGroupPriorityRules,
  planningGroupValidator
} from "../../projects.models";
import type { PlanningGroupMember } from "../../types";
import ProjectStatus from "../Projects/ProjectStatus";
import { usePlanningGroupExcessRuleLabels } from "./usePlanningGroupLabels";

type PlanningGroupFormProps = {
  initialValues: z.infer<typeof planningGroupValidator>;
  /** Projects with project stock: the choices for the exception project. */
  stockProjects: { id: string; identifier: string | null; name: string }[];
  /** An existing group only: its member projects. */
  members?: PlanningGroupMember[];
  onClose: () => void;
};

/**
 * Creates or edits a planning group in a drawer. An existing group lists its
 * member projects; a project joins a group on its own Details tab.
 */
const PlanningGroupForm = ({
  initialValues,
  stockProjects,
  members,
  onClose
}: PlanningGroupFormProps) => {
  const { t } = useLingui();
  const excessRuleLabels = usePlanningGroupExcessRuleLabels();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const [excessRule, setExcessRule] = useState<string>(
    initialValues.excessRule
  );

  const isEditing = initialValues.id !== undefined;
  const canSave = isEditing
    ? permissions.can("update", "projects")
    : permissions.can("create", "projects");

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={planningGroupValidator}
            method="post"
            action={
              isEditing
                ? path.to.planningGroup(initialValues.id!)
                : path.to.newPlanningGroup
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Planning Group</Trans>
                ) : (
                  <Trans>New Planning Group</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} autoFocus={!isEditing} />
                <Location
                  name="locationId"
                  label={t`Location`}
                  helperText={t`Only projects at this location can join`}
                />
                <Select
                  name="priorityRule"
                  label={t`Priority Rule`}
                  helperText={t`The order in which members get the group's supply`}
                  options={planningGroupPriorityRules.map((rule) => ({
                    label: rule,
                    value: rule
                  }))}
                />
                <SelectControlled
                  name="excessRule"
                  label={t`Excess Rule`}
                  helperText={t`Where received stock goes when no member needs it`}
                  options={planningGroupExcessRules.map((rule) => ({
                    label: excessRuleLabels[rule],
                    value: rule
                  }))}
                  value={excessRule}
                  onChange={(option) => setExcessRule(option?.value ?? "")}
                />
                {excessRule === "Exception Project" && (
                  <Select
                    name="exceptionProjectId"
                    label={t`Exception Project`}
                    options={stockProjects.map((project) => ({
                      label:
                        `${project.identifier ?? ""} ${project.name}`.trim(),
                      value: project.id
                    }))}
                  />
                )}
                <Boolean
                  name="active"
                  label={t`Active`}
                  description={t`An inactive group's members are planned on their own`}
                />
                {isEditing && (
                  <div className="flex w-full flex-col gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      <Trans>Members</Trans>
                    </span>
                    {(members ?? []).length === 0 ? (
                      <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                        <Trans>
                          No members yet. A project with project stock joins the
                          group on its Details tab.
                        </Trans>
                      </p>
                    ) : (
                      <div className="w-full overflow-x-auto rounded-md border border-border">
                        <TableBase full>
                          <Thead>
                            <Tr>
                              <Th>
                                <Trans>Project</Trans>
                              </Th>
                              <Th className="text-right">
                                <Trans>Priority</Trans>
                              </Th>
                              <Th>
                                <Trans>Status</Trans>
                              </Th>
                            </Tr>
                          </Thead>
                          <Tbody>
                            {(members ?? []).map((member) => (
                              <Tr key={member.id}>
                                <Td>
                                  <div className="flex min-w-0 flex-col">
                                    <Hyperlink to={path.to.project(member.id)}>
                                      <span className="whitespace-nowrap">
                                        {member.identifier}
                                      </span>
                                    </Hyperlink>
                                    <span className="line-clamp-1 text-xs text-muted-foreground">
                                      {member.name}
                                    </span>
                                  </div>
                                </Td>
                                <Td className="text-right tabular-nums">
                                  {member.planningPriority}
                                </Td>
                                <Td>
                                  <ProjectStatus status={member.status} />
                                </Td>
                              </Tr>
                            ))}
                          </Tbody>
                        </TableBase>
                      </div>
                    )}
                  </div>
                )}
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!canSave}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default PlanningGroupForm;
