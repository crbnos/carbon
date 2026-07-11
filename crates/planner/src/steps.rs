//! `plan_step`: STEP file -> plan.json (version 3) — ties the converter (OCCT
//! assembly tree) to the planner and emits the wire format.

use crate::consts::mesh_tolerance;
use crate::pipeline2::{merge_units, plan_fixed_sequence, plan_parts, GroupPayload, PlanOutcome};
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

/// `_part_to_dict`.
fn part_to_dict(entry: &PlannedComponent) -> Value {
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

    // Expand merged units back to member leaves.
    let mut groups: Map<String, Value> = outcome
        .groups
        .iter()
        .map(|(k, v)| (k.clone(), group_to_json(v)))
        .collect();
    let mut components: Map<String, Value> = Map::new();
    for entry in &outcome.planned {
        match expansion.get(&entry.node_id) {
            None => {
                components.insert(entry.node_id.clone(), part_to_dict(entry));
            }
            Some((members, name)) => {
                let mut member_payload = part_to_dict(entry);
                member_payload["groupId"] = json!(entry.node_id);
                for member in members {
                    components.insert(member.clone(), member_payload.clone());
                }
                let mut gp = Map::new();
                gp.insert("componentNodeIds".into(), json!(members));
                gp.insert("motion".into(), motion_to_json(&entry.motion));
                if let Some(n) = name {
                    gp.insert("name".into(), json!(n));
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
    // Diagnostics: unit adjacency for sequencing analysis (not part of the
    // plan contract; consumers must not rely on it).
    if std::env::var("ASSEMBLER_EMIT_ADJACENCY").is_ok() {
        plan["debugAdjacency"] = json!(outcome
            .adjacency
            .iter()
            .map(|(k, v)| (k.clone(), v.iter().cloned().collect::<Vec<_>>()))
            .collect::<std::collections::BTreeMap<_, _>>());
    }

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
