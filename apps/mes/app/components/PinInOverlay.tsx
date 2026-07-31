"use client";

import {
  Avatar,
  Button,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuCheck, LuLoader, LuLogOut, LuSearch, LuX } from "react-icons/lu";
import { useFetcher } from "react-router";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

const RECENT_KEY_PREFIX = "console-recent-";
const MAX_RECENT = 5;

function getRecentOperators(companyId: string): string[] {
  try {
    const raw = localStorage.getItem(`${RECENT_KEY_PREFIX}${companyId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addRecentOperator(companyId: string, userId: string) {
  try {
    const recent = getRecentOperators(companyId).filter((id) => id !== userId);
    recent.unshift(userId);
    localStorage.setItem(
      `${RECENT_KEY_PREFIX}${companyId}`,
      JSON.stringify(recent.slice(0, MAX_RECENT))
    );
  } catch {
    // localStorage not available
  }
}

type Person = { id: string; name: string; avatarUrl: string | null };

export function PinInOverlay({
  companyId,
  locationEmployeeIds,
  sessionUserId,
  hasPinnedUser = false,
  dismissable = false,
  onDismiss
}: {
  companyId: string;
  locationEmployeeIds: string[];
  sessionUserId?: string;
  hasPinnedUser?: boolean;
  dismissable?: boolean;
  onDismiss?: () => void;
}) {
  const { t } = useLingui();
  const [people] = usePeople();
  const [search, setSearch] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const pinInFetcher = useFetcher<{ error?: string }>();
  const pinOutFetcher = useFetcher();

  const recentIds = useMemo(() => getRecentOperators(companyId), [companyId]);
  const isPinning = pinInFetcher.state !== "idle";

  useEffect(() => {
    if (!dismissable) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss?.();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dismissable, onDismiss]);

  const submitPinIn = useCallback(
    (person: Person, pinValue: string) => {
      addRecentOperator(companyId, person.id);
      const formData = new FormData();
      formData.append("userId", person.id);
      formData.append("name", person.name);
      formData.append("avatarUrl", person.avatarUrl ?? "");
      if (pinValue) formData.append("pin", pinValue);
      pinInFetcher.submit(formData, {
        method: "POST",
        action: path.to.consolePinIn
      });
    },
    [companyId, pinInFetcher]
  );

  useEffect(() => {
    if (pinInFetcher.state === "idle" && pinInFetcher.data?.error) {
      setPinError(pinInFetcher.data.error);
      setPin("");
    }
  }, [pinInFetcher.state, pinInFetcher.data]);

  // Focus search on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const stationUser = useMemo(
    () => (sessionUserId ? people.find((p) => p.id === sessionUserId) : null),
    [people, sessionUserId]
  );

  const operatorList = useMemo(() => {
    const query = search.toLowerCase().trim();
    let list = sessionUserId
      ? people.filter((p) => p.id !== sessionUserId)
      : people;
    if (locationEmployeeIds.length > 0) {
      list = list.filter((p) => locationEmployeeIds.includes(p.id));
    }
    const filtered = query
      ? list.filter((p) => p.name.toLowerCase().includes(query))
      : list;

    const sorted = [...filtered].sort((a, b) => {
      const aRecent = recentIds.indexOf(a.id);
      const bRecent = recentIds.indexOf(b.id);
      if (aRecent !== -1 && bRecent !== -1) return aRecent - bRecent;
      if (aRecent !== -1) return -1;
      if (bRecent !== -1) return 1;
      return a.name.localeCompare(b.name);
    });

    // When searching, return flat list. When browsing, split into groups.
    if (query) {
      return { recent: [] as Person[], others: sorted, all: sorted };
    }
    const recent = sorted.filter((p) => recentIds.includes(p.id));
    const others = sorted.filter((p) => !recentIds.includes(p.id));
    return { recent, others, all: sorted };
  }, [people, search, recentIds, locationEmployeeIds, sessionUserId]);

  // Track if we've submitted a pin-in attempt
  const hasSubmittedPinIn = useRef(false);

  // Watch for successful pin-in completion
  useEffect(() => {
    if (
      pinInFetcher.state === "submitting" ||
      pinInFetcher.state === "loading"
    ) {
      hasSubmittedPinIn.current = true;
    }
    if (
      hasSubmittedPinIn.current &&
      pinInFetcher.state === "idle" &&
      !pinInFetcher.data?.error
    ) {
      // Fetcher completed without error — cookie is set, dismiss overlay
      hasSubmittedPinIn.current = false;
      onDismiss?.();
    }
  }, [pinInFetcher.state, pinInFetcher.data, onDismiss]);

  const handlePinComplete = useCallback(
    (value: string) => {
      if (selectedPerson && value.length === 4) {
        submitPinIn(selectedPerson, value);
        // Don't dismiss here — wait for fetcher to complete
      }
    },
    [selectedPerson, submitPinIn]
  );

  const handleBackdropClick = useCallback(() => {
    if (dismissable) onDismiss?.();
  }, [dismissable, onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-lg border bg-card shadow-lg overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button — top right, outside the search bar */}
        {dismissable && (
          <button
            type="button"
            onClick={onDismiss}
            className="absolute top-2.5 right-2.5 z-10 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <LuX className="h-4 w-4" />
          </button>
        )}

        {/* Search */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <LuSearch className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={searchRef}
            type="text"
            placeholder={t`Search operators...`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedPerson(null);
              setPin("");
              setPinError(null);
            }}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground pr-8"
          />
        </div>

        {/* Operator list */}
        <div className="max-h-[240px] overflow-y-auto">
          {operatorList.all.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {search ? <Trans>No results</Trans> : <Trans>No operators</Trans>}
            </div>
          ) : (
            <div className="py-1">
              {operatorList.recent.length > 0 && (
                <>
                  <p className="px-4 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    <Trans>Recent</Trans>
                  </p>
                  {operatorList.recent.map((person) => (
                    <OperatorRow
                      key={person.id}
                      person={person}
                      isSelected={selectedPerson?.id === person.id}
                      onSelect={(p) => {
                        setSelectedPerson(
                          selectedPerson?.id === p.id ? null : p
                        );
                        setPin("");
                        setPinError(null);
                      }}
                    />
                  ))}
                  {operatorList.others.length > 0 && (
                    <div className="mx-4 my-1 border-t" />
                  )}
                </>
              )}
              {operatorList.others.map((person) => (
                <OperatorRow
                  key={person.id}
                  person={person}
                  isSelected={selectedPerson?.id === person.id}
                  onSelect={(p) => {
                    setSelectedPerson(selectedPerson?.id === p.id ? null : p);
                    setPin("");
                    setPinError(null);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Station user option — for exiting console mode */}
        {stationUser && !search && (
          <div className="border-t">
            <p className="px-4 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <Trans>Station User</Trans>
            </p>
            <OperatorRow
              person={stationUser}
              isSelected={selectedPerson?.id === stationUser.id}
              onSelect={(p) => {
                setSelectedPerson(selectedPerson?.id === p.id ? null : p);
                setPin("");
                setPinError(null);
              }}
            />
          </div>
        )}

        {/* PIN input — below station user, above footer */}
        {selectedPerson && (
          <div className="border-t px-4 py-3">
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs text-muted-foreground">
                <Trans>Enter PIN for {selectedPerson.name}</Trans>
              </p>
              <div className="flex items-center gap-3">
                <InputOTP
                  maxLength={4}
                  value={pin}
                  onChange={(value) => {
                    setPin(value);
                    setPinError(null);
                  }}
                  onComplete={handlePinComplete}
                  disabled={isPinning}
                  autoFocus
                  containerClassName="[&_[data-slot=input-otp-slot]]:text-[0px]"
                >
                  <InputOTPGroup>
                    <InputOTPSlot
                      index={0}
                      className={
                        pin[0] ? "before:content-['●'] before:text-sm" : ""
                      }
                    />
                    <InputOTPSlot
                      index={1}
                      className={
                        pin[1] ? "before:content-['●'] before:text-sm" : ""
                      }
                    />
                    <InputOTPSlot
                      index={2}
                      className={
                        pin[2] ? "before:content-['●'] before:text-sm" : ""
                      }
                    />
                    <InputOTPSlot
                      index={3}
                      className={
                        pin[3] ? "before:content-['●'] before:text-sm" : ""
                      }
                    />
                  </InputOTPGroup>
                </InputOTP>
                {isPinning && (
                  <LuLoader className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {pinError && (
                <p className="text-xs text-destructive">{pinError}</p>
              )}
            </div>
          </div>
        )}

        {hasPinnedUser && (
          <div className="border-t px-3 py-2.5">
            <Button
              variant="ghost"
              size="md"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => {
                pinOutFetcher.submit(null, {
                  method: "POST",
                  action: path.to.consolePinOut
                });
              }}
            >
              <LuLogOut className="mr-2 h-4 w-4" />
              <Trans>Pin Out</Trans>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function OperatorRow({
  person,
  isSelected,
  onSelect
}: {
  person: Person;
  isSelected: boolean;
  onSelect: (person: Person) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(person)}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
        isSelected ? "bg-primary/5" : "hover:bg-muted/50"
      }`}
    >
      <Avatar
        size="xs"
        name={person.name}
        src={person.avatarUrl ?? undefined}
      />
      <span className="text-sm flex-1 truncate">{person.name}</span>
      {isSelected && <LuCheck className="h-3.5 w-3.5 text-primary shrink-0" />}
    </button>
  );
}
