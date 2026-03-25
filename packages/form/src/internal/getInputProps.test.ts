import { describe, expect, it, jest } from "@jest/globals";
import type { CreateGetInputPropsOptions } from "./getInputProps";
import { createGetInputProps } from "./getInputProps";

const fakeEvent = { fake: "event" } as any;

describe("getInputProps", () => {
  describe("initial", () => {
    it("should validate on blur by default", () => {
      const options: CreateGetInputPropsOptions = {
        name: "some-field",
        defaultValue: "test default value",
        touched: false,
        hasBeenSubmitted: false,
        setTouched: jest.fn(),
        clearError: jest.fn(),
        validate: jest.fn()
      };
      const getInputProps = createGetInputProps(options);

      const provided = {
        onBlur: jest.fn(),
        onChange: jest.fn()
      };
      const { onChange, onBlur } = getInputProps(provided);

      onChange!(fakeEvent);
      expect(provided.onChange).toBeCalledTimes(1);
      expect(provided.onChange).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).not.toBeCalled();

      onBlur!(fakeEvent);
      expect(provided.onBlur).toBeCalledTimes(1);
      expect(provided.onBlur).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).toBeCalledTimes(1);
    });

    it("should respect provided validation behavior", () => {
      const options: CreateGetInputPropsOptions = {
        name: "some-field",
        defaultValue: "test default value",
        touched: false,
        hasBeenSubmitted: false,
        setTouched: jest.fn(),
        clearError: jest.fn(),
        validate: jest.fn(),
        validationBehavior: {
          initial: "onChange"
        }
      };
      const getInputProps = createGetInputProps(options);

      const provided = {
        onBlur: jest.fn(),
        onChange: jest.fn()
      };
      const { onChange, onBlur } = getInputProps(provided);

      onChange!(fakeEvent);
      expect(provided.onChange).toBeCalledTimes(1);
      expect(provided.onChange).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).toBeCalledTimes(1);

      onBlur!(fakeEvent);
      expect(provided.onBlur).toBeCalledTimes(1);
      expect(provided.onBlur).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).toBeCalledTimes(1);
    });

    it("should not validate when behavior is onSubmit", () => {
      const options: CreateGetInputPropsOptions = {
        name: "some-field",
        defaultValue: "test default value",
        touched: false,
        hasBeenSubmitted: false,
        setTouched: jest.fn(),
        clearError: jest.fn(),
        validate: jest.fn(),
        validationBehavior: {
          initial: "onSubmit"
        }
      };
      const getInputProps = createGetInputProps(options);

      const provided = {
        onBlur: jest.fn(),
        onChange: jest.fn()
      };
      const { onChange, onBlur } = getInputProps(provided);

      onChange!(fakeEvent);
      expect(provided.onChange).toBeCalledTimes(1);
      expect(provided.onChange).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).not.toBeCalled();

      onBlur!(fakeEvent);
      expect(provided.onBlur).toBeCalledTimes(1);
      expect(provided.onBlur).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).not.toBeCalled();
    });
  });

  describe("whenTouched", () => {
    it("should validate on change by default", () => {
      const options: CreateGetInputPropsOptions = {
        name: "some-field",
        defaultValue: "test default value",
        touched: true,
        hasBeenSubmitted: false,
        setTouched: jest.fn(),
        clearError: jest.fn(),
        validate: jest.fn()
      };
      const getInputProps = createGetInputProps(options);

      const provided = {
        onBlur: jest.fn(),
        onChange: jest.fn()
      };
      const { onChange, onBlur } = getInputProps(provided);

      onChange!(fakeEvent);
      expect(provided.onChange).toBeCalledTimes(1);
      expect(provided.onChange).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).toBeCalledTimes(1);

      onBlur!(fakeEvent);
      expect(provided.onBlur).toBeCalledTimes(1);
      expect(provided.onBlur).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).toBeCalledTimes(1);
    });

    it("should respect provided validation behavior", () => {
      const options: CreateGetInputPropsOptions = {
        name: "some-field",
        defaultValue: "test default value",
        touched: true,
        hasBeenSubmitted: false,
        setTouched: jest.fn(),
        clearError: jest.fn(),
        validate: jest.fn(),
        validationBehavior: {
          whenTouched: "onBlur"
        }
      };
      const getInputProps = createGetInputProps(options);

      const provided = {
        onBlur: jest.fn(),
        onChange: jest.fn()
      };
      const { onChange, onBlur } = getInputProps(provided);

      onChange!(fakeEvent);
      expect(provided.onChange).toBeCalledTimes(1);
      expect(provided.onChange).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).not.toBeCalled();

      onBlur!(fakeEvent);
      expect(provided.onBlur).toBeCalledTimes(1);
      expect(provided.onBlur).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).toBeCalledTimes(1);
    });
  });

  describe("whenSubmitted", () => {
    it("should validate on change by default", () => {
      const options: CreateGetInputPropsOptions = {
        name: "some-field",
        defaultValue: "test default value",
        touched: true,
        hasBeenSubmitted: true,
        setTouched: jest.fn(),
        clearError: jest.fn(),
        validate: jest.fn()
      };
      const getInputProps = createGetInputProps(options);

      const provided = {
        onBlur: jest.fn(),
        onChange: jest.fn()
      };
      const { onChange, onBlur } = getInputProps(provided);

      onChange!(fakeEvent);
      expect(provided.onChange).toBeCalledTimes(1);
      expect(provided.onChange).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).toBeCalledTimes(1);

      onBlur!(fakeEvent);
      expect(provided.onBlur).toBeCalledTimes(1);
      expect(provided.onBlur).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).toBeCalledTimes(1);
    });

    it("should respect provided validation behavior", () => {
      const options: CreateGetInputPropsOptions = {
        name: "some-field",
        defaultValue: "test default value",
        touched: true,
        hasBeenSubmitted: true,
        setTouched: jest.fn(),
        clearError: jest.fn(),
        validate: jest.fn(),
        validationBehavior: {
          whenSubmitted: "onBlur"
        }
      };
      const getInputProps = createGetInputProps(options);

      const provided = {
        onBlur: jest.fn(),
        onChange: jest.fn()
      };
      const { onChange, onBlur } = getInputProps(provided);

      onChange!(fakeEvent);
      expect(provided.onChange).toBeCalledTimes(1);
      expect(provided.onChange).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).not.toBeCalled();

      onBlur!(fakeEvent);
      expect(provided.onBlur).toBeCalledTimes(1);
      expect(provided.onBlur).toBeCalledWith(fakeEvent);
      expect(options.setTouched).toBeCalledTimes(1);
      expect(options.setTouched).toBeCalledWith(true);
      expect(options.validate).toBeCalledTimes(1);
    });
  });
});
