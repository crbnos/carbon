import { assertIsPost } from "@carbon/auth";
import { validationError, validator } from "@carbon/form";
import {
  Button,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  RadioGroup,
  RadioGroupButton,
  useMode,
  VStack
} from "@carbon/react";
import type { Theme } from "@carbon/utils";
import { themes } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { BiMoon, BiSun } from "react-icons/bi";
import { RxCheck } from "react-icons/rx";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Link,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigation,
  useSubmit
} from "react-router";
import { OnboardingCard, OnboardingCardContent } from "~/components";
import { useOnboarding } from "~/hooks";
import type { Theme as ThemeValue } from "~/modules/settings";
import { themeValidator } from "~/modules/settings";
import type { action as modeAction } from "~/root";
import { getTheme, setTheme } from "~/services/theme.server";
import { ONBOARDING_SHORTCUTS } from "~/shortcuts";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Theme`,
  to: path.to.theme
};

export async function loader({ request }: LoaderFunctionArgs) {
  const theme = getTheme(request);

  return {
    theme: theme ?? "zinc"
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const formData = await request.formData();

  const validation = await validator(themeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { next, theme } = validation.data;
  if (!next) throw new Error("Fatal: next is required");

  throw redirect(next, {
    headers: { "Set-Cookie": setTheme(theme) }
  });
}

export default function OnboardingTheme() {
  const { theme: initialTheme } = useLoaderData<typeof loader>();
  const { t } = useLingui();

  const mode = useMode();
  const modeFetcher = useFetcher<typeof modeAction>();

  const [theme, setTheme] = useState<ThemeValue>(initialTheme as "zinc");

  const onThemeChange = (t: Theme) => {
    setTheme(t.name);

    const variables = mode === "dark" ? t.cssVars.dark : t.cssVars.light;

    Object.entries(variables).forEach(([key, value]) => {
      document.body.style.setProperty(`--${key}`, value);
    });

    window.dispatchEvent(
      new CustomEvent("onboarding-theme-change", { detail: t.name })
    );
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    const t = themes.find((t) => t.name === theme);
    if (t) {
      onThemeChange(t);
    }
  }, [mode]);

  const { next, previous } = useOnboarding();

  const submit = useSubmit();
  const onSubmit = () => {
    const formData = new FormData();
    formData.append("theme", theme);
    formData.append("next", next);
    submit(formData, {
      method: "post"
    });
  };

  const transition = useNavigation();

  const onModeChange = (nextMode: string) => {
    document.body.removeAttribute("style");
    modeFetcher.submit(
      { mode: nextMode },
      { method: "post", action: path.to.root }
    );
  };

  return (
    <OnboardingCard>
      <CardHeader>
        <CardTitle>
          <Trans>Choose your style</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            You can change the UI style any time through the theme setting
          </Trans>
        </CardDescription>
      </CardHeader>
      <OnboardingCardContent>
        <VStack spacing={4}>
          <RadioGroup
            value={mode === "dark" ? "dark" : "light"}
            onValueChange={onModeChange}
            aria-label={t`Light or dark mode`}
            className="flex w-full gap-2"
          >
            <RadioGroupButton
              value="light"
              autoFocus={mode !== "dark"}
              className={cn(
                "flex-1",
                mode == "light" && "border-2 border-primary"
              )}
            >
              <BiSun />
              <Trans>Light</Trans>
            </RadioGroupButton>
            <RadioGroupButton
              value="dark"
              autoFocus={mode === "dark"}
              className={cn(
                "flex-1",
                mode == "dark" && "border-2 border-primary"
              )}
            >
              <BiMoon />
              <Trans>Dark</Trans>
            </RadioGroupButton>
          </RadioGroup>
          <RadioGroup
            value={theme}
            onValueChange={(name) => {
              const selected = themes.find((entry) => entry.name === name);
              if (selected) onThemeChange(selected);
            }}
            aria-label={t`Theme`}
            className="w-full grid grid-cols-3 gap-4"
          >
            {themes.map((t) => {
              const isActive = theme === t.name;
              return (
                <RadioGroupButton
                  key={t.name}
                  value={t.name}
                  className={cn(
                    "justify-start",
                    isActive && "border-2 border-primary"
                  )}
                  style={
                    {
                      "--theme-primary": `hsl(${
                        t?.activeColor[mode === "dark" ? "dark" : "light"]
                      })`,
                      borderColor: `hsl(${
                        t?.activeColor[mode === "dark" ? "dark" : "light"]
                      })`
                    } as React.CSSProperties
                  }
                >
                  <span
                    className={cn(
                      "mr-1 flex h-5 w-5 shrink-0 -translate-x-1 items-center justify-center rounded-full bg-[var(--theme-primary)]"
                    )}
                  >
                    {isActive && <RxCheck className="h-4 w-4 text-white" />}
                  </span>
                  {t.label}
                </RadioGroupButton>
              );
            })}
          </RadioGroup>
        </VStack>
      </OnboardingCardContent>
      <CardFooter>
        <HStack>
          {previous && (
            <Button
              variant="solid"
              isDisabled={!previous}
              size="md"
              asChild
              tabIndex={-1}
            >
              <Link to={previous} prefetch="intent">
                <Trans>Previous</Trans>
              </Link>
            </Button>
          )}

          <Button
            isLoading={transition.state !== "idle"}
            isDisabled={transition.state !== "idle"}
            shortcut={ONBOARDING_SHORTCUTS.continue}
            onClick={onSubmit}
          >
            <Trans>Next</Trans>
          </Button>
        </HStack>
      </CardFooter>
    </OnboardingCard>
  );
}
