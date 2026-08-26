import { describe, expect, it } from "vitest";
import {
  formatParameterValue,
  type OnshapeConfigurationParameter,
  readConfigurationParameters
} from "./configuration";

describe("readConfigurationParameters", () => {
  it("returns an empty list for anything that is not an object", () => {
    expect(readConfigurationParameters(null)).toEqual([]);
    expect(readConfigurationParameters(undefined)).toEqual([]);
    expect(readConfigurationParameters("nope")).toEqual([]);
    expect(readConfigurationParameters(42)).toEqual([]);
  });

  it("returns an empty list when neither field is present or usable", () => {
    expect(readConfigurationParameters({})).toEqual([]);
    expect(readConfigurationParameters([])).toEqual([]);
    expect(
      readConfigurationParameters({ configurationParameters: "nope" })
    ).toEqual([]);
    expect(readConfigurationParameters({ parameters: 7 })).toEqual([]);
  });

  it("reads the api-generator shape (configurationParameters)", () => {
    const response = {
      configurationParameters: [
        {
          parameterType: "ENUM",
          parameterId: "List_sCW2T7xBCmN6an",
          parameterName: "Size",
          defaultValue: "small",
          options: [
            { option: "small", optionName: "Small" },
            { option: "large", optionName: "Large" }
          ]
        }
      ],
      currentConfiguration: []
    };

    const parameters = readConfigurationParameters(response);

    expect(parameters).toHaveLength(1);
    expect(parameters[0]?.parameterId).toBe("List_sCW2T7xBCmN6an");
    expect(parameters[0]?.parameterType).toBe("ENUM");
  });

  it("falls back to the OpenAPI shape (parameters) when configurationParameters is absent", () => {
    const response = {
      isStandardContent: false,
      parameters: [
        {
          parameterType: "BOOLEAN",
          parameterId: "Boolean_xY9",
          parameterName: "Threaded",
          defaultValue: true
        }
      ]
    };

    const parameters = readConfigurationParameters(response);

    expect(parameters).toHaveLength(1);
    expect(parameters[0]?.parameterId).toBe("Boolean_xY9");
  });

  it("prefers configurationParameters when BOTH fields are present", () => {
    const response = {
      configurationParameters: [
        {
          parameterType: "STRING",
          parameterId: "preferred",
          parameterName: "A"
        }
      ],
      parameters: [
        { parameterType: "STRING", parameterId: "ignored", parameterName: "B" }
      ]
    };

    expect(readConfigurationParameters(response)).toHaveLength(1);
    expect(readConfigurationParameters(response)[0]?.parameterId).toBe(
      "preferred"
    );
  });

  it("drops entries missing parameterId or carrying an unknown parameterType", () => {
    const response = {
      configurationParameters: [
        { parameterType: "ENUM", parameterName: "No id", options: [] },
        {
          parameterType: "SOMETHING_NEW",
          parameterId: "unknown",
          parameterName: "New"
        },
        { parameterId: "no-type", parameterName: "No type" },
        null,
        "not an object",
        {
          parameterType: "QUANTITY",
          parameterId: "Quantity_ok",
          parameterName: "Length"
        }
      ]
    };

    const parameters = readConfigurationParameters(response);

    expect(parameters).toHaveLength(1);
    expect(parameters[0]?.parameterId).toBe("Quantity_ok");
  });

  it("keeps all four supported parameter types", () => {
    const response = {
      configurationParameters: [
        {
          parameterType: "ENUM",
          parameterId: "a",
          parameterName: "A",
          options: []
        },
        { parameterType: "BOOLEAN", parameterId: "b", parameterName: "B" },
        { parameterType: "STRING", parameterId: "c", parameterName: "C" },
        { parameterType: "QUANTITY", parameterId: "d", parameterName: "D" }
      ]
    };

    expect(
      readConfigurationParameters(response).map((p) => p.parameterId)
    ).toEqual(["a", "b", "c", "d"]);
  });
});

describe("formatParameterValue", () => {
  const quantity: OnshapeConfigurationParameter = {
    parameterType: "QUANTITY",
    parameterId: "Quantity_len",
    parameterName: "Length",
    rangeAndDefault: {
      minValue: 0,
      maxValue: 1000,
      defaultValue: 500,
      units: "mm"
    }
  };

  it("appends the unit for a QUANTITY that declares one", () => {
    expect(formatParameterValue(quantity, 500)).toBe("500 mm");
  });

  it("omits the unit for a QUANTITY that declares none", () => {
    const unitless: OnshapeConfigurationParameter = {
      parameterType: "QUANTITY",
      parameterId: "Quantity_count",
      parameterName: "Count",
      rangeAndDefault: { defaultValue: 3 }
    };

    expect(formatParameterValue(unitless, 3)).toBe("3");
  });

  it("omits the unit when a QUANTITY has no rangeAndDefault at all", () => {
    const bare: OnshapeConfigurationParameter = {
      parameterType: "QUANTITY",
      parameterId: "Quantity_bare",
      parameterName: "Bare"
    };

    expect(formatParameterValue(bare, 12)).toBe("12");
  });

  it("passes ENUM, BOOLEAN and STRING through as strings", () => {
    const enumParameter: OnshapeConfigurationParameter = {
      parameterType: "ENUM",
      parameterId: "List_a",
      parameterName: "Size",
      options: [{ option: "large", optionName: "Large" }]
    };
    const booleanParameter: OnshapeConfigurationParameter = {
      parameterType: "BOOLEAN",
      parameterId: "Boolean_a",
      parameterName: "Threaded"
    };
    const stringParameter: OnshapeConfigurationParameter = {
      parameterType: "STRING",
      parameterId: "String_a",
      parameterName: "Label"
    };

    expect(formatParameterValue(enumParameter, "large")).toBe("large");
    expect(formatParameterValue(booleanParameter, true)).toBe("true");
    expect(formatParameterValue(booleanParameter, false)).toBe("false");
    expect(formatParameterValue(stringParameter, "ACME")).toBe("ACME");
  });
});
