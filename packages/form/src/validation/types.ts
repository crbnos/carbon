export type FieldErrors = Record<string, string>;

export type TouchedFields = Record<string, boolean>;

export type GenericObject = { [key: string]: any };

export type ValidatorError = {
  subaction?: string;
  formId?: string;
  fieldErrors: FieldErrors;
};

export type ValidationErrorResponseData = {
  subaction?: string;
  formId?: string;
  fieldErrors: FieldErrors;
  repopulateFields?: unknown;
};

export type BaseResult = { submittedData: GenericObject; formId?: string };
export type ErrorResult = BaseResult & {
  error: ValidatorError;
  data: undefined;
};
export type SuccessResult<DataType> = BaseResult & {
  data: DataType;
  error: undefined;
};

/**
 * The result when validating a form.
 */
export type ValidationResult<DataType> = SuccessResult<DataType> | ErrorResult;

/**
 * The result when validating an individual field in a form.
 */
export type ValidateFieldResult = { error?: string };

/**
 * A `Validator` can be passed to the `validator` prop of a `ValidatedForm`.
 */
export type Validator<DataType> = {
  validate: (
    unvalidatedData: GenericObject
  ) => Promise<ValidationResult<DataType>>;
  /**
   * @deprecated Will be removed in a future version of remix-validated-form
   */
  validateField?: (
    unvalidatedData: GenericObject,
    field: string
  ) => Promise<ValidateFieldResult>;
};

export type Valid<DataType> = { data: DataType; error: undefined };
export type Invalid = { error: FieldErrors; data: undefined };
export type CreateValidatorArg<DataType> = {
  validate: (
    unvalidatedData: GenericObject
  ) => Promise<Valid<DataType> | Invalid>;
  validateField: (
    unvalidatedData: GenericObject,
    field: string
  ) => Promise<ValidateFieldResult>;
};

export type ValidatorData<T extends Validator<any>> = T extends Validator<
  infer U
>
  ? U
  : never;
