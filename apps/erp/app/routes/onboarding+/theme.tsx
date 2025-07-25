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
  HStack,
  VStack,
  cn,
  useKeyboardShortcuts,
} from "@carbon/react";
import { useMode } from "@carbon/remix";
import { themes, type Theme } from "@carbon/utils";
import {
  Link,
  useFetcher,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useEffect, useRef, useState } from "react";
import { BiMoon, BiSun } from "react-icons/bi";
import { RxCheck } from "react-icons/rx";
import { useOnboarding } from "~/hooks";
import { themeValidator, type Theme as ThemeValue } from "~/modules/settings";
import type { action as modeAction } from "~/root";
import { getTheme, setTheme } from "~/services/theme.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Theme",
  to: path.to.theme,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const theme = getTheme(request);

  return json({
    theme: theme ?? "zinc",
  });
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
    headers: { "Set-Cookie": setTheme(theme) },
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
  };

  useEffect(() => {
    const t = themes.find((t) => t.name === theme);
    if (t) {
      onThemeChange(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const { next, previous } = useOnboarding();

  const submit = useSubmit();
  const onSubmit = () => {
    const formData = new FormData();
    formData.append("theme", theme);
    formData.append("next", next);
    submit(formData, {
      method: "post",
    });
  };

  const transition = useNavigation();

  const nextRef = useRef<HTMLButtonElement>(null);

  useKeyboardShortcuts({
    Enter: () => {
      nextRef.current?.click();
    },
  });

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Choose your style</CardTitle>
        <CardDescription>
          You can change the UI style any time through the theme setting
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
                Light
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
                Dark
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
                      })`,
                    } as React.CSSProperties
                  }
                >
                  <span
                    className={cn(
                      "mr-1 flex h-5 w-5 shrink-0 -translate-x-1 items-center justify-center rounded-full bg-[--theme-primary]"
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
                Previous
              </Link>
            </Button>
          )}

          <Button
            isLoading={transition.state !== "idle"}
            isDisabled={transition.state !== "idle"}
            ref={nextRef}
            onClick={onSubmit}
          >
            Next
          </Button>
        </HStack>
      </CardFooter>
    </Card>
  );
}
