import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  HStack,
  Heading,
  IconButton,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  useDisclosure,
} from "@carbon/react";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { Outlet, useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useState } from "react";
import { IoMdClose } from "react-icons/io";
import {
  LuChevronDown,
  LuChevronLeft,
  LuChevronUp,
  LuSquarePen,
} from "react-icons/lu";
import { Hidden, Input, Submit } from "~/components/Form";
import type { AbilityDatum } from "~/modules/resources";
import {
  AbilityEmployeesTable,
  abilityCurveValidator,
  abilityNameValidator,
  getAbility,
  updateAbility,
} from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { abilitiesQuery, getCompanyId } from "~/utils/react-query";

export const handle: Handle = {
  breadcrumb: "Abilities",
  to: path.to.abilities,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
  });

  const { abilityId } = params;
  if (!abilityId) {
    throw redirect(
      path.to.abilities,
      await flash(request, error(null, "Ability ID not found"))
    );
  }

  const ability = await getAbility(client, abilityId);
  if (ability.error || !ability.data) {
    throw redirect(
      path.to.abilities,
      await flash(request, error(ability.error, "Failed to load ability"))
    );
  }

  return json({
    ability: ability.data,
    weeks:
      // @ts-ignore
      ability.data.curve?.data[ability.data.curve?.data.length - 1].week ?? 0,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    update: "resources",
  });

  const { abilityId } = params;
  if (!abilityId) {
    throw new Error("Ability ID not found");
  }

  const formData = await request.formData();

  if (formData.get("intent") === "name") {
    const validation = await validator(abilityNameValidator).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    const { name } = validation.data;
    const updateAbilityName = await updateAbility(client, abilityId, {
      name,
    });
    if (updateAbilityName.error) {
      throw redirect(
        path.to.ability(abilityId),
        await flash(
          request,
          error(updateAbilityName.error, "Failed to update ability name")
        )
      );
    }
  }

  if (formData.get("intent") === "curve") {
    const validation = await validator(abilityCurveValidator).validate(
      formData
    );
    if (validation.error) {
      return validationError(validation.error);
    }

    const { data, shadowWeeks } = validation.data;
    const updateAbilityCurve = await updateAbility(client, abilityId, {
      curve: {
        data: JSON.parse(data),
      },
      shadowWeeks,
    });
    if (updateAbilityCurve.error) {
      throw redirect(
        path.to.ability(abilityId),
        await flash(
          request,
          error(updateAbilityCurve.error, "Failed to update ability data")
        )
      );
    }
  }

  throw redirect(
    path.to.ability(abilityId),
    await flash(request, success("Ability updated"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    abilitiesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function AbilitiesRoute() {
  const { ability, weeks } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const editingTitle = useDisclosure();
  const [data, setData] = useState<AbilityDatum[]>(
    // @ts-ignore
    ability.curve?.data ?? []
  );
  const [time, setTime] = useState<number>(weeks);
  const [controlledShadowWeeks, setControlledShadowWeeks] = useState<number>(
    ability.shadowWeeks ?? 0
  );

  const updateWeeks = (newWeeks: number) => {
    const scale = 1 + (newWeeks - time) / time;
    setData((prevData) =>
      prevData.map((datum) => ({
        ...datum,
        week: Math.round(datum.week * scale * 10) / 10,
      }))
    );
    setTime(newWeeks);
  };

  const updateShadowTime = (newShadowTime: number) => {
    setControlledShadowWeeks(newShadowTime);
  };

  return (
    <>
      <div className="bg-background w-full relative">
        <HStack className="w-full justify-between p-4">
          {editingTitle.isOpen ? (
            <ValidatedForm
              validator={abilityNameValidator}
              method="post"
              action={path.to.ability(ability.id)}
              defaultValues={{
                name: ability.name,
              }}
              onSubmit={editingTitle.onClose}
            >
              <Hidden name="intent" value="name" />
              <HStack>
                <IconButton
                  aria-label="Back"
                  variant="ghost"
                  icon={<LuChevronLeft />}
                  onClick={() => navigate(path.to.abilities)}
                />
                <Input
                  autoFocus
                  name="name"
                  className="text-xl font-bold border-none shadow-none"
                />
                <Submit>Save</Submit>
                <IconButton
                  aria-label="Cancel"
                  variant="ghost"
                  icon={<IoMdClose />}
                  onClick={editingTitle.onClose}
                />
              </HStack>
            </ValidatedForm>
          ) : (
            <HStack>
              <IconButton
                aria-label="Back"
                variant="ghost"
                icon={<LuChevronLeft />}
                onClick={() => navigate(path.to.abilities)}
              />
              <Heading size="h3">{ability.name}</Heading>
              <IconButton
                aria-label="Edit"
                variant="ghost"
                icon={<LuSquarePen />}
                onClick={editingTitle.onOpen}
              />
            </HStack>
          )}

          <HStack>
            <span className="text-sm">Weeks Shadowing:</span>
            <NumberField
              name="unitPrice"
              value={controlledShadowWeeks}
              onChange={updateShadowTime}
              minValue={0}
              maxValue={time}
              className="max-w-[100px]"
            >
              <NumberInputGroup className="relative">
                <NumberInput size="sm" />
                <NumberInputStepper>
                  <NumberIncrementStepper>
                    <LuChevronUp size="0.75em" strokeWidth="3" />
                  </NumberIncrementStepper>
                  <NumberDecrementStepper>
                    <LuChevronDown size="0.75em" strokeWidth="3" />
                  </NumberDecrementStepper>
                </NumberInputStepper>
              </NumberInputGroup>
            </NumberField>

            <span className="text-sm">Weeks to Learn:</span>
            <NumberField
              name="unitPrice"
              value={time}
              onChange={updateWeeks}
              minValue={1}
              className="max-w-[100px]"
            >
              <NumberInputGroup className="relative">
                <NumberInput size="sm" />
                <NumberInputStepper>
                  <NumberIncrementStepper>
                    <LuChevronUp size="0.75em" strokeWidth="3" />
                  </NumberIncrementStepper>
                  <NumberDecrementStepper>
                    <LuChevronDown size="0.75em" strokeWidth="3" />
                  </NumberDecrementStepper>
                </NumberInputStepper>
              </NumberInputGroup>
            </NumberField>

            <ValidatedForm
              validator={abilityCurveValidator}
              method="post"
              action={path.to.ability(ability.id)}
            >
              <Hidden name="intent" value="curve" />
              <Hidden name="data" value={JSON.stringify(data)} />
              <Hidden name="shadowWeeks" value={controlledShadowWeeks} />
              <Submit>Save</Submit>
            </ValidatedForm>
          </HStack>
        </HStack>
      </div>
      <AbilityEmployeesTable
        employees={ability.employeeAbility ?? []}
        weeks={weeks}
      />
      <Outlet />
    </>
  );
}
