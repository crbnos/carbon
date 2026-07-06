import { assertIsPost } from "@carbon/auth";
import { validationError, validator } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  useKeyboardShortcuts,
  useMode,
  VStack
} from "@carbon/react";
import type { Theme } from "@carbon/utils";
import { themes } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
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
import { useOnboarding } from "~/hooks";
import type { Theme as ThemeValue } from "~/modules/settings";
import { themeValidator } from "~/modules/settings";
import type { action as modeAction } from "~/root";
import { getTheme, setTheme } from "~/services/theme.server";
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

  const nextRef = useRef<HTMLButtonElement>(null);

  useKeyboardShortcuts({
    Enter: () => {
      nextRef.current?.click();
    }
  });

  return (
    <Card className="max-w-lg">
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
      <CardContent>
        <VStack spacing={4}>
          <HStack className="w-full justify-between">
            <modeFetcher.Form
              action={path.to.root}
              method="post"
              onSubmit={() => {
                document.body.removeAttribute("style");
              }}
              className="w-full"
            >
              <input type="hidden" name="mode" value="light" />
              <Button
                variant="secondary"
                type="submit"
                leftIcon={<BiSun />}
                className={cn(
                  "w-full",
                  mode == "light" && "border-2 border-primary"
                )}
              >
                <Trans>Light</Trans>
              </Button>
            </modeFetcher.Form>
            <modeFetcher.Form
              action={path.to.root}
              method="post"
              onSubmit={() => {
                document.body.removeAttribute("style");
              }}
              className="w-full"
            >
              <input type="hidden" name="mode" value="dark" />
              <Button
                variant="secondary"
                leftIcon={<BiMoon />}
                type="submit"
                className={cn(
                  "w-full",
                  mode == "dark" && "border-2 border-primary"
                )}
              >
                <Trans>Dark</Trans>
              </Button>
            </modeFetcher.Form>
          </HStack>
          <div className="w-full grid grid-cols-3 gap-4">
            {themes.map((t) => {
              const isActive = theme === t.name;
              return (
                <Button
                  key={t.name}
                  variant="secondary"
                  onClick={() => onThemeChange(t)}
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
                </Button>
              );
            })}
          </div>
        </VStack>
      </CardContent>
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
            ref={nextRef}
            onClick={onSubmit}
          >
            <Trans>Next</Trans>
          </Button>
        </HStack>
      </CardFooter>
    </Card>
  );
}
