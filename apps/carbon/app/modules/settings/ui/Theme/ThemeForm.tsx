import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  VStack,
  cn,
} from "@carbon/react";
import type { Theme } from "@carbon/utils";
import { themes } from "@carbon/utils";
import { useFetcher } from "@remix-run/react";
import { RxCheck } from "react-icons/rx";
import type { z } from "zod";
import { useMode } from "~/hooks/useMode";
import type { themeValidator } from "~/modules/settings";
import type { Action } from "~/types";
import { path } from "~/utils/path";

type ThemeFormProps = {
  theme: z.infer<typeof themeValidator>;
};

const ThemeForm = ({ theme: defaultValues }: ThemeFormProps) => {
  const mode = useMode();
  const fetcher = useFetcher<Action>();

  const onThemeChange = (t: Theme) => {
    const variables = mode === "dark" ? t.cssVars.dark : t.cssVars.light;

    Object.entries(variables).forEach(([key, value]) => {
      document.body.style.setProperty(`--${key}`, value);
    });
  };

  const optimisticTheme =
    fetcher?.formData?.get("theme") ?? defaultValues.theme;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme</CardTitle>
        <CardDescription>
          This updates the theme for all users of the application
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VStack spacing={4} className="max-w-[520px]">
          <div className="grid grid-cols-3 gap-4">
            {themes.map((t) => {
              const isActive = optimisticTheme === t.name;
              return (
                <fetcher.Form
                  key={t.name}
                  action={path.to.theme}
                  method="post"
                  onSubmit={() => onThemeChange(t)}
                >
                  <input type="hidden" name="theme" value={t.name} />
                  <Button
                    key={t.name}
                    variant="secondary"
                    type="submit"
                    className={cn(
                      "justify-start w-full",
                      isActive && "border-2 border-primary"
                    )}
                    style={
                      {
                        "--theme-primary": `hsl(${
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
                </fetcher.Form>
              );
            })}
          </div>
        </VStack>
      </CardContent>
    </Card>
  );
};

export default ThemeForm;
