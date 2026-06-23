import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import {
  getSortedLanguageSelectOptions,
  resolveLanguage
} from "@carbon/locale";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  ItarDisclosure,
  Switch,
  useDisclosure,
  useEdition,
  useMode
} from "@carbon/react";
import { Edition, themes } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo, useState } from "react";
import {
  LuCheck,
  LuCreditCard,
  LuFileText,
  LuHouse,
  LuLanguages,
  LuLogOut,
  LuMoon,
  LuPalette,
  LuShieldCheck,
  LuSun,
  LuUser
} from "react-icons/lu";
import { Form, Link, useFetcher } from "react-router";
import { Avatar } from "~/components";
import { usePermissions, useUser } from "~/hooks";
import { useTheme } from "~/hooks/useTheme";
import type { action } from "~/root";
import { startModeTransition } from "~/utils/dom";
import { path } from "~/utils/path";

const AvatarMenu = () => {
  const { t } = useLingui();
  const user = useUser();
  const name = `${user.firstName} ${user.lastName}`;
  const { isOwner } = usePermissions();
  const edition = useEdition();

  const mode = useMode();
  const serverTheme = useTheme();

  const nextMode = mode === "dark" ? "light" : "dark";

  const fetcher = useFetcher<typeof action>();

  const onModeToggle = () => {
    const formData = new FormData();
    formData.append("mode", nextMode);
    startModeTransition(nextMode, () => {
      fetcher.submit(formData, { method: "post", action: path.to.root });
    });
  };
  const localeFetcher = useFetcher<{ ok?: boolean }>();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);

  const { locale } = useLocale();
  const resolvedLocale = resolveLanguage(locale);

  const languageOptions = useMemo(
    () => getSortedLanguageSelectOptions(locale),
    [locale]
  );

  const onThemeChange = (t: string) => {
    const newTheme = themes.find((theme) => theme.name === t);
    if (!newTheme) return;
    const variables =
      mode === "dark" ? newTheme.cssVars.dark : newTheme.cssVars.light;

    setSelectedTheme(t);

    const formData = new FormData();
    formData.append("theme", t);
    fetcher.submit(formData, { method: "post", action: path.to.theme });

    Object.entries(variables).forEach(([key, value]) => {
      document.body.style.setProperty(`--${key}`, value);
    });
  };

  const optimisticTheme = selectedTheme ?? serverTheme;

  const itarDisclosure = useDisclosure();

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger className="outline-none focus-visible:outline-none">
          <Avatar path={user.avatarUrl} name={name} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{t`Signed in as ${name}`}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to={path.to.authenticatedRoot}>
              <DropdownMenuIcon icon={<LuHouse />} />
              <Trans>Dashboard</Trans>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <DropdownMenuItem asChild>
            <a href={path.to.apiDocs} target="_blank" rel="noreferrer">
              <DropdownMenuIcon icon={<LuFileText />} />
              <Trans>API Documentation</Trans>
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center justify-start">
                <DropdownMenuIcon
                  icon={mode === "dark" ? <LuMoon /> : <LuSun />}
                />
                <Trans>Dark Mode</Trans>
              </div>
              <div>
                <Switch
                  checked={mode === "dark"}
                  onCheckedChange={onModeToggle}
                />
              </div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <DropdownMenuIcon icon={<LuPalette />} />
              <Trans>Theme Color</Trans>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={optimisticTheme}
                onValueChange={onThemeChange}
              >
                {themes.map((t) => (
                  <DropdownMenuRadioItem
                    key={t.name}
                    value={t.name}
                    onSelect={(e) => e.preventDefault()}
                    style={
                      {
                        "--theme-primary": `hsl(${
                          t?.activeColor[mode === "dark" ? "dark" : "light"]
                        })`
                      } as React.CSSProperties
                    }
                  >
                    <div className="flex items-center">
                      <div className="w-4 h-4 rounded-full mr-2 bg-[var(--theme-primary)]" />
                      {t.label}
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={localeFetcher.state !== "idle"}>
              <DropdownMenuIcon icon={<LuLanguages />} />
              <Trans>Language</Trans>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <localeFetcher.Form method="post" action="/api/locale">
                {languageOptions.map((opt) => (
                  <DropdownMenuItem key={opt.value} asChild>
                    <button
                      type="submit"
                      name="locale"
                      value={opt.value}
                      disabled={
                        localeFetcher.state !== "idle" ||
                        opt.value === resolvedLocale
                      }
                      className="flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none focus:bg-accent data-[highlighted]:bg-accent"
                    >
                      <span
                        className={
                          opt.value === resolvedLocale
                            ? "font-medium"
                            : undefined
                        }
                      >
                        {opt.label}
                      </span>
                      {opt.value === resolvedLocale ? (
                        <LuCheck className="ml-auto h-4 w-4 shrink-0" />
                      ) : null}
                    </button>
                  </DropdownMenuItem>
                ))}
              </localeFetcher.Form>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to={path.to.profile}>
              <DropdownMenuIcon icon={<LuUser />} />
              <Trans>Account Settings</Trans>
            </Link>
          </DropdownMenuItem>

          {edition === Edition.Cloud && isOwner() && (
            <DropdownMenuItem asChild>
              <Link to={path.to.billing}>
                <DropdownMenuIcon icon={<LuCreditCard />} />
                <span>
                  <Trans>Manage Subscription</Trans>
                </span>
              </Link>
            </DropdownMenuItem>
          )}

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <DropdownMenuIcon icon={<LuFileText />} />
              <Trans>Terms and Privacy</Trans>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem asChild>
                <a href={path.to.legal.termsAndConditions}>
                  <DropdownMenuIcon icon={<LuFileText />} />
                  <Trans>Terms of Service</Trans>
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={path.to.legal.privacyPolicy}>
                  <DropdownMenuIcon icon={<LuShieldCheck />} />
                  <Trans>Privacy Policy</Trans>
                </a>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />
          {CONTROLLED_ENVIRONMENT && (
            <DropdownMenuItem onClick={itarDisclosure.onOpen}>
              <DropdownMenuIcon icon={<LuShieldCheck />} />
              <Trans>About</Trans>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Form method="post" action={path.to.logout}>
              <button type="submit" className="w-full h-full flex items-center">
                <DropdownMenuIcon icon={<LuLogOut />} />
                <span>
                  <Trans>Sign Out</Trans>
                </span>
              </button>
            </Form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {CONTROLLED_ENVIRONMENT && <ItarDisclosure disclosure={itarDisclosure} />}
    </>
  );
};

export default AvatarMenu;
