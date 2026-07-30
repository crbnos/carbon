//! `plan_step`: STEP file -> plan.json (version 3) — ties the converter (OCCT
//! assembly tree) to the planner and emits the wire format.

use crate::consts::mesh_tolerance;
use crate::pipeline2::{
    detect_swarm_units, merge_units, plan_fixed_sequence, plan_parts, GroupPayload, PlanOutcome,
};
use crate::types::{Component, Mesh, Motion, PlannedComponent};
use converter::convert::{build_tree, ConvertError};
use converter::graph::AssemblyNode;
use nalgebra::Vector3;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

pub const PLAN_VERSION: i64 = 3;

pub struct PlanResult {
    pub plan: Value,
    pub component_count: i64,
    pub planned_count: i64,
    pub tiers: std::collections::BTreeMap<String, i64>,
    pub warnings: Vec<String>,
    pub verified_count: i64,
}

/// `_collect_world_parts`: flatten leaves into world-space collision components.
pub fn collect_world_parts(root: &AssemblyNode) -> Vec<Component> {
    let mut parts = Vec::new();
    let identity: [f64; 16] = [
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];
    visit(root, &identity, &mut parts);
    parts
}

fn visit(node: &AssemblyNode, parent_world: &[f64; 16], parts: &mut Vec<Component>) {
    // numpy-exact: `local = transform.reshape(4,4).T` (column-major list -> row-major
    // matrix), `world = parent_world @ local` via BLAS dgemm, and
    // `positions @ world[:3,:3].T + world[:3,3]` via dgemm — matching
    // `_collect_world_parts` bit-for-bit.
    let mut local = [0.0f64; 16];
    for i in 0..4 {
        for j in 0..4 {
            local[i * 4 + j] = node.transform[j * 4 + i];
        }
    }
    let world = crate::npy::mat4_matmul(parent_world, &local);
    if let Some(mesh) = &node.mesh {
        if !mesh.positions.is_empty() {
            let mut r = [0.0f64; 9];
            for i in 0..3 {
                for j in 0..3 {
                    r[i * 3 + j] = world[i * 4 + j];
                }
            }
            let t = [world[3], world[7], world[11]];
            let flat: Vec<f64> = mesh
                .positions
                .iter()
                .flat_map(|p| [p[0] as f64, p[1] as f64, p[2] as f64])
                .collect();
            let out = crate::npy::transform_points(&flat, &r, &t);
            let vertices: Vec<Vector3<f64>> = out
                .chunks_exact(3)
                .map(|c| Vector3::new(c[0], c[1], c[2]))
                .collect();
            let faces = mesh.indices.clone();
            let m = Mesh { vertices, faces };
            let (lo, hi) = m.bbox();
            parts.push(Component::new(
                node.node_id.clone(),
                node.name.clone(),
                m,
                lo,
                hi,
                mesh.is_proxy,
            ));
        }
    }
    for child in &node.children {
        visit(child, &world, parts);
    }
}

fn motion_to_json(m: &Motion) -> Value {
    match m {
        Motion::None => json!({"type": "none"}),
        Motion::Linear {
            direction,
            distance,
        } => {
            json!({"type": "linear", "direction": direction.to_vec(), "distance": distance})
        }
        Motion::L { segments } => {
            let segs: Vec<Value> = segments
                .iter()
                .map(|s| json!({"direction": s.direction.to_vec(), "distance": s.distance}))
                .collect();
            json!({"type": "L", "segments": segs})
        }
    }
}

/// `_part_to_dict`. `needs_support` is the set of leaf ids flagged tippy by the
/// stability check; a member's own id (not the group rep's) decides its flag.
/// `waves` maps a unit/rep id to its build wave — group members share the rep's.
fn part_to_dict(
    entry: &PlannedComponent,
    needs_support: &HashSet<String>,
    waves: &HashMap<String, i64>,
) -> Value {
    let mut m = Map::new();
    m.insert("motion".into(), motion_to_json(&entry.motion));
    if let Some(c) = &entry.confidence {
        m.insert("confidence".into(), json!(c));
    }
    if let Some(d) = &entry.removal_direction {
        m.insert("removalDirection".into(), json!(d.to_vec()));
    }
    if !entry.blocked_by.is_empty() {
        m.insert("blockedBy".into(), json!(entry.blocked_by));
    }
    if let Some(t) = &entry.tier {
        m.insert("tier".into(), json!(t));
    }
    if let Some(g) = &entry.group_id {
        m.insert("groupId".into(), json!(g));
    }
    if needs_support.contains(&entry.node_id) {
        m.insert("needsSupport".into(), json!(true));
    }
    if let Some(w) = waves.get(&entry.node_id) {
        m.insert("wave".into(), json!(w));
    }
    m.insert("verified".into(), json!(entry.verified));
    Value::Object(m)
}

fn group_to_json(g: &GroupPayload) -> Value {
    let mut m = Map::new();
    m.insert("componentNodeIds".into(), json!(g.component_node_ids));
    m.insert("motion".into(), motion_to_json(&g.motion));
    if let Some(n) = &g.name {
        m.insert("name".into(), json!(n));
    }
    Value::Object(m)
}

/// Union AABB of every planned body (the standing camera framing bounds).
fn assembly_bounds(parts: &[Component]) -> (Vector3<f64>, Vector3<f64>) {
    let mut min = Vector3::repeat(f64::INFINITY);
    let mut max = Vector3::repeat(f64::NEG_INFINITY);
    for part in parts {
        min = min.inf(&part.bbox_min);
        max = max.sup(&part.bbox_max);
    }
    if !min.x.is_finite() {
        return (Vector3::zeros(), Vector3::zeros());
    }
    (min, max)
}

/// One caller unit: id, optional name, member nodeIds.
pub struct PlanUnit {
    pub id: String,
    pub name: Option<String>,
    pub node_ids: Vec<String>,
}

#[allow(clippy::too_many_arguments)]
pub fn plan_step(
    step_path: &str,
    linear_deflection: f64,
    angular_deflection: f64,
    clearance: f64,
    path_samples: usize,
    max_parts: Option<usize>,
    units: Option<Vec<PlanUnit>>,
    sequence: Option<Vec<Vec<String>>>,
    // Penetration tolerance override (mm). None => inferred from the meshing
    // deflection via `mesh_tolerance` (max(0.15, 2.5 * linear_deflection)) --
    // the tolerance must scale with tessellation error or clean seated
    // contacts read as collisions. Explicit values are honored as-is.
    tolerance: Option<f64>,
) -> Result<PlanResult, ConvertError> {
    let root = build_tree(step_path, linear_deflection, angular_deflection)?;
    let mut parts = collect_world_parts(&root);
    let leaf_count = parts.len() as i64;

    // Caller units → merged bodies (expansion maps unit id → members).
    let mut expansion: HashMap<String, (Vec<String>, Option<String>)> = HashMap::new();
    if let (Some(units), None) = (&units, &sequence) {
        let spec: Vec<(String, Option<String>, Vec<String>)> = units
            .iter()
            .map(|u| (u.id.clone(), u.name.clone(), u.node_ids.clone()))
            .collect();
        let (merged, exp) = merge_units(&parts, &spec);
        parts = merged;
        expansion = exp;
    }

    // Auto-detect detail swarms (populated PCBs) from pure geometry so a
    // 400-component board plans as one rigid unit even with no caller units
    // (no BOM, no LLM assignment). Runs after caller units (their merged
    // bodies are never re-swallowed) and never in fixed-sequence re-motion
    // (the sequence references the existing step structure).
    if sequence.is_none() {
        let consumed: HashSet<String> = expansion.keys().cloned().collect();
        let spec = detect_swarm_units(&parts, &consumed);
        if !spec.is_empty() {
            let (merged, exp) = merge_units(&parts, &spec);
            parts = merged;
            expansion.extend(exp);
        }
    }

    let planned_body_count = sequence.as_ref().map(|s| s.len()).unwrap_or(parts.len());
    if let Some(mp) = max_parts {
        if planned_body_count > mp {
            return Err(ConvertError::new(
                "LIMIT_EXCEEDED",
                format!("assembly has {planned_body_count} part instances; the limit is {mp}"),
            ));
        }
    }

    let mut warnings: Vec<String> = Vec::new();
    if parts.iter().any(|p| p.is_proxy) {
        warnings.push(
            "some parts use bounding-box proxy meshes; their motions are low confidence".into(),
        );
    }

    let tolerance = tolerance.unwrap_or_else(|| mesh_tolerance(linear_deflection));
    // The planner consumes `parts`; keep the merged bodies (meshes + bounds)
    // for the per-step view-direction rays afterward. FCL BVHs are Arc-shared
    // across clones, so this is a mesh-buffer copy only.
    let view_parts: Vec<Component> = parts.clone();
    let outcome: PlanOutcome = if let Some(seq) = &sequence {
        plan_fixed_sequence(
            parts,
            seq,
            clearance,
            path_samples,
            tolerance,
            &mut warnings,
        )
    } else {
        let protected: HashSet<String> = expansion.keys().cloned().collect();
        let prot = if protected.is_empty() {
            None
        } else {
            Some(&protected)
        };
        plan_parts(
            parts,
            clearance,
            path_samples,
            tolerance,
            prot,
            &mut warnings,
        )
    };

    // Mesh-precise view direction per planned body: sight lines against the
    // triangles of everything installed earlier in the sequence. Keyed in the
    // pre-expansion (merged-body) space, same as `outcome.sequence`.
    let view: HashMap<String, ([f64; 3], f64)> = {
        let view_start = std::time::Instant::now();
        let by_id: HashMap<&str, &Component> =
            view_parts.iter().map(|p| (p.node_id.as_str(), p)).collect();
        let motion_by_id: HashMap<&str, &Motion> = outcome
            .planned
            .iter()
            .map(|e| (e.node_id.as_str(), &e.motion))
            .collect();
        let (assembly_min, assembly_max) = assembly_bounds(&view_parts);
        // Bodies not yet installed when this step plays. They're hidden/ghosted
        // during playback, so they score at a low weight — but a direction that
        // also clears them survives the viewer's "show all future parts" toggle.
        let mut future_ids: HashSet<&str> = view_parts.iter().map(|p| p.node_id.as_str()).collect();
        let mut installed: Vec<&Component> = Vec::with_capacity(view_parts.len());
        let mut out = HashMap::new();
        let mut worst: (f64, &str) = (0.0, "");
        for node_id in &outcome.sequence {
            let Some(subject) = by_id.get(node_id.as_str()) else {
                continue;
            };
            future_ids.remove(node_id.as_str());
            let motion = motion_by_id
                .get(node_id.as_str())
                .copied()
                .unwrap_or(&Motion::None);
            let future: Vec<&Component> = future_ids
                .iter()
                .filter_map(|id| by_id.get(id).copied())
                .collect();
            let (direction, obstruction) = crate::view::best_view_direction(
                subject,
                motion,
                &installed,
                &future,
                &assembly_min,
                &assembly_max,
            );
            if obstruction > worst.0 {
                worst = (obstruction, node_id.as_str());
            }
            out.insert(node_id.clone(), (direction, obstruction));
            installed.push(subject);
        }
        eprintln!(
            "view: {} bodies in {:?}; worst obstruction {:.2} ({})",
            out.len(),
            view_start.elapsed(),
            worst.0,
            worst.1
        );
        out
    };

    // Expand merged units back to member leaves.
    let mut groups: Map<String, Value> = outcome
        .groups
        .iter()
        .map(|(k, v)| {
            let mut payload = group_to_json(v);
            if let Some((d, obstruction)) = view.get(k) {
                payload["viewDirection"] = json!(d.to_vec());
                payload["viewObstruction"] = json!(obstruction);
            }
            (k.clone(), payload)
        })
        .collect();
    let mut components: Map<String, Value> = Map::new();
    for entry in &outcome.planned {
        let view_entry = view.get(&entry.node_id);
        match expansion.get(&entry.node_id) {
            None => {
                let mut payload = part_to_dict(entry, &outcome.needs_support, &outcome.waves);
                if let Some((d, obstruction)) = view_entry {
                    payload["viewDirection"] = json!(d.to_vec());
                    payload["viewObstruction"] = json!(obstruction);
                }
                components.insert(entry.node_id.clone(), payload);
            }
            Some((members, name)) => {
                let mut member_payload =
                    part_to_dict(entry, &outcome.needs_support, &outcome.waves);
                member_payload["groupId"] = json!(entry.node_id);
                for member in members {
                    // needsSupport is per leaf, not per group rep.
                    let mut mp = member_payload.clone();
                    if outcome.needs_support.contains(member) {
                        mp["needsSupport"] = json!(true);
                    } else if let Some(obj) = mp.as_object_mut() {
                        obj.remove("needsSupport");
                    }
                    components.insert(member.clone(), mp);
                }
                let mut gp = Map::new();
                gp.insert("componentNodeIds".into(), json!(members));
                gp.insert("motion".into(), motion_to_json(&entry.motion));
                if let Some(n) = name {
                    gp.insert("name".into(), json!(n));
                }
                if let Some((d, obstruction)) = view_entry {
                    gp.insert("viewDirection".into(), json!(d.to_vec()));
                    gp.insert("viewObstruction".into(), json!(obstruction));
                }
                groups.insert(entry.node_id.clone(), Value::Object(gp));
            }
        }
    }
    for (member, rep) in &outcome.merged_into {
        components.insert(
            member.clone(),
            json!({"motion": {"type": "none"}, "mergedInto": rep}),
        );
    }

    let mut sequence_out: Vec<String> = Vec::new();
    for node_id in &outcome.sequence {
        match expansion.get(node_id) {
            None => sequence_out.push(node_id.clone()),
            Some((members, _)) => sequence_out.extend(members.iter().cloned()),
        }
    }

    let mut plan = json!({
        "version": PLAN_VERSION,
        "unit": "mm",
        "sequence": sequence_out,
        "components": Value::Object(components),
        "warnings": warnings.clone(),
    });
    if !groups.is_empty() {
        plan["groups"] = Value::Object(groups);
    }
    // Body-level relatedness graph (planned-body node_id -> related bodies): the
    // strict contact graph augmented with clearance-fit neighbors (fasteners and
    // slip-fits that hold parts together across a gap strict contact can't see),
    // so the viewer relates a placed part to the assembly instead of rendering it
    // as a floating island. Used by the step grouping's floater fold + phase
    // partition. Keys are in the pre-expansion body space, matching a member's
    // `components[member].groupId ?? member`. Deterministic ordering. Falls back
    // to strict adjacency when relatedness is unavailable (fixed-sequence mode).
    let contact_graph = if outcome.relatedness.is_empty() {
        &outcome.adjacency
    } else {
        &outcome.relatedness
    };
    plan["contacts"] = json!(contact_graph
        .iter()
        .map(|(k, v)| {
            let mut neighbors: Vec<_> = v.iter().cloned().collect();
            neighbors.sort(); // HashSet order is run-nondeterministic
            (k.clone(), neighbors)
        })
        .collect::<std::collections::BTreeMap<_, _>>());

    let planned_count = outcome
        .planned
        .iter()
        .filter(|e| !matches!(e.motion, Motion::None))
        .count() as i64;

    Ok(PlanResult {
        plan,
        component_count: leaf_count,
        planned_count,
        tiers: outcome.tiers,
        warnings,
        verified_count: outcome.verified_count,
    })
}
