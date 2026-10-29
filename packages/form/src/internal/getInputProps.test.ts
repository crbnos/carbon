// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it, vi } from "vitest";
import type { ValidationBehaviorOptions } from "./getInputProps";
import { createGetInputProps } from "./getInputProps";

const fakeEvent = { fake: "event" } as any;

// The composed handlers ARE the output here, so spies are the assertion.
it.each<{
  state: string;
  touched: boolean;
  hasBeenSubmitted: boolean;
  validationBehavior?: Partial<ValidationBehaviorOptions>;
  validatesOnChange: boolean;
  validatesOnBlur: boolean;
}>([
  {
    state: "untouched, default",
    touched: false,
    hasBeenSubmitted: false,
    validatesOnChange: false,
    validatesOnBlur: true
  },
  {
    state: "untouched, initial onChange",
    touched: false,
    hasBeenSubmitted: false,
    validationBehavior: { initial: "onChange" },
    validatesOnChange: true,
    validatesOnBlur: false
  },
  {
    state: "untouched, initial onSubmit",
    touched: false,
    hasBeenSubmitted: false,
    validationBehavior: { initial: "onSubmit" },
    validatesOnChange: false,
    validatesOnBlur: false
  },
  {
    state: "touched, default",
    touched: true,
    hasBeenSubmitted: false,
    validatesOnChange: true,
    validatesOnBlur: false
  },
  {
    state: "touched, whenTouched onBlur",
    touched: true,
    hasBeenSubmitted: false,
    validationBehavior: { whenTouched: "onBlur" },
    validatesOnChange: false,
    validatesOnBlur: true
  },
  {
    state: "submitted, default",
    touched: true,
    hasBeenSubmitted: true,
    validatesOnChange: true,
    validatesOnBlur: false
  },
  {
    state: "submitted, whenSubmitted onBlur",
    touched: true,
    hasBeenSubmitted: true,
    validationBehavior: { whenSubmitted: "onBlur" },
    validatesOnChange: false,
    validatesOnBlur: true
  }
])(
  "$state: validates on change=$validatesOnChange, on blur=$validatesOnBlur, and still calls the provided handlers",
  ({
    touched,
    hasBeenSubmitted,
    validationBehavior,
    validatesOnChange,
    validatesOnBlur
  }) => {
    const options = {
      name: "some-field",
      defaultValue: "test default value",
      touched,
      hasBeenSubmitted,
      validationBehavior,
      setTouched: vi.fn(),
      clearError: vi.fn(),
      validate: vi.fn()
    };
    const provided = { onBlur: vi.fn(), onChange: vi.fn() };
    const { onChange, onBlur } = createGetInputProps(options)(provided);

    onChange!(fakeEvent);
    expect(provided.onChange).toHaveBeenCalledExactlyOnceWith(fakeEvent);
    expect(options.setTouched).toHaveBeenCalledExactlyOnceWith(true);
    expect(options.validate).toHaveBeenCalledTimes(validatesOnChange ? 1 : 0);
    // A change that does not validate clears the stale error instead.
    expect(options.clearError).toHaveBeenCalledTimes(validatesOnChange ? 0 : 1);

    options.validate.mockClear();
    onBlur!(fakeEvent);
    expect(provided.onBlur).toHaveBeenCalledExactlyOnceWith(fakeEvent);
    expect(options.setTouched).toHaveBeenCalledTimes(1);
    expect(options.validate).toHaveBeenCalledTimes(validatesOnBlur ? 1 : 0);
  }
);
