"""Capture planner inputs+outputs from the real test run into a corpus.

Env-gated (``GEOMETRY_CAPTURE_DIR``): when set, wraps the planner entry points
(`_plan_parts`, `_plan_fixed_sequence`, `_greedy_disassembly`) so every OUTERMOST
call the existing pytest suite makes is serialized — the exact component meshes
(world-space vertices + faces), the call parameters, and the Python outcome — to
one JSON file per invocation.

This is the backbone of the Rust shadow harness: the Rust planner replays each
captured case over byte-identical geometry and must reproduce the captured outcome.
No manual transcription of test semantics — the corpus IS the existing tests.

Cases where a test monkeypatched a planner internal (e.g. stubbing `_plan_removal`
to None) are tagged ``monkeypatched: true`` so the Rust replay skips them — Rust
cannot reproduce an arbitrary Python monkeypatch.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


def _component_to_dict(part) -> dict:
    mesh = part.mesh
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    return {
        "nodeId": part.node_id,
        "name": part.name,
        "isProxy": bool(part.is_proxy),
        "vertices": vertices.reshape(-1).tolist(),
        "faces": faces.reshape(-1).tolist(),
        "vertexCount": int(vertices.shape[0]),
        "faceCount": int(faces.shape[0]),
    }


def _planned_to_dict(entry) -> dict:
    return {
        "nodeId": entry.node_id,
        "motion": entry.motion,
        "confidence": entry.confidence,
        "removalDirection": entry.removal_direction,
        "blockedBy": list(entry.blocked_by),
        "tier": entry.tier,
        "verified": bool(entry.verified),
        "groupId": entry.group_id,
    }


def _outcome_to_dict(outcome) -> dict:
    return {
        "sequence": list(outcome.sequence),
        "tiers": dict(outcome.tiers),
        "mergedInto": dict(outcome.merged_into),
        "groups": dict(outcome.groups),
        "verifiedCount": int(outcome.verified_count),
        "planned": [_planned_to_dict(e) for e in outcome.planned],
    }


class _Recorder:
    def __init__(self, directory: Path) -> None:
        self.dir = directory
        self.dir.mkdir(parents=True, exist_ok=True)
        self.counter = 0
        self.depth = 0  # reentrancy guard: only capture the outermost call

    def write(self, kind: str, parts, params: dict, result: dict, monkeypatched: bool) -> None:
        self.counter += 1
        case = {
            "kind": kind,
            "index": self.counter,
            "monkeypatched": monkeypatched,
            "params": params,
            "components": [_component_to_dict(p) for p in parts],
            "result": result,
        }
        name = f"{self.counter:04d}-{kind}.json"
        (self.dir / name).write_text(json.dumps(case))


def install(directory: Path) -> None:
    import app.plan as plan

    recorder = _Recorder(directory)

    orig_plan_parts = plan._plan_parts
    orig_fixed = plan._plan_fixed_sequence
    orig_greedy = plan._greedy_disassembly
    # Identity refs to detect a test's monkeypatch of a planner internal.
    pristine = {
        "_plan_removal": plan._plan_removal,
        "_plan_escape": plan._plan_escape,
        "_plan_group_removal": plan._plan_group_removal,
    }

    def patched() -> bool:
        return any(getattr(plan, name) is not ref for name, ref in pristine.items())

    def wrapped_plan_parts(parts, trimesh_mod, *args, **kwargs):
        recorder.depth += 1
        try:
            outcome = orig_plan_parts(parts, trimesh_mod, *args, **kwargs)
        finally:
            recorder.depth -= 1
        if recorder.depth == 0:
            params = {
                "clearance": kwargs.get("clearance"),
                "pathSamples": kwargs.get("path_samples"),
                "tolerance": kwargs.get("tolerance"),
                "protected": sorted(kwargs.get("protected") or []),
            }
            recorder.write("plan_parts", parts, params, _outcome_to_dict(outcome), patched())
        return outcome

    def wrapped_fixed(parts, groups_in_order, trimesh_mod, *args, **kwargs):
        recorder.depth += 1
        try:
            outcome = orig_fixed(parts, groups_in_order, trimesh_mod, *args, **kwargs)
        finally:
            recorder.depth -= 1
        if recorder.depth == 0:
            params = {
                "groups": [list(g) for g in groups_in_order],
                "clearance": kwargs.get("clearance"),
                "pathSamples": kwargs.get("path_samples"),
                "tolerance": kwargs.get("tolerance"),
            }
            recorder.write("fixed_sequence", parts, params, _outcome_to_dict(outcome), patched())
        return outcome

    def wrapped_greedy(parts, trimesh_mod, *args, **kwargs):
        capture = recorder.depth == 0  # direct test call, not nested in _plan_parts
        recorder.depth += 1
        try:
            planned, sequence, tiers = orig_greedy(parts, trimesh_mod, *args, **kwargs)
        finally:
            recorder.depth -= 1
        if capture:
            params = {
                "clearance": kwargs.get("clearance"),
                "pathSamples": kwargs.get("path_samples"),
                "tolerance": kwargs.get("tolerance"),
            }
            result = {
                "sequence": list(sequence),
                "tiers": dict(tiers),
                "planned": [_planned_to_dict(e) for e in planned],
            }
            recorder.write("greedy", parts, params, result, patched())
        return planned, sequence, tiers

    plan._plan_parts = wrapped_plan_parts
    plan._plan_fixed_sequence = wrapped_fixed
    plan._greedy_disassembly = wrapped_greedy
