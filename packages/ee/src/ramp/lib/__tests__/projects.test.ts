import { describe, expect, it } from "vitest";
import {
  buildProjectFieldBody,
  buildProjectOptionsBody,
  diffProjectOptions,
  projectFingerprint,
  type RampProjectMapping,
  type RampProjectOption
} from "../projects";

const remote = (
  id: string,
  rampId: string,
  value: string,
  visibility = "VISIBLE"
) => ({ id, ramp_id: rampId, value, display_name: value, visibility });

const mapping = (
  entityId: string,
  value: string,
  visible: boolean
): RampProjectMapping => ({
  entityId,
  externalId: `ramp-${entityId}`,
  fingerprint: projectFingerprint({ value, visible })
});

describe("buildProjectFieldBody", () => {
  it("creates a splittable single-choice field keyed by carbon-project", () => {
    expect(buildProjectFieldBody("Project")).toEqual({
      id: "carbon-project",
      name: "Project",
      display_name: "Project",
      input_type: "SINGLE_CHOICE",
      is_splittable: true
    });
  });
});

describe("buildProjectOptionsBody", () => {
  it("uses the Carbon project.id as the option external id", () => {
    const options: RampProjectOption[] = [{ id: "prj_a", value: "Apollo" }];
    expect(buildProjectOptionsBody("field-ramp-id", options)).toEqual({
      field_id: "field-ramp-id",
      options: [{ id: "prj_a", value: "Apollo" }]
    });
  });
});

describe("diffProjectOptions", () => {
  it("creates an option that is not in the remote listing", () => {
    const { toCreate, toRename, toShow, toHide } = diffProjectOptions(
      [{ id: "prj_a", value: "Apollo" }],
      [],
      []
    );
    expect(toCreate).toEqual([{ id: "prj_a", value: "Apollo" }]);
    expect(toRename).toEqual([]);
    expect(toShow).toEqual([]);
    expect(toHide).toEqual([]);
  });

  it("is a no-op when the fingerprint is unchanged", () => {
    const result = diffProjectOptions(
      [{ id: "prj_a", value: "Apollo" }],
      [remote("prj_a", "ramp-prj_a", "Apollo")],
      [mapping("prj_a", "Apollo", true)]
    );
    expect(result).toEqual({
      toCreate: [],
      toRename: [],
      toShow: [],
      toHide: []
    });
  });

  it("renames an option whose Carbon name changed since last push", () => {
    const { toRename } = diffProjectOptions(
      [{ id: "prj_a", value: "Apollo II" }],
      [remote("prj_a", "ramp-prj_a", "Apollo")],
      [mapping("prj_a", "Apollo", true)]
    );
    expect(toRename).toEqual([
      { option: { id: "prj_a", value: "Apollo II" }, rampId: "ramp-prj_a" }
    ]);
  });

  it("HIDES an option that fell out of Carbon's active set (soft-delete)", () => {
    const { toHide } = diffProjectOptions(
      [],
      [remote("prj_a", "ramp-prj_a", "Apollo")],
      [mapping("prj_a", "Apollo", true)]
    );
    expect(toHide).toEqual([
      { id: "prj_a", value: "Apollo", rampId: "ramp-prj_a" }
    ]);
  });

  it("re-shows a restored option that Carbon last hid", () => {
    const { toShow } = diffProjectOptions(
      [{ id: "prj_a", value: "Apollo" }],
      [remote("prj_a", "ramp-prj_a", "Apollo", "HIDDEN")],
      [mapping("prj_a", "Apollo", false)]
    );
    expect(toShow).toEqual([
      { option: { id: "prj_a", value: "Apollo" }, rampId: "ramp-prj_a" }
    ]);
  });

  it("does not re-hide an option already hidden remotely", () => {
    const { toHide } = diffProjectOptions(
      [],
      [remote("prj_a", "ramp-prj_a", "Apollo", "HIDDEN")],
      [mapping("prj_a", "Apollo", false)]
    );
    expect(toHide).toEqual([]);
  });
});
