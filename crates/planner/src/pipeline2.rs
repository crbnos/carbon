//! Ordering pipeline, part 2: precedence DAG, joint/sandwich/support edges,
//! base reselection, preference topo sort, connectivity repair, forward
//! verification, and the `plan_parts` / `plan_fixed_sequence` drivers.

#[allow(unused_imports)]
use crate::collide::*;
use crate::collide::{CollisionWorld, Exempt};
use crate::consts::*;
use crate::fasteners::head_direction;
use crate::geom::*;
use crate::greedy::{greedy_disassembly, new_tiers, plan_escape, plan_removal, Tiers};
use crate::pipeline::*;
use crate::types::{Component, FastenerInfo, FastenerKind, Motion, PlannedComponent};
use nalgebra::Vector3;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

type Edges = HashMap<String, HashSet<String>>;

#[derive(Clone)]
pub struct GroupPayload {
    pub component_node_ids: Vec<String>,
    pub motion: Motion,
    pub name: Option<String>,
}

pub struct PlanOutcome {
    pub planned: Vec<PlannedComponent>,
    pub sequence: Vec<String>,
    pub tiers: Tiers,
    pub merged_into: HashMap<String, String>,
    pub groups: BTreeMap<String, GroupPayload>,
    pub verified_count: i64,
    pub edges: Edges,
    pub adjacency: Edges,
    /// Proximity-based "related parts" graph (strict `adjacency` augmented with
    /// clearance-fit neighbors, see `relatedness_mm`). Drives the sequencing
    /// connectivity preference and the emitted viewer contact graph. Strict
    /// `adjacency` still governs base selection and collision correctness.
    pub relatedness: Edges,
    /// Leaf node ids whose center of mass falls outside the support polygon of
    /// the parts placed below them (support-polygon check, `stability.rs`).
    /// Purely diagnostic — surfaced per step as `needsSupport`.
    pub needs_support: HashSet<String>,
    /// Unit id → build wave (longest-path level in the precedence DAG). Units
    /// sharing a wave have no ordering constraint and can be built in parallel.
    /// Cycle-affected units are absent. Purely additive; the linear `sequence`
    /// is unchanged.
    pub waves: HashMap<String, i64>,
}

/// `_removal_segments`: a stored INSERTION motion as removal segments.
fn removal_segments(motion: &Motion) -> Option<Vec<(Vector3<f64>, f64)>> {
    match motion {
        Motion::Linear {
            direction,
            distance,
        } => {
            let d = Vector3::new(-direction[0], -direction[1], -direction[2]);
            let n = d.norm();
            let n = if n == 0.0 { 1.0 } else { n };
            Some(vec![(d / n, *distance)])
        }
        Motion::L { segments } => {
            let mut out = Vec::new();
            for seg in segments.iter().rev() {
                let d = Vector3::new(-seg.direction[0], -seg.direction[1], -seg.direction[2]);
                let n = d.norm();
                let n = if n == 0.0 { 1.0 } else { n };
                out.push((d / n, seg.distance));
            }
            Some(out)
        }
        Motion::None => None,
    }
}

fn others_excluding<'a>(
    units_by_id: &'a HashMap<String, Component>,
    id: &str,
) -> Vec<&'a Component> {
    units_by_id.values().filter(|c| c.node_id != id).collect()
}

/// `_derive_precedence`: U → X where X's seated body blocks U's insertion path.
fn derive_precedence(
    planned: &[PlannedComponent],
    units_by_id: &HashMap<String, Component>,
    fasteners: &HashMap<String, FastenerInfo>,
    path_samples: usize,
    tolerance: f64,
) -> Edges {
    let samples_segment = (path_samples / 3).max(12);
    let units: Vec<&Component> = units_by_id.values().collect();
    let world = CollisionWorld::new(&units);
    let mut edges: Edges = planned
        .iter()
        .map(|e| (e.node_id.clone(), HashSet::new()))
        .collect();
    for entry in planned {
        let segments = match removal_segments(&entry.motion) {
            Some(s) => s,
            None => continue,
        };
        let part = &units_by_id[&entry.node_id];
        let mut extra: Exempt = HashMap::new();
        extra.insert(part.node_id.clone(), f64::INFINITY);
        let blockers = path_blockers(
            part,
            &world,
            &segments,
            samples_segment,
            fasteners,
            Some(&extra),
            tolerance,
        );
        edges.get_mut(&entry.node_id).unwrap().extend(blockers);
    }
    edges
}

/// Longest-path level of each unit in the hard-precedence DAG (`edges[before] =
/// {after}`): 0 for units with no predecessor, else `1 + max(predecessor wave)`.
/// Units sharing a wave have no ordering constraint between them — the parallel-
/// buildable group. Deterministic (sorted traversal). Units on a precedence
/// cycle are omitted (→ no wave; the consumer shows them strictly sequential).
pub fn compute_waves(edges: &Edges) -> HashMap<String, i64> {
    let mut indegree: HashMap<&str, usize> = edges.keys().map(|k| (k.as_str(), 0usize)).collect();
    for afters in edges.values() {
        for after in afters {
            *indegree.entry(after.as_str()).or_insert(0) += 1;
        }
    }
    let mut wave: HashMap<String, i64> = HashMap::new();
    let mut roots: Vec<&str> = indegree
        .iter()
        .filter(|(_, &d)| d == 0)
        .map(|(&n, _)| n)
        .collect();
    roots.sort();
    let mut queue: std::collections::VecDeque<&str> = roots.into_iter().collect();
    for &n in &queue {
        wave.insert(n.to_string(), 0);
    }
    while let Some(n) = queue.pop_front() {
        let wn = wave[n];
        let Some(afters) = edges.get(n) else {
            continue;
        };
        let mut sorted: Vec<&str> = afters.iter().map(|s| s.as_str()).collect();
        sorted.sort();
        for after in sorted {
            let w = wave.get(after).copied().unwrap_or(-1).max(wn + 1);
            wave.insert(after.to_string(), w);
            if let Some(d) = indegree.get_mut(after) {
                *d -= 1;
                if *d == 0 {
                    queue.push_back(after);
                }
            }
        }
    }
    // Any unit still with unresolved predecessors sits on a cycle — it can't be
    // leveled, so drop its partial wave.
    for (n, &d) in &indegree {
        if d > 0 {
            wave.remove(*n);
        }
    }
    wave
}

fn reaches(edges: &Edges, source: &str, target: &str) -> bool {
    let mut stack = vec![source.to_string()];
    let mut seen = HashSet::new();
    while let Some(node) = stack.pop() {
        if node == target {
            return true;
        }
        if !seen.insert(node.clone()) {
            continue;
        }
        if let Some(next) = edges.get(&node) {
            stack.extend(next.iter().cloned());
        }
    }
    false
}

/// `_add_joint_edges`.
fn add_joint_edges(
    fasteners: &HashMap<String, FastenerInfo>,
    joints: &HashMap<String, HashMap<String, f64>>,
    units_by_id: &HashMap<String, Component>,
    edges: &mut Edges,
    warnings: &mut Vec<String>,
) {
    let add_edge = |edges: &mut Edges,
                    warnings: &mut Vec<String>,
                    before: &str,
                    after: &str,
                    label: &str| {
        if edges
            .get(before)
            .map(|s| s.contains(after))
            .unwrap_or(false)
        {
            return;
        }
        if reaches(edges, after, before) {
            warnings.push(format!(
                "{label} preference between '{before}' and '{after}' conflicts with collision constraints; skipped"
            ));
            return;
        }
        edges.get_mut(before).unwrap().insert(after.to_string());
    };

    // Deterministic fastener iteration.
    let mut fids: Vec<&String> = fasteners.keys().collect();
    fids.sort();
    for fastener_id in fids {
        if !edges.contains_key(fastener_id) {
            continue;
        }
        let info = &fasteners[fastener_id];
        let empty = HashMap::new();
        let joint = joints.get(fastener_id).unwrap_or(&empty);
        let mut chain: Vec<String> = Vec::new();
        let mut members: Vec<&String> = joint.keys().collect();
        members.sort();
        for member in members {
            if !edges.contains_key(member) {
                continue;
            }
            let member_info = fasteners.get(member);
            let is_rod_disc_mate = info.mates.contains_key(member)
                && member_info
                    .map(|mi| mi.kind == Some(FastenerKind::Disc))
                    .unwrap_or(false)
                && info.kind == Some(FastenerKind::Rod);
            if is_rod_disc_mate {
                add_edge(edges, warnings, fastener_id, member, "joint-order");
            } else {
                add_edge(edges, warnings, member, fastener_id, "joint-order");
                chain.push(member.clone());
            }
        }

        let fastener_part = match units_by_id.get(fastener_id) {
            Some(p) => p,
            None => continue,
        };
        if chain.len() < 2 {
            continue;
        }
        let head_dir = head_direction(fastener_part, info, Some(units_by_id));
        let sign = if head_dir.dot(&info.axis) >= 0.0 {
            1.0
        } else {
            -1.0
        };
        let head_projection = |member: &str| sign * joint.get(member).cloned().unwrap_or(0.0);
        chain.sort_by(|a, b| {
            head_projection(a)
                .partial_cmp(&head_projection(b))
                .unwrap()
                .then(a.cmp(b))
        });
        for w in chain.windows(2) {
            let (tip_side, head_side) = (&w[0], &w[1]);
            if (head_projection(head_side) - head_projection(tip_side)).abs() < 0.5 {
                continue;
            }
            add_edge(edges, warnings, tip_side, head_side, "joint-stack");
        }
    }
}

/// `_add_sandwich_edges` (soft).
fn add_sandwich_edges(
    sandwiches: &HashMap<String, SandwichInfo>,
    units_by_id: &HashMap<String, Component>,
    merged_into: &HashMap<String, String>,
    edges: &mut Edges,
    warnings: &mut Vec<String>,
) {
    let add_edge = |edges: &mut Edges, warnings: &mut Vec<String>, before: &str, after: &str| {
        if edges
            .get(before)
            .map(|s| s.contains(after))
            .unwrap_or(false)
        {
            return;
        }
        if reaches(edges, after, before) {
            warnings.push(format!(
                "sandwich preference between '{before}' and '{after}' conflicts with collision constraints; skipped"
            ));
            return;
        }
        edges.get_mut(before).unwrap().insert(after.to_string());
    };
    let mut node_ids: Vec<&String> = sandwiches.keys().collect();
    node_ids.sort();
    for node_id in node_ids {
        if !edges.contains_key(node_id) {
            continue;
        }
        let info = &sandwiches[node_id];
        let resolve = |side: &HashSet<String>| -> BTreeSet<String> {
            side.iter()
                .map(|o| merged_into.get(o).cloned().unwrap_or_else(|| o.clone()))
                .filter(|u| edges.contains_key(u) && u != node_id)
                .collect()
        };
        let side_a = resolve(&info.side_a);
        let side_b = resolve(&info.side_b);
        if side_a.is_empty() || side_b.is_empty() {
            continue;
        }
        let side_volume = |side: &BTreeSet<String>| -> f64 {
            side.iter().map(|o| part_volume(&units_by_id[o])).sum()
        };
        let va = side_volume(&side_a);
        let vb = side_volume(&side_b);
        if va.max(vb) <= 0.0 {
            continue;
        }
        if (va - vb).abs() < 0.05 * va.max(vb) {
            warnings.push(format!(
                "sandwiched part '{node_id}' has near-equal sides; no ordering preference added"
            ));
            continue;
        }
        let (first, second) = if va > vb {
            (&side_a, &side_b)
        } else {
            (&side_b, &side_a)
        };
        for o in first {
            add_edge(edges, warnings, o, node_id);
        }
        for o in second {
            add_edge(edges, warnings, node_id, o);
        }
    }
}

/// `_add_support_edges` (soft).
fn add_support_edges(
    parts: &[Component],
    pair_depths: &PairDepths,
    fasteners: &HashMap<String, FastenerInfo>,
    merged_into: &HashMap<String, String>,
    edges: &mut Edges,
    warnings: &mut Vec<String>,
) {
    let by_id: HashMap<&str, &Component> = parts.iter().map(|p| (p.node_id.as_str(), p)).collect();
    let mut keys: Vec<&(String, String)> = pair_depths.keys().collect();
    keys.sort();
    for k in keys {
        let data = &pair_depths[k];
        let (a, b) = (&data.a, &data.b);
        if fasteners.contains_key(a) || fasteners.contains_key(b) {
            continue;
        }
        let unit_a = merged_into.get(a).cloned().unwrap_or_else(|| a.clone());
        let unit_b = merged_into.get(b).cloned().unwrap_or_else(|| b.clone());
        if unit_a == unit_b || !edges.contains_key(&unit_a) || !edges.contains_key(&unit_b) {
            continue;
        }
        if data.normals.is_empty() {
            continue;
        }
        let aligned: Vec<nalgebra::Vector3<f64>> = data
            .normals
            .iter()
            .map(|n| {
                let flip = if n[2] > 0.0 {
                    1.0
                } else if n[2] < 0.0 {
                    -1.0
                } else {
                    1.0
                };
                n * flip
            })
            .collect();
        let mean = crate::npy::mean_rows(&aligned);
        let length = mean.norm();
        if length <= 1e-9 || (mean[2] / length).abs() < 0.5 {
            continue;
        }
        let (pa, pb) = match (by_id.get(a.as_str()), by_id.get(b.as_str())) {
            (Some(pa), Some(pb)) => (pa, pb),
            _ => continue,
        };
        let ca = (pa.bbox_min[2] + pa.bbox_max[2]) / 2.0;
        let cb = (pb.bbox_min[2] + pb.bbox_max[2]) / 2.0;
        if (ca - cb).abs() < 1e-6 {
            continue;
        }
        let (lower, upper) = if ca < cb {
            (&unit_a, &unit_b)
        } else {
            (&unit_b, &unit_a)
        };
        if edges[lower].contains(upper) {
            continue;
        }
        if reaches(edges, upper, lower) {
            warnings.push(format!(
                "support-order preference between '{lower}' and '{upper}' conflicts with collision constraints; skipped"
            ));
            continue;
        }
        edges.get_mut(lower).unwrap().insert(upper.clone());
    }
}

/// `_rollup_adjacency`.
fn rollup_adjacency(
    leaf_adjacency: &Edges,
    merged_into: &HashMap<String, String>,
    group_units: &HashMap<String, (Component, Vec<String>)>,
    units_by_id: &HashMap<String, Component>,
) -> Edges {
    let mut member_to_rep: HashMap<String, String> = HashMap::new();
    for (rep_id, (_c, members)) in group_units {
        for m in members {
            member_to_rep.insert(m.clone(), rep_id.clone());
        }
    }
    let final_unit = |leaf: &str| -> String {
        let unit = merged_into
            .get(leaf)
            .cloned()
            .unwrap_or_else(|| leaf.to_string());
        member_to_rep.get(&unit).cloned().unwrap_or(unit)
    };
    let mut adjacency: Edges = units_by_id
        .keys()
        .map(|u| (u.clone(), HashSet::new()))
        .collect();
    for (leaf, neighbors) in leaf_adjacency {
        let unit_a = final_unit(leaf);
        if !adjacency.contains_key(&unit_a) {
            continue;
        }
        for neighbor in neighbors {
            let unit_b = final_unit(neighbor);
            if unit_b == unit_a || !adjacency.contains_key(&unit_b) {
                continue;
            }
            adjacency.get_mut(&unit_a).unwrap().insert(unit_b.clone());
            adjacency.get_mut(&unit_b).unwrap().insert(unit_a.clone());
        }
    }
    adjacency
}

/// `_reselect_base`.
fn reselect_base(
    planned: &mut [PlannedComponent],
    units_by_id: &HashMap<String, Component>,
    unit_adjacency: &Edges,
    fasteners: &HashMap<String, FastenerInfo>,
    warnings: &mut Vec<String>,
) {
    let base_idx = match planned
        .iter()
        .position(|e| e.tier.as_deref() == Some("base"))
    {
        Some(i) => i,
        None => return,
    };
    let score = |node_id: &str| -> (usize, f64) {
        (
            unit_adjacency.get(node_id).map(|s| s.len()).unwrap_or(0),
            part_volume(&units_by_id[node_id]),
        )
    };
    let base_id = planned[base_idx].node_id.clone();
    let candidates: Vec<usize> = planned
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            e.tier.as_deref() != Some("base")
                && units_by_id.contains_key(&e.node_id)
                && !fasteners.contains_key(&e.node_id)
                && !units_by_id[&e.node_id].is_proxy
        })
        .map(|(i, _)| i)
        .collect();
    if candidates.is_empty() {
        return;
    }
    let winner_idx = *candidates
        .iter()
        .max_by(|&&a, &&b| {
            let sa = score(&planned[a].node_id);
            let sb = score(&planned[b].node_id);
            (sa.0, sa.1, planned[a].node_id.clone())
                .partial_cmp(&(sb.0, sb.1, planned[b].node_id.clone()))
                .unwrap()
        })
        .unwrap();
    let (base_degree, base_volume) = score(&base_id);
    let (win_degree, win_volume) = score(&planned[winner_idx].node_id);
    if (win_degree as f64) < 1.5 * (base_degree.max(1) as f64) || win_volume < 0.5 * base_volume {
        return;
    }
    let winner_name = {
        let u = &units_by_id[&planned[winner_idx].node_id];
        if u.name.is_empty() {
            planned[winner_idx].node_id.clone()
        } else {
            u.name.clone()
        }
    };
    let base_name = {
        let u = &units_by_id[&base_id];
        if u.name.is_empty() {
            base_id.clone()
        } else {
            u.name.clone()
        }
    };
    warnings.push(format!(
        "base re-anchored to '{winner_name}' ({win_degree} mates) — '{base_name}' was the last removable part, not the part the assembly mounts into; it fades in at its ordered position instead"
    ));
    planned[winner_idx].tier = Some("base".to_string());
    planned[winner_idx].motion = Motion::None;
    planned[winner_idx].confidence = Some("high".to_string());
    planned[winner_idx].removal_direction = None;
    planned[winner_idx].blocked_by = Vec::new();
    let mut base_blockers: Vec<String> = unit_adjacency
        .get(&base_id)
        .map(|s| s.iter().cloned().collect())
        .unwrap_or_default();
    base_blockers.sort();
    base_blockers.truncate(crate::consts::MAX_REPORTED_BLOCKERS);
    planned[base_idx].tier = Some("flagged".to_string());
    planned[base_idx].motion = Motion::None;
    planned[base_idx].confidence = Some("low".to_string());
    planned[base_idx].removal_direction = None;
    planned[base_idx].blocked_by = base_blockers;
}

/// `_connectivity_repair`.
/// Reorder for island-connectivity. `hard_edges` (improved mode) constrains the
/// repair to never hoist a part above one of its collision predecessors — the
/// Python version reorders on adjacency alone, and every hard-edge violation it
/// introduces surfaces later as a "failed forward verification" demotion (the
/// flag autopsy traced ALL of Packing Arm's demotions to exactly this).
fn connectivity_repair(
    order: &[String],
    adjacency: &Edges,
    hard_edges: Option<&Edges>,
) -> Vec<String> {
    // For each node in `order`, the set of in-order nodes that must precede it.
    let in_order: HashSet<&String> = order.iter().collect();
    let mut preds: HashMap<&String, Vec<&String>> = HashMap::new();
    if let Some(edges) = hard_edges {
        for (before, afters) in edges {
            if !in_order.contains(before) {
                continue;
            }
            for after in afters {
                if in_order.contains(after) {
                    preds.entry(after).or_default().push(before);
                }
            }
        }
    }
    let mut result: Vec<String> = Vec::new();
    let mut placed: HashSet<String> = HashSet::new();
    let mut deferred: Vec<String> = Vec::new();
    let mut remaining: std::collections::VecDeque<String> = order.iter().cloned().collect();
    let empty = HashSet::new();
    let touches = |node: &str, placed: &HashSet<String>| -> bool {
        placed.is_empty()
            || adjacency
                .get(node)
                .unwrap_or(&empty)
                .intersection(placed)
                .next()
                .is_some()
    };
    let preds_ok = |node: &String, placed: &HashSet<String>| -> bool {
        preds
            .get(node)
            .map(|ps| ps.iter().all(|p| placed.contains(*p)))
            .unwrap_or(true)
    };
    while !remaining.is_empty() || !deferred.is_empty() {
        let mut pick: Option<String> = None;
        if let Some(pos) = deferred
            .iter()
            .position(|n| touches(n, &placed) && preds_ok(n, &placed))
        {
            pick = Some(deferred.remove(pos));
        }
        if pick.is_none() {
            while let Some(node) = remaining.pop_front() {
                if touches(&node, &placed) && preds_ok(&node, &placed) {
                    pick = Some(node);
                    break;
                }
                deferred.push(node);
            }
        }
        // Nothing both touches and is precedence-ready: prefer precedence-ready
        // (drop the connectivity preference — a detached island beats a
        // collision), then fall back to the old head-of-deferred (cycle valve).
        let pick = pick
            .or_else(|| {
                deferred
                    .iter()
                    .position(|n| preds_ok(n, &placed))
                    .map(|pos| deferred.remove(pos))
            })
            .unwrap_or_else(|| deferred.remove(0));
        placed.insert(pick.clone());
        result.push(pick);
    }
    result
}

fn tally_tiers(planned: &[PlannedComponent]) -> Tiers {
    let mut tiers = new_tiers();
    let mut counted: HashSet<String> = HashSet::new();
    for e in planned {
        match e.tier.as_deref() {
            Some("linear") => *tiers.get_mut("linear").unwrap() += 1,
            Some("L") => *tiers.get_mut("l").unwrap() += 1,
            Some("escape") => *tiers.get_mut("escape").unwrap() += 1,
            Some("flagged") => *tiers.get_mut("flagged").unwrap() += 1,
            Some("group") => {
                if e.group_id.is_none() || !counted.contains(e.group_id.as_ref().unwrap()) {
                    *tiers.get_mut("group").unwrap() += 1;
                    if let Some(g) = &e.group_id {
                        counted.insert(g.clone());
                    }
                }
            }
            _ => {}
        }
    }
    tiers
}

/// `_verify_sequence`: forward replay; demote a colliding insertion to flagged.
fn verify_sequence(
    sequence: &[String],
    planned: &mut Vec<PlannedComponent>,
    units_by_id: &HashMap<String, Component>,
    fasteners: &HashMap<String, FastenerInfo>,
    path_samples: usize,
    warnings: &mut Vec<String>,
    tolerance: f64,
) {
    let samples_segment = (path_samples / 3).max(12);
    let idx: HashMap<String, usize> = planned
        .iter()
        .enumerate()
        .map(|(i, e)| (e.node_id.clone(), i))
        .collect();
    let mut world = CollisionWorld::new(&[]);
    for node_id in sequence {
        let i = match idx.get(node_id) {
            Some(&i) => i,
            None => continue,
        };
        let part = &units_by_id[node_id];
        let segments = removal_segments(&planned[i].motion);
        match segments {
            None => {
                planned[i].verified = planned[i].tier.as_deref() == Some("base");
            }
            Some(segs) => {
                let blockers = path_blockers(
                    part,
                    &world,
                    &segs,
                    samples_segment,
                    fasteners,
                    None,
                    tolerance,
                );
                if !blockers.is_empty() {
                    let name = if part.name.is_empty() {
                        node_id.clone()
                    } else {
                        part.name.clone()
                    };
                    // ASSEMBLER_EXPLAIN=1: demotion autopsy — who blocks the forward
                    // replay, how deep, and which exemptions the part carried.
                    if std::env::var("ASSEMBLER_EXPLAIN").is_ok() {
                        eprintln!(
                            "EXPLAIN verify-demote {name} ({node_id}) tier={:?} group={:?} segs={:?}",
                            planned[i].tier, planned[i].group_id,
                            segs.iter().map(|(d, l)| format!("[{:+.2},{:+.2},{:+.2}]x{l:.1}", d[0], d[1], d[2])).collect::<Vec<_>>()
                        );
                        let mut offset = Vector3::zeros();
                        for (dir, dist) in &segs {
                            let me = crate::collide::mate_exempt(part, dir, fasteners);
                            let se = crate::collide::seated_exempt(part, dir);
                            eprintln!(
                                "  dir=[{:+.2},{:+.2},{:+.2}] mate_exempt={:?} seated_exempt={:?}",
                                dir[0],
                                dir[1],
                                dir[2],
                                me.map(|m| m.into_iter().collect::<Vec<_>>()),
                                se.map(|m| m.into_iter().collect::<Vec<_>>()),
                            );
                            let n = ((samples_segment).max(2)).min(40);
                            let mut worst: HashMap<String, f64> = HashMap::new();
                            for k in 1..=n {
                                let s = *dist * (k as f64) / (n as f64);
                                for (o, d) in world.contacts_at(part, &(offset + dir * s)) {
                                    let e = worst.entry(o).or_insert(0.0);
                                    if d > *e {
                                        *e = d;
                                    }
                                }
                            }
                            let mut w: Vec<_> = worst.into_iter().collect();
                            w.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
                            for (o, d) in w.iter().take(5) {
                                let on = units_by_id
                                    .get(o)
                                    .map(|p| p.name.clone())
                                    .filter(|s| !s.is_empty())
                                    .unwrap_or_else(|| o.clone());
                                eprintln!(
                                    "    blocker {on}: max_depth={d:.3} (tol={tolerance:.3})"
                                );
                            }
                            offset += dir * *dist;
                        }
                    }
                    warnings.push(format!(
                        "'{name}' failed forward verification; flagged for review — it fades in during playback"
                    ));
                    planned[i].motion = Motion::None;
                    planned[i].tier = Some("flagged".to_string());
                    planned[i].confidence = Some("low".to_string());
                    planned[i].removal_direction = None;
                    let mut bl: Vec<String> = blockers.into_iter().collect();
                    bl.sort();
                    bl.truncate(crate::consts::MAX_REPORTED_BLOCKERS);
                    planned[i].blocked_by = bl;
                    planned[i].verified = false;
                } else {
                    planned[i].verified = true;
                }
            }
        }
        world.add(node_id, part);
    }
}

fn centroid_bounds(units: &[&Component]) -> (Vector3<f64>, Vector3<f64>, Vector3<f64>) {
    let (lo, hi) = bounds(units);
    ((lo + hi) / 2.0, lo, hi)
}

fn motion_identity(unit: &Component, motion: &Motion) -> String {
    // Python compares identity TUPLES, where -0.0 == 0.0. Motion directions
    // routinely carry -0.0 (negated +0.0), so normalize before formatting or
    // identical parts' identities spuriously differ and the "keep runs of
    // identical parts together" preference breaks.
    let r3 = |c: f64| round_py(c, 3) + 0.0; // -0.0 + 0.0 == +0.0
    let mk = match motion {
        Motion::Linear { direction, .. } => format!(
            "linear:{:.3},{:.3},{:.3}",
            r3(direction[0]),
            r3(direction[1]),
            r3(direction[2])
        ),
        Motion::L { segments } => {
            let mut s = String::from("L");
            for seg in segments {
                s += &format!(
                    ":{:.3},{:.3},{:.3}",
                    r3(seg.direction[0]),
                    r3(seg.direction[1]),
                    r3(seg.direction[2])
                );
            }
            s
        }
        Motion::None => "none".to_string(),
    };
    format!("{}|{}", unit.name, mk)
}

/// `_preference_topo_sort`: deterministic scored Kahn's over the precedence DAG.
#[allow(clippy::too_many_arguments)]
pub fn preference_topo_sort(
    planned: &[PlannedComponent],
    units_by_id: &HashMap<String, Component>,
    edges: &Edges,
    fasteners: &HashMap<String, FastenerInfo>,
    joints: &HashMap<String, HashMap<String, f64>>,
    fallback_order: &[String],
    warnings: &mut Vec<String>,
    group_members: &HashMap<String, Vec<String>>,
    fastened: &HashSet<String>,
    contact_count: &HashMap<String, i64>,
    adjacency: Option<&Edges>,
    soft_edges: &Edges,
) -> Vec<String> {
    let units: Vec<&Component> = units_by_id.values().collect();
    let (centroid, amin, amax) = centroid_bounds(&units);
    let diagonal = {
        let n = (amax - amin).norm();
        if n == 0.0 {
            1.0
        } else {
            n
        }
    };

    let mut fastener_units: HashSet<String> = fasteners.keys().cloned().collect();
    for (rep_id, members) in group_members {
        if members.iter().any(|m| fasteners.contains_key(m)) {
            fastener_units.insert(rep_id.clone());
        }
    }

    let by_id: HashMap<&str, &PlannedComponent> =
        planned.iter().map(|e| (e.node_id.as_str(), e)).collect();
    let base_id = planned
        .iter()
        .find(|e| e.tier.as_deref() == Some("base"))
        .map(|e| e.node_id.clone());

    let empty_members: Vec<String> = Vec::new();
    let is_securing = |node_id: &str| -> bool {
        let candidates = std::iter::once(node_id.to_string()).chain(
            group_members
                .get(node_id)
                .unwrap_or(&empty_members)
                .iter()
                .cloned(),
        );
        for candidate in candidates {
            if let Some(info) = fasteners.get(&candidate) {
                let empty = HashMap::new();
                let joint = joints.get(&candidate).unwrap_or(&empty);
                if joint.keys().any(|member| {
                    !info.mates.contains_key(member) && Some(member) != base_id.as_ref()
                }) {
                    return true;
                }
            }
        }
        false
    };

    // predecessors
    let mut predecessors: HashMap<String, HashSet<String>> =
        edges.keys().map(|k| (k.clone(), HashSet::new())).collect();
    for (before, afters) in edges {
        for after in afters {
            predecessors.get_mut(after).unwrap().insert(before.clone());
        }
    }
    let mut soft_predecessors: HashMap<String, HashSet<String>> =
        edges.keys().map(|k| (k.clone(), HashSet::new())).collect();
    for (before, afters) in soft_edges {
        for after in afters {
            if let Some(s) = soft_predecessors.get_mut(after) {
                s.insert(before.clone());
            }
        }
    }
    let outgoing = |node_id: &str| -> bool {
        edges.get(node_id).map(|s| !s.is_empty()).unwrap_or(false)
            || soft_edges
                .get(node_id)
                .map(|s| !s.is_empty())
                .unwrap_or(false)
    };

    let is_weakly_secured = |node_id: &str, placed_set: &HashSet<String>| -> bool {
        let _ = placed_set;
        if fastener_units.contains(node_id) {
            return false;
        }
        let entry = by_id[node_id];
        if !matches!(entry.tier.as_deref(), Some("linear") | Some("L")) {
            return false;
        }
        if units_by_id[node_id].is_proxy {
            return false;
        }
        if outgoing(node_id) {
            return false;
        }
        let members: Vec<String> = std::iter::once(node_id.to_string())
            .chain(
                group_members
                    .get(node_id)
                    .unwrap_or(&empty_members)
                    .iter()
                    .cloned(),
            )
            .collect();
        if members.iter().any(|m| fastened.contains(m)) {
            return false;
        }
        members
            .iter()
            .map(|m| contact_count.get(m).cloned().unwrap_or(0))
            .max()
            .unwrap_or(0)
            == 1
    };

    let empty_set: HashSet<String> = HashSet::new();
    let mut placed: Vec<String> = Vec::new();
    let mut placed_set: HashSet<String> = HashSet::new();
    let mut pending: HashSet<String> = edges.keys().cloned().collect();
    let mut previous_identity: Option<String> = None;

    while !pending.is_empty() {
        let mut available: Vec<String> = pending
            .iter()
            .filter(|n| predecessors[*n].is_subset(&placed_set))
            .cloned()
            .collect();
        if available.is_empty() {
            warnings.push(
                "precedence cycle detected; keeping the greedy order for the remaining parts"
                    .to_string(),
            );
            for n in fallback_order {
                if pending.contains(n) {
                    placed.push(n.clone());
                }
            }
            break;
        }

        if let Some(adj) = adjacency {
            if !placed_set.is_empty() {
                let touching: Vec<String> = available
                    .iter()
                    .filter(|n| {
                        adj.get(*n)
                            .unwrap_or(&empty_set)
                            .intersection(&placed_set)
                            .next()
                            .is_some()
                    })
                    .cloned()
                    .collect();
                if !touching.is_empty() {
                    available = touching;
                } else {
                    let pending_touchers: Vec<String> = pending
                        .iter()
                        .filter(|n| {
                            adj.get(*n)
                                .unwrap_or(&empty_set)
                                .intersection(&placed_set)
                                .next()
                                .is_some()
                        })
                        .cloned()
                        .collect();
                    if !pending_touchers.is_empty() {
                        let mut need: HashSet<String> = HashSet::new();
                        let mut stack = pending_touchers.clone();
                        while let Some(node) = stack.pop() {
                            for before in predecessors.get(&node).unwrap_or(&empty_set) {
                                if !placed_set.contains(before) && need.insert(before.clone()) {
                                    stack.push(before.clone());
                                }
                            }
                        }
                        let gated: Vec<String> = available
                            .iter()
                            .filter(|n| need.contains(*n))
                            .cloned()
                            .collect();
                        if !gated.is_empty() {
                            available = gated;
                        }
                    } else {
                        let anchor = available
                            .iter()
                            .max_by(|a, b| {
                                let ka = (
                                    adj.get(*a).map(|s| s.len()).unwrap_or(0),
                                    part_volume(&units_by_id[*a]),
                                    (*a).clone(),
                                );
                                let kb = (
                                    adj.get(*b).map(|s| s.len()).unwrap_or(0),
                                    part_volume(&units_by_id[*b]),
                                    (*b).clone(),
                                );
                                ka.0.cmp(&kb.0)
                                    .then(ka.1.partial_cmp(&kb.1).unwrap())
                                    .then(ka.2.cmp(&kb.2))
                            })
                            .unwrap()
                            .clone();
                        let name = {
                            let u = &units_by_id[&anchor];
                            if u.name.is_empty() {
                                anchor.clone()
                            } else {
                                u.name.clone()
                            }
                        };
                        warnings.push(format!(
                            "'{name}' starts a detached island — nothing already placed touches it"
                        ));
                        available = vec![anchor];
                    }
                }
            }
        }

        let key_of = |node_id: &str| -> (Vec<f64>, String) {
            let entry = by_id[node_id];
            let unit = &units_by_id[node_id];
            let ident = motion_identity(unit, &entry.motion);
            let (sv, sb) = structural_key(unit, &centroid, diagonal);
            let flagged_pref = entry.tier.as_deref() == Some("flagged")
                && !fastener_units.contains(node_id)
                && entry.blocked_by.iter().any(|b| pending.contains(b));
            let soft_present = !soft_predecessors
                .get(node_id)
                .unwrap_or(&empty_set)
                .is_subset(&placed_set);
            let key = vec![
                if entry.tier.as_deref() == Some("base") {
                    0.0
                } else {
                    1.0
                },
                if previous_identity.as_deref() == Some(ident.as_str()) {
                    0.0
                } else {
                    1.0
                },
                if is_securing(node_id) { 0.0 } else { 1.0 },
                if flagged_pref { 0.0 } else { 1.0 },
                if soft_present { 1.0 } else { 0.0 },
                if outgoing(node_id) { 0.0 } else { 1.0 },
                if is_weakly_secured(node_id, &placed_set) {
                    1.0
                } else {
                    0.0
                },
                sv,
                sb,
                unit.bbox_min[2],
            ];
            (key, node_id.to_string())
        };

        let chosen = available
            .iter()
            .min_by(|a, b| {
                let ka = key_of(a);
                let kb = key_of(b);
                for (x, y) in ka.0.iter().zip(kb.0.iter()) {
                    match x.partial_cmp(y).unwrap() {
                        std::cmp::Ordering::Equal => continue,
                        o => return o,
                    }
                }
                ka.1.cmp(&kb.1)
            })
            .unwrap()
            .clone();
        previous_identity = Some(motion_identity(
            &units_by_id[&chosen],
            &by_id[chosen.as_str()].motion,
        ));
        placed.push(chosen.clone());
        placed_set.insert(chosen.clone());
        pending.remove(&chosen);
    }

    if let Some(adj) = adjacency {
        // The repair may not reorder a part above one of its collision
        // predecessors, or the forward-verification pass demotes it later.
        placed = connectivity_repair(&placed, adj, Some(edges));
    }
    placed
}

/// Auto-detect "detail swarms" — a populated PCB's board carrying dozens to
/// hundreds of tiny components — from pure geometry, and emit `merge_units`
/// specs (`(id, name, member_node_ids)`) so each board plans as ONE rigid unit.
///
/// Shape: a substantial HOST part with many TINY parts seated on it. Seeding
/// uses narrowphase contact distance (a hollow enclosure's bbox contains
/// everything, so bbox overlap can't tell "inside" from "mounted on"), then
/// grows transitively over bbox proximity for stacked components (IC on board,
/// cap on IC). Fastener-named parts never join a swarm — screws keep their own
/// removal animations. `skip` holds ids already consumed by caller/authored
/// units (never re-swallowed; a merged unit body is non-tiny anyway).
pub fn detect_swarm_units(
    parts: &[Component],
    skip: &HashSet<String>,
) -> Vec<(String, Option<String>, Vec<String>)> {
    let refs: Vec<&Component> = parts.iter().collect();
    if refs.len() < SWARM_MIN_MEMBERS + 1 {
        return Vec::new();
    }
    let (alo, ahi) = bounds(&refs);
    let asm_diag = (ahi - alo).norm().max(1.0);
    let diag = |p: &Component| (p.bbox_max - p.bbox_min).norm();
    let tiny_limit = SWARM_TINY_FRACTION * asm_diag;

    let eligible = |p: &Component| !skip.contains(&p.node_id) && !crate::fasteners::is_fastener(p);
    let mut hosts: Vec<usize> = (0..parts.len())
        .filter(|&i| eligible(&parts[i]) && diag(&parts[i]) >= tiny_limit)
        .collect();
    // Largest-first so the board outranks brackets when distances tie.
    hosts.sort_by(|&a, &b| diag(&parts[b]).total_cmp(&diag(&parts[a])));
    let tiny: Vec<usize> = (0..parts.len())
        .filter(|&i| eligible(&parts[i]) && diag(&parts[i]) < tiny_limit)
        .collect();
    if hosts.is_empty() || tiny.len() < SWARM_MIN_MEMBERS {
        return Vec::new();
    }

    let overlaps = |p: &Component, q: &Component, pad: f64| -> bool {
        (0..3).all(|k| p.bbox_min[k] - pad <= q.bbox_max[k] && q.bbox_min[k] - pad <= p.bbox_max[k])
    };

    // Seed: each tiny part joins the nearest host it CONTACTS (bbox prefilter,
    // then exact narrowphase distance over the cached BVHs) — and only a host
    // that DWARFS it. "Tiny vs the assembly" alone misfires on large models
    // whose mid-size parts sit on a rail; a PCB component is ~1% of its board.
    let dwarfed_by = |t: usize, h: usize| diag(&parts[t]) < SWARM_HOST_FRACTION * diag(&parts[h]);
    let mut member_host: HashMap<usize, usize> = HashMap::new();
    for &t in &tiny {
        let mut best: Option<(f64, usize)> = None;
        for &h in &hosts {
            if !dwarfed_by(t, h) || !overlaps(&parts[t], &parts[h], SWARM_CONTACT_MM) {
                continue;
            }
            let d = collision::distance_pair(&parts[t].bvh(), &parts[h].bvh());
            if d <= SWARM_CONTACT_MM && best.is_none_or(|(bd, _)| d < bd) {
                best = Some((d, h));
            }
        }
        if let Some((_, h)) = best {
            member_host.insert(t, h);
        }
    }

    // Grow: unassigned tiny parts touching (bbox proximity) an assigned member
    // join that member's swarm — stacked components don't touch the board.
    loop {
        let mut grew = false;
        for &t in &tiny {
            if member_host.contains_key(&t) {
                continue;
            }
            let joined = member_host
                .iter()
                .find(|&(&m, &h)| {
                    dwarfed_by(t, h) && overlaps(&parts[t], &parts[m], GROUP_PROXIMITY_MM)
                })
                .map(|(_, &h)| h);
            if let Some(h) = joined {
                member_host.insert(t, h);
                grew = true;
            }
        }
        if !grew {
            break;
        }
    }

    let mut by_host: HashMap<usize, Vec<usize>> = HashMap::new();
    for (&m, &h) in &member_host {
        by_host.entry(h).or_default().push(m);
    }

    // Absorb: a host that already carries a real tiny swarm is a populated
    // board. Sweep in any remaining eligible part that CONTACTS such a host and
    // is still clearly smaller than it (SWARM_ABSORB_FRACTION, looser than the
    // strict tiny gate) — a chip or connector mounted on the board, which the
    // tiny gate leaves loose (it's above tiny_limit, so it was a host candidate
    // with no members of its own). Gated on the host ALREADY being a swarm, so a
    // bare rail never absorbs its mid-size rollers.
    let swarm_hosts: Vec<usize> = by_host
        .iter()
        .filter(|(_, members)| members.len() >= SWARM_MIN_MEMBERS)
        .map(|(&h, _)| h)
        .collect();
    if !swarm_hosts.is_empty() {
        let absorbed_by =
            |t: usize, h: usize| diag(&parts[t]) < SWARM_ABSORB_FRACTION * diag(&parts[h]);
        let mut absorbed: Vec<(usize, usize)> = Vec::new();
        for i in 0..parts.len() {
            if !eligible(&parts[i])
                || member_host.contains_key(&i)
                || swarm_hosts.contains(&i)
            {
                continue;
            }
            let mut best: Option<(f64, usize)> = None;
            for &h in &swarm_hosts {
                if !absorbed_by(i, h) || !overlaps(&parts[i], &parts[h], SWARM_CONTACT_MM) {
                    continue;
                }
                let d = collision::distance_pair(&parts[i].bvh(), &parts[h].bvh());
                if d <= SWARM_CONTACT_MM && best.is_none_or(|(bd, _)| d < bd) {
                    best = Some((d, h));
                }
            }
            if let Some((_, h)) = best {
                absorbed.push((i, h));
            }
        }
        for (i, h) in absorbed {
            member_host.insert(i, h);
            by_host.entry(h).or_default().push(i);
        }
    }

    let mut specs: Vec<(String, Option<String>, Vec<String>)> = Vec::new();
    for &h in &hosts {
        let Some(members) = by_host.get(&h) else {
            continue;
        };
        if members.len() < SWARM_MIN_MEMBERS {
            continue;
        }
        // Host + members, host first. Distinct "swarm:" id namespace so the
        // group id can never collide with a member nodeId.
        let mut node_ids = vec![parts[h].node_id.clone()];
        let mut sorted = members.clone();
        sorted.sort();
        node_ids.extend(sorted.iter().map(|&m| parts[m].node_id.clone()));
        specs.push((
            format!("swarm:{}", parts[h].node_id),
            Some(parts[h].name.clone()),
            node_ids,
        ));
    }
    specs
}

/// `_merge_units`: merge each multi-member caller unit into one rigid body.
pub fn merge_units(
    parts: &[Component],
    units_spec: &[(String, Option<String>, Vec<String>)],
) -> (
    Vec<Component>,
    HashMap<String, (Vec<String>, Option<String>)>,
) {
    let by_id: HashMap<&str, &Component> = parts.iter().map(|p| (p.node_id.as_str(), p)).collect();
    let mut expansion: HashMap<String, (Vec<String>, Option<String>)> = HashMap::new();
    let mut consumed: HashSet<String> = HashSet::new();
    let mut merged: Vec<Component> = Vec::new();
    for (uid, name, node_ids) in units_spec {
        let members: Vec<String> = node_ids
            .iter()
            .filter(|n| by_id.contains_key(n.as_str()) && !consumed.contains(*n))
            .cloned()
            .collect();
        if uid.is_empty() || members.len() <= 1 {
            continue;
        }
        let member_refs: Vec<&Component> = members.iter().map(|m| by_id[m.as_str()]).collect();
        let meshes: Vec<&crate::types::Mesh> = member_refs.iter().map(|m| &m.mesh).collect();
        let combined_mesh = crate::types::Mesh::concatenate(&meshes);
        let (lo, hi) = bounds(&member_refs);
        let cname = name
            .clone()
            .unwrap_or_else(|| by_id[members[0].as_str()].name.clone());
        let combined = Component::new(
            uid.clone(),
            cname,
            combined_mesh,
            lo,
            hi,
            member_refs.iter().any(|m| m.is_proxy),
        );
        merged.push(combined);
        expansion.insert(uid.clone(), (members.clone(), name.clone()));
        consumed.extend(members);
    }
    let mut remaining: Vec<Component> = parts
        .iter()
        .filter(|p| !consumed.contains(&p.node_id))
        .cloned()
        .collect();
    remaining.extend(merged);
    (remaining, expansion)
}

fn fill_contact_normals(parts: &mut [Component], pair_depths: &PairDepths) {
    let idx: HashMap<String, usize> = parts
        .iter()
        .enumerate()
        .map(|(i, p)| (p.node_id.clone(), i))
        .collect();
    let mut keys: Vec<&(String, String)> = pair_depths.keys().collect();
    keys.sort();
    for k in keys {
        let data = &pair_depths[k];
        for node in [&data.a, &data.b] {
            if let Some(&i) = idx.get(node) {
                if parts[i].contact_normals.len() < 128 {
                    parts[i]
                        .contact_normals
                        .extend(data.normals.iter().cloned());
                }
            }
        }
    }
}

/// `_plan_parts`: the full pipeline over world-space parts.
pub fn plan_parts(
    mut parts: Vec<Component>,
    clearance: f64,
    path_samples: usize,
    tolerance: f64,
    protected: Option<&HashSet<String>>,
    warnings: &mut Vec<String>,
) -> PlanOutcome {
    let _timing = std::env::var("ASSEMBLER_TIMING").is_ok();
    let mut _t = std::time::Instant::now();
    macro_rules! lap {
        ($n:expr) => {
            if _timing {
                eprintln!("  [{}] {:.2}s", $n, _t.elapsed().as_secs_f64());
                _t = std::time::Instant::now();
            }
        };
    }
    let pair_depths = seated_pair_depths(&parts);
    lap!("seated_pair_depths");
    let leaf_adjacency = ordering_adjacency(&parts, &pair_depths, ORDERING_CONTACT_MM);
    fill_contact_normals(&mut parts, &pair_depths);

    let mut fasteners = classify_fasteners(&parts, &pair_depths);
    lap!("classify");
    let (mut units, mut merged_into) =
        merge_rigid_groups(&parts, &pair_depths, &fasteners, warnings);
    lap!("merge_rigid");

    // Joints over original parts, then remap through merges.
    let mut joints = fastener_joints(&parts, &fasteners);
    lap!("fastener_joints");
    if !merged_into.is_empty() {
        let mut remapped: HashMap<String, HashMap<String, f64>> = HashMap::new();
        for (fid, members) in &joints {
            if merged_into.contains_key(fid) {
                continue;
            }
            let mut entry: HashMap<String, f64> = HashMap::new();
            for (member, projection) in members {
                let unit = merged_into
                    .get(member)
                    .cloned()
                    .unwrap_or_else(|| member.clone());
                if &unit == fid {
                    continue;
                }
                let take = !entry.contains_key(&unit) || projection.abs() < entry[&unit].abs();
                if take {
                    entry.insert(unit, *projection);
                }
            }
            remapped.insert(fid.clone(), entry);
        }
        joints = remapped;
    }
    for (fid, members) in &joints {
        if let Some(info) = fasteners.get_mut(fid) {
            for member in members.keys() {
                if !info.mates.contains_key(member) {
                    info.sliding.insert(member.clone(), tolerance);
                }
            }
        }
    }

    let sandwiches = sandwiched_parts(&mut units, &pair_depths, &fasteners, &merged_into);
    lap!("sandwiched");

    // fastened set
    let fastened: HashSet<String> = joints.values().flat_map(|m| m.keys().cloned()).collect();

    // contact_count (unit-level, fastener-excluded, deduped)
    let mut contact_count: HashMap<String, i64> = HashMap::new();
    let mut counted_pairs: HashSet<(String, String)> = HashSet::new();
    for data in pair_depths.values() {
        let unit_a = merged_into
            .get(&data.a)
            .cloned()
            .unwrap_or_else(|| data.a.clone());
        let unit_b = merged_into
            .get(&data.b)
            .cloned()
            .unwrap_or_else(|| data.b.clone());
        if unit_a == unit_b {
            continue;
        }
        let pk = pair_key(&unit_a, &unit_b);
        if !counted_pairs.insert(pk) {
            continue;
        }
        for (me, other) in [(&unit_a, &unit_b), (&unit_b, &unit_a)] {
            if fasteners.contains_key(other) {
                continue;
            }
            *contact_count.entry(me.clone()).or_insert(0) += 1;
        }
    }

    // deep_bitten
    let mut deep_bitten: HashSet<String> = HashSet::new();
    for (k, data) in &pair_depths {
        let _ = k;
        if data.depth > 1.0 {
            for node in [&data.a, &data.b] {
                let other = data.other(node);
                if let Some(info) = fasteners.get(node) {
                    if info.mates.contains_key(other) {
                        continue;
                    }
                }
                let unit = merged_into
                    .get(node)
                    .cloned()
                    .unwrap_or_else(|| node.clone());
                if sandwiches.contains_key(&unit) {
                    continue;
                }
                deep_bitten.insert(node.clone());
            }
        }
    }

    let sandwiched_set: HashSet<String> = sandwiches.keys().cloned().collect();
    let mut group_units: HashMap<String, (Component, Vec<String>)> = HashMap::new();
    let mut late_merges: HashMap<String, String> = HashMap::new();
    let (mut planned, greedy_sequence, _greedy_tiers) = greedy_disassembly(
        &units,
        clearance,
        path_samples,
        tolerance,
        &fasteners,
        &deep_bitten,
        &sandwiched_set,
        protected,
        &mut group_units,
        &mut late_merges,
        warnings,
    );
    lap!("greedy");

    // Chase late-merge chains.
    if !late_merges.is_empty() {
        let keys: Vec<String> = late_merges.keys().cloned().collect();
        for member in keys {
            let mut host = late_merges[&member].clone();
            while late_merges.contains_key(&host) {
                host = late_merges[&host].clone();
            }
            late_merges.insert(member, host);
        }
        for (m, h) in &late_merges {
            merged_into.insert(m.clone(), h.clone());
        }
    }

    // units_by_id (final planning units).
    let mut units_by_id: HashMap<String, Component> =
        units.into_iter().map(|u| (u.node_id.clone(), u)).collect();
    for member in late_merges.keys() {
        units_by_id.remove(member);
    }
    for (rep_id, (combined, members)) in &group_units {
        units_by_id.insert(rep_id.clone(), combined.clone());
        for m in members {
            if m != rep_id {
                units_by_id.remove(m);
            }
        }
    }

    let unit_adjacency =
        rollup_adjacency(&leaf_adjacency, &merged_into, &group_units, &units_by_id);
    // Relatedness: strict contact plus clearance-fit neighbors, so parts a
    // fastener/slip-fit holds together across a gap are sequenced adjacently
    // instead of appearing as detached floating islands. Collision correctness
    // stays on `unit_adjacency`/hard edges; this only softens the connectivity
    // preference and feeds the emitted viewer contact graph.
    let relatedness = {
        let refs: Vec<&Component> = parts.iter().collect();
        let (amin, amax) = bounds(&refs);
        let mm = crate::consts::relatedness_mm((amax - amin).norm());
        let leaf = ordering_adjacency(&parts, &pair_depths, mm);
        rollup_adjacency(&leaf, &merged_into, &group_units, &units_by_id)
    };
    reselect_base(
        &mut planned,
        &units_by_id,
        &unit_adjacency,
        &fasteners,
        warnings,
    );

    // Recompute flagged-structural blockers against the full seated assembly.
    let flagged_ids: Vec<String> = planned
        .iter()
        .filter(|e| {
            e.tier.as_deref() == Some("flagged")
                && units_by_id.contains_key(&e.node_id)
                && !fasteners.contains_key(&e.node_id)
        })
        .map(|e| e.node_id.clone())
        .collect();
    if !flagged_ids.is_empty() {
        let seated_units: Vec<&Component> = units_by_id.values().collect();
        let seated_world = CollisionWorld::new(&seated_units);
        for id in &flagged_ids {
            let part = &units_by_id[id];
            let others = others_excluding(&units_by_id, id);
            let blockers = crate::greedy::escape_blockers(
                part,
                &units_by_id,
                &others,
                &seated_world,
                &fasteners,
                tolerance,
                path_samples,
            );
            if !blockers.is_empty() {
                let i = planned.iter().position(|e| &e.node_id == id).unwrap();
                planned[i].blocked_by = blockers;
            }
        }
    }

    let mut edges = derive_precedence(&planned, &units_by_id, &fasteners, path_samples, tolerance);
    lap!("derive_precedence");
    add_joint_edges(&fasteners, &joints, &units_by_id, &mut edges, warnings);

    let mut soft_edges: Edges = units_by_id
        .keys()
        .map(|k| (k.clone(), HashSet::new()))
        .collect();
    add_sandwich_edges(
        &sandwiches,
        &units_by_id,
        &merged_into,
        &mut soft_edges,
        warnings,
    );
    add_support_edges(
        &parts,
        &pair_depths,
        &fasteners,
        &merged_into,
        &mut soft_edges,
        warnings,
    );

    let base_id = planned
        .iter()
        .find(|e| e.tier.as_deref() == Some("base"))
        .map(|e| e.node_id.clone());
    if let Some(bid) = &base_id {
        for afters in edges.values_mut() {
            afters.remove(bid);
        }
        for afters in soft_edges.values_mut() {
            afters.remove(bid);
        }
    }

    let group_members: HashMap<String, Vec<String>> = group_units
        .iter()
        .map(|(rep, (_c, members))| (rep.clone(), members.clone()))
        .collect();

    let mut sequence = preference_topo_sort(
        &planned,
        &units_by_id,
        &edges,
        &fasteners,
        &joints,
        &greedy_sequence,
        warnings,
        &group_members,
        &fastened,
        &contact_count,
        Some(&relatedness),
        &soft_edges,
    );

    // ASSEMBLER_EXPLAIN=1: sanity-check the GREEDY order first — greedy's own
    // sequence is supposed to be collision-consistent by construction, so any
    // demotion here means greedy emitted a colliding motion (validation bug),
    // while a clean pass pins the blame on the reordering machinery.
    if std::env::var("ASSEMBLER_EXPLAIN").is_ok() {
        let mut probe = planned.clone();
        let mut w2: Vec<String> = Vec::new();
        verify_sequence(
            &greedy_sequence,
            &mut probe,
            &units_by_id,
            &fasteners,
            path_samples,
            &mut w2,
            tolerance,
        );
        let demoted = w2
            .iter()
            .filter(|w| w.contains("forward verification"))
            .count();
        eprintln!("EXPLAIN greedy-order verify: {demoted} demotions (final-order comes below)");
    }

    // ASSEMBLER_EXPLAIN=1: report hard precedence edges the FINAL sequence
    // violates (the collision-consistency contract the topo sort + repair are
    // supposed to preserve; each violation is a forward-verify failure waiting).
    if std::env::var("ASSEMBLER_EXPLAIN").is_ok() {
        let pos: HashMap<&String, usize> =
            sequence.iter().enumerate().map(|(i, s)| (s, i)).collect();
        for (before, afters) in &edges {
            for after in afters {
                if let (Some(&pb), Some(&pa)) = (pos.get(before), pos.get(after)) {
                    if pb > pa {
                        let nm = |id: &String| {
                            units_by_id
                                .get(id)
                                .map(|p| p.name.clone())
                                .filter(|s| !s.is_empty())
                                .unwrap_or_else(|| id.clone())
                        };
                        eprintln!(
                            "EXPLAIN edge-violated: '{}'({}) must precede '{}'({}) but seq has {} > {}",
                            nm(before), &before[..8], nm(after), &after[..8], pb, pa
                        );
                    }
                }
            }
        }
    }

    verify_sequence(
        &sequence,
        &mut planned,
        &units_by_id,
        &fasteners,
        path_samples,
        warnings,
        tolerance,
    );
    lap!("verify_sequence");

    // Expand subassembly units into their members.
    let mut groups_payload: BTreeMap<String, GroupPayload> = BTreeMap::new();
    if !group_units.is_empty() {
        let mut group_ids: HashMap<String, String> = HashMap::new();
        let mut counter = 0;
        for node in &sequence {
            if group_units.contains_key(node) {
                counter += 1;
                group_ids.insert(node.clone(), format!("g{counter}"));
            }
        }
        let mut expanded: Vec<String> = Vec::new();
        for node in &sequence {
            if let Some((_c, members)) = group_units.get(node) {
                expanded.extend(members.iter().cloned());
            } else {
                expanded.push(node.clone());
            }
        }
        sequence = expanded;

        for (rep_id, (_combined, members)) in &group_units {
            let gid = group_ids[rep_id].clone();
            let rep_i = planned.iter().position(|e| &e.node_id == rep_id).unwrap();
            planned[rep_i].group_id = Some(gid.clone());
            let rep = planned[rep_i].clone();
            groups_payload.insert(
                gid.clone(),
                GroupPayload {
                    component_node_ids: members.clone(),
                    motion: rep.motion.clone(),
                    name: None,
                },
            );
            for member_id in members {
                if member_id == rep_id {
                    continue;
                }
                planned.push(PlannedComponent {
                    node_id: member_id.clone(),
                    motion: rep.motion.clone(),
                    confidence: rep.confidence.clone(),
                    removal_direction: rep.removal_direction,
                    blocked_by: rep.blocked_by.clone(),
                    tier: rep.tier.clone(),
                    verified: rep.verified,
                    group_id: Some(gid.clone()),
                });
            }
        }
    }

    let tiers = tally_tiers(&planned);
    let verified_count = planned.iter().filter(|e| e.verified).count() as i64;
    let needs_support =
        crate::stability::support_check(&sequence, &parts, &pair_depths, &fasteners);
    let waves = compute_waves(&edges);
    PlanOutcome {
        planned,
        sequence,
        tiers,
        merged_into,
        groups: groups_payload,
        verified_count,
        edges,
        adjacency: unit_adjacency,
        relatedness,
        needs_support,
        waves,
    }
}

/// `_plan_fixed_sequence`: caller-fixed order + grouping; compute each group's
/// forward-collision insertion motion (no reordering).
pub fn plan_fixed_sequence(
    mut parts: Vec<Component>,
    groups_in_order: &[Vec<String>],
    clearance: f64,
    path_samples: usize,
    tolerance: f64,
    warnings: &mut Vec<String>,
) -> PlanOutcome {
    let by_id: HashSet<String> = parts.iter().map(|p| p.node_id.clone()).collect();

    // Map caller groups onto present, unclaimed leaves.
    let mut cleaned_groups: Vec<Vec<String>> = Vec::new();
    let mut consumed: HashSet<String> = HashSet::new();
    for (index, group) in groups_in_order.iter().enumerate() {
        let mut members: Vec<String> = Vec::new();
        for node_id in group {
            if !by_id.contains(node_id) {
                warnings.push(format!(
                    "group {}: nodeId '{node_id}' is not in the model; dropped",
                    index + 1
                ));
                continue;
            }
            if consumed.contains(node_id) {
                warnings.push(format!(
                    "group {}: nodeId '{node_id}' already belongs to an earlier group; dropped",
                    index + 1
                ));
                continue;
            }
            members.push(node_id.clone());
            consumed.insert(node_id.clone());
        }
        if members.is_empty() {
            warnings.push(format!(
                "group {} has no parts present in the model; skipped",
                index + 1
            ));
            continue;
        }
        cleaned_groups.push(members);
    }

    if cleaned_groups.is_empty() {
        return PlanOutcome {
            planned: Vec::new(),
            sequence: Vec::new(),
            tiers: new_tiers(),
            merged_into: HashMap::new(),
            groups: BTreeMap::new(),
            verified_count: 0,
            edges: HashMap::new(),
            adjacency: HashMap::new(),
            relatedness: HashMap::new(),
            needs_support: HashSet::new(),
            waves: HashMap::new(),
        };
    }

    // Classification over the sequence parts only.
    let seq_unfilled: Vec<Component> = parts
        .iter()
        .filter(|p| consumed.contains(&p.node_id))
        .cloned()
        .collect();
    let pair_depths = seated_pair_depths(&seq_unfilled);
    fill_contact_normals(&mut parts, &pair_depths);
    let seq_parts: Vec<Component> = parts
        .iter()
        .filter(|p| consumed.contains(&p.node_id))
        .cloned()
        .collect();
    let fasteners = classify_fasteners(&seq_parts, &pair_depths);

    // Each group → one rigid body (single-member groups stay as the leaf).
    let units_spec: Vec<(String, Option<String>, Vec<String>)> = cleaned_groups
        .iter()
        .map(|m| (m[0].clone(), None, m.clone()))
        .collect();
    let (merged_parts, _expansion) = merge_units(&parts, &units_spec);
    let merged_by_id: HashMap<String, Component> = merged_parts
        .into_iter()
        .map(|p| (p.node_id.clone(), p))
        .collect();
    let groups_ordered: Vec<(String, Component, Vec<String>)> = cleaned_groups
        .iter()
        .enumerate()
        .map(|(i, m)| {
            (
                format!("g{}", i + 1),
                merged_by_id[&m[0]].clone(),
                m.clone(),
            )
        })
        .collect();

    let all_bodies: Vec<&Component> = groups_ordered.iter().map(|(_, b, _)| b).collect();

    let mut placed: HashMap<String, Component> = HashMap::new();
    let mut planned: Vec<PlannedComponent> = Vec::new();
    let mut units_by_id: HashMap<String, Component> = HashMap::new();

    // Persistent broadphase: `full_world` = every sequence body; `placed_world`
    // grows as bodies are placed (the forward-collision set).
    let full_world = CollisionWorld::new(&all_bodies);
    let mut placed_world = CollisionWorld::new(&[]);

    for (order_index, (_label, body, _members)) in groups_ordered.iter().enumerate() {
        units_by_id.insert(body.node_id.clone(), body.clone());
        let entry = if order_index == 0 {
            PlannedComponent {
                node_id: body.node_id.clone(),
                motion: Motion::None,
                confidence: Some("high".to_string()),
                removal_direction: None,
                blocked_by: Vec::new(),
                tier: Some("base".to_string()),
                verified: false,
                group_id: None,
            }
        } else {
            let mut remaining_map: HashMap<String, Component> = placed.clone();
            remaining_map.insert(body.node_id.clone(), body.clone());
            let others: Vec<&Component> = placed.values().collect();
            let mut e = plan_removal(
                body,
                &remaining_map,
                &others,
                &placed_world,
                Some(&full_world),
                clearance,
                path_samples,
                &fasteners,
                tolerance,
            );
            if e.is_none() {
                e = plan_escape(
                    body,
                    &others,
                    &placed_world,
                    path_samples,
                    &fasteners,
                    tolerance,
                );
            }
            match e {
                Some(e) => e,
                None => {
                    let name = if body.name.is_empty() {
                        body.node_id.clone()
                    } else {
                        body.name.clone()
                    };
                    warnings.push(format!(
                        "'{name}' has no collision-free insertion after the earlier groups; flagged for review — it fades in during playback"
                    ));
                    let blocked_by = crate::greedy::escape_blockers(
                        body,
                        &remaining_map,
                        &others,
                        &placed_world,
                        &fasteners,
                        tolerance,
                        path_samples,
                    );
                    PlannedComponent {
                        node_id: body.node_id.clone(),
                        motion: Motion::None,
                        confidence: Some("low".to_string()),
                        removal_direction: None,
                        blocked_by,
                        tier: Some("flagged".to_string()),
                        verified: false,
                        group_id: None,
                    }
                }
            }
        };
        planned.push(entry);
        placed_world.add(&body.node_id, body);
        placed.insert(body.node_id.clone(), body.clone());
    }

    let sequence_bodies: Vec<String> = groups_ordered
        .iter()
        .map(|(_, b, _)| b.node_id.clone())
        .collect();
    verify_sequence(
        &sequence_bodies,
        &mut planned,
        &units_by_id,
        &fasteners,
        path_samples,
        warnings,
        tolerance,
    );
    let tiers = tally_tiers(&planned);

    // Expand each group body back to its member leaves.
    let mut groups_payload: BTreeMap<String, GroupPayload> = BTreeMap::new();
    let mut expanded: Vec<PlannedComponent> = Vec::new();
    let mut sequence: Vec<String> = Vec::new();
    for (label, body, members) in &groups_ordered {
        let rep_i = planned
            .iter()
            .position(|e| e.node_id == body.node_id)
            .unwrap();
        planned[rep_i].group_id = Some(label.clone());
        let rep = planned[rep_i].clone();
        groups_payload.insert(
            label.clone(),
            GroupPayload {
                component_node_ids: members.clone(),
                motion: rep.motion.clone(),
                name: None,
            },
        );
        sequence.extend(members.iter().cloned());
        for member_id in members {
            if member_id == &body.node_id {
                expanded.push(rep.clone());
            } else {
                expanded.push(PlannedComponent {
                    node_id: member_id.clone(),
                    motion: rep.motion.clone(),
                    confidence: rep.confidence.clone(),
                    removal_direction: rep.removal_direction,
                    blocked_by: rep.blocked_by.clone(),
                    tier: rep.tier.clone(),
                    verified: rep.verified,
                    group_id: Some(label.clone()),
                });
            }
        }
    }

    let verified_count = expanded.iter().filter(|e| e.verified).count() as i64;
    let needs_support =
        crate::stability::support_check(&sequence, &parts, &pair_depths, &fasteners);
    PlanOutcome {
        planned: expanded,
        sequence,
        tiers,
        merged_into: HashMap::new(),
        groups: groups_payload,
        verified_count,
        edges: HashMap::new(),
        adjacency: HashMap::new(),
        relatedness: HashMap::new(),
        needs_support,
        waves: HashMap::new(),
    }
}
