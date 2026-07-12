//! Greedy disassembly: per-part removal-motion search (linear / L / escape),
//! single-blocker rigid merge, subassembly group extraction, and flagging.

use crate::collide::*;
use crate::consts::*;
use crate::fasteners::{head_direction, is_fastener};
use crate::geom::*;
use crate::types::{Component, FastenerInfo, Motion, MotionSegment, PlannedComponent};
use nalgebra::Vector3;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

pub type Tiers = BTreeMap<String, i64>;

/// Evaluate greedy candidates (`order`, in priority order) in parallel and return
/// the first-in-priority that yields a plan — byte-identical to the sequential
/// "try each in order, take the first success" because each `eval` is a pure,
/// read-only sweep (no shared mutation). Each worker thread builds its OWN FCL
/// managers once (`map_init`) over the shared immutable BVHs — the managers are
/// `!Send` but never leave their thread. `world` = the active set (`remaining`);
/// `full` (only when `build_full`) = every part. The moving part is excluded
/// per-query by index, and all `contacts_at` consumers are order-independent
/// (max-depth / set-membership), so the worker-local index order is irrelevant.
/// How many leading candidates to try sequentially before fanning the rest out.
/// Since 2.1 made worker fan-out share ONE `CollisionWorld` (no per-candidate
/// rebuild), fan-out is nearly free, so 1 is best overall: a stuck pass on a large
/// assembly parallelizes immediately (BCU 47→36s, Packing Arm →10.5s) at the cost
/// of a little speculation on Seat Rail's cheap early-success iterations (+0.8s).
/// The value never affects output — only speculation-vs-latency. Override with
/// ASSEMBLER_SEQ_PROBE; ASSEMBLER_SEQUENTIAL forces a fully sequential parity oracle.
const SEQ_PROBE: usize = 1;

#[allow(clippy::type_complexity, clippy::too_many_arguments)]
fn par_first_success<F>(
    order: &[String],
    remaining: &HashMap<String, Component>,
    seq_world: &CollisionWorld,
    seq_full: Option<&CollisionWorld>,
    eval: F,
) -> Option<(usize, PlannedComponent)>
where
    F: Fn(
            &Component,
            &[&Component],
            &CollisionWorld,
            Option<&CollisionWorld>,
        ) -> Option<PlannedComponent>
        + Sync,
{
    use rayon::prelude::*;
    if order.is_empty() {
        return None;
    }
    let others_of =
        |id: &str| -> Vec<&Component> { remaining.values().filter(|c| c.node_id != id).collect() };
    // Fast path: probe the top candidate(s) sequentially. Greedy takes the
    // first-in-priority success, so an early hit ends here with no thread fan-out
    // and no speculative sweeps — the Seat Rail / BCU case. ASSEMBLER_SEQUENTIAL
    // forces every candidate down this path (parity oracle: parallel must equal it).
    let seq_probe = std::env::var("ASSEMBLER_SEQ_PROBE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(SEQ_PROBE);
    let probe = if std::env::var("ASSEMBLER_SEQUENTIAL").is_ok() {
        order.len()
    } else {
        seq_probe.min(order.len())
    };
    for (i, id) in order.iter().enumerate().take(probe) {
        if let Some(p) = eval(&remaining[id], &others_of(id), seq_world, seq_full) {
            return Some((i, p));
        }
    }
    if order.len() <= probe {
        return None;
    }
    // The top candidate(s) are stuck — fan the remainder across cores against the
    // SAME shared managers (CollisionWorld is Sync; queries are read-only). No
    // per-candidate world rebuild — the win that lets a stuck pass parallelize for
    // free. `find_map_first` returns the lowest surviving index and cancels the
    // rest, so the result is still the first-in-priority success.
    (probe..order.len()).into_par_iter().find_map_first(|i| {
        let id = &order[i];
        eval(&remaining[id], &others_of(id), seq_world, seq_full).map(|p| (i, p))
    })
}

pub fn new_tiers() -> Tiers {
    let mut t = BTreeMap::new();
    for k in [
        "linear",
        "l",
        "escape",
        "group",
        "flagged",
        "forced",
        "unplanned",
    ] {
        t.insert(k.to_string(), 0);
    }
    t
}

fn bounds_over(parts: &[&Component]) -> (Vector3<f64>, Vector3<f64>) {
    let mut lo = Vector3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY);
    let mut hi = Vector3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in parts {
        lo = lo.inf(&p.bbox_min);
        hi = hi.sup(&p.bbox_max);
    }
    (lo, hi)
}

fn neg(v: &Vector3<f64>) -> [f64; 3] {
    [-v[0], -v[1], -v[2]]
}
fn arr(v: &Vector3<f64>) -> [f64; 3] {
    [v[0], v[1], v[2]]
}

/// `_plan_removal`: tier 1 (straight line, least-entangling) then tier 2 ("L").
#[allow(clippy::too_many_arguments)]
pub fn plan_removal(
    part: &Component,
    remaining_map: &HashMap<String, Component>,
    others: &[&Component],
    world: &CollisionWorld,
    full_world: Option<&CollisionWorld>,
    _clearance: f64,
    path_samples: usize,
    fasteners: &HashMap<String, FastenerInfo>,
    tolerance: f64,
) -> Option<PlannedComponent> {
    if others.is_empty() {
        return None;
    }
    let (static_min, static_max) = bounds_over(others);
    let info = fasteners.get(&part.node_id);

    let directions: Vec<Vector3<f64>> = if is_fastener(part) && info.is_some() {
        let head = head_direction(part, info.unwrap(), Some(remaining_map));
        vec![head, -head]
    } else {
        candidate_directions(part)
    };

    // Tier 1: collect every clear direction.
    let mut clear: Vec<(usize, Vector3<f64>, f64)> = Vec::new();
    for (index, direction) in directions.iter().enumerate() {
        let travel = exit_travel(part, &static_min, &static_max, direction, None);
        if travel <= 0.0 {
            continue;
        }
        let separation = separation_distance(
            &part.bbox_min,
            &part.bbox_max,
            &static_min,
            &static_max,
            direction,
        );
        let exempt = self_exempt(mate_exempt(part, direction, fasteners), &[&part.node_id]);
        let last_touch = path_is_clear(
            part,
            world,
            direction,
            0.0,
            travel,
            path_samples,
            tolerance,
            None,
            Some(exempt),
            Some(separation + 2.0 * MAX_SAMPLE_SPACING_MM),
        );
        if let Some(lt) = last_touch {
            clear.push((
                index,
                *direction,
                recorded_travel(part, direction, travel, lt),
            ));
        }
    }

    if !clear.is_empty() {
        let (_index, direction, recorded) = if clear.len() == 1 || full_world.is_none() {
            clear[0]
        } else {
            let full = full_world.unwrap();
            let samples_segment = (path_samples / 3).max(12);
            let mut extra: Exempt = HashMap::new();
            extra.insert(part.node_id.clone(), f64::INFINITY);
            *clear
                .iter()
                .min_by_key(|(index, direction, recorded)| {
                    let blockers = path_blockers(
                        part,
                        full,
                        &[(*direction, *recorded)],
                        samples_segment,
                        fasteners,
                        Some(&extra),
                        tolerance,
                    );
                    (blockers.len(), *index)
                })
                .unwrap()
        };
        let confidence = if part.is_proxy { "low" } else { "high" };
        return Some(PlannedComponent {
            node_id: part.node_id.clone(),
            motion: Motion::Linear {
                direction: neg(&direction),
                distance: recorded,
            },
            confidence: Some(confidence.to_string()),
            removal_direction: Some(arr(&direction)),
            blocked_by: Vec::new(),
            tier: Some("linear".to_string()),
            verified: false,
            group_id: None,
        });
    }

    // Tier 2: lift then slide ("L").
    let part_size = part.bbox_max - part.bbox_min;
    let hop = {
        let n = part_size.norm();
        if n == 0.0 {
            1.0
        } else {
            n
        }
    };
    let samples_segment = (path_samples / 3).max(12);
    for first in world_axes() {
        let exempt = self_exempt(mate_exempt(part, &first, fasteners), &[&part.node_id]);
        if path_is_clear(
            part,
            world,
            &first,
            0.0,
            hop,
            samples_segment,
            tolerance,
            None,
            Some(exempt),
            None,
        )
        .is_none()
        {
            continue;
        }
        let offset = first * hop;
        for second in world_axes() {
            if first.dot(&second).abs() > 0.99 {
                continue;
            }
            let travel = exit_travel(part, &static_min, &static_max, &second, Some(&offset));
            if travel <= 0.0 {
                continue;
            }
            let separation = separation_distance(
                &(part.bbox_min + offset),
                &(part.bbox_max + offset),
                &static_min,
                &static_max,
                &second,
            );
            let exempt2 = self_exempt(mate_exempt(part, &second, fasteners), &[&part.node_id]);
            let second_touch = path_is_clear(
                part,
                world,
                &second,
                0.0,
                travel,
                samples_segment,
                tolerance,
                Some(&offset),
                Some(exempt2),
                Some(separation + 2.0 * MAX_SAMPLE_SPACING_MM),
            );
            if let Some(st) = second_touch {
                return Some(PlannedComponent {
                    node_id: part.node_id.clone(),
                    motion: Motion::L {
                        segments: vec![
                            MotionSegment {
                                direction: neg(&second),
                                distance: recorded_travel(part, &second, travel, st),
                            },
                            MotionSegment {
                                direction: neg(&first),
                                distance: round_py(hop, 3),
                            },
                        ],
                    },
                    confidence: Some("low".to_string()),
                    removal_direction: Some(arr(&first)),
                    blocked_by: Vec::new(),
                    tier: Some("L".to_string()),
                    verified: false,
                    group_id: None,
                });
            }
        }
    }
    None
}

/// `_removal_segments_to_planned`: reverse a removal chain into an insertion motion.
fn removal_segments_to_planned(
    part: &Component,
    removal: &[(Vector3<f64>, f64)],
) -> PlannedComponent {
    let first_direction = removal[0].0;
    let motion = if removal.len() == 1 {
        let (direction, distance) = removal[0];
        Motion::Linear {
            direction: neg(&direction),
            distance: round_py(distance, 3),
        }
    } else {
        let segments = removal
            .iter()
            .rev()
            .map(|(direction, distance)| MotionSegment {
                direction: neg(direction),
                distance: round_py(*distance, 3),
            })
            .collect();
        Motion::L { segments }
    };
    PlannedComponent {
        node_id: part.node_id.clone(),
        motion,
        confidence: Some("low".to_string()),
        removal_direction: Some(arr(&first_direction)),
        blocked_by: Vec::new(),
        tier: Some("escape".to_string()),
        verified: false,
        group_id: None,
    }
}

/// `_plan_escape`: tier-3 BFS over axis-aligned hops.
pub fn plan_escape(
    part: &Component,
    others: &[&Component],
    world: &CollisionWorld,
    path_samples: usize,
    fasteners: &HashMap<String, FastenerInfo>,
    tolerance: f64,
) -> Option<PlannedComponent> {
    plan_escape_annotated(part, others, world, path_samples, fasteners, tolerance).0
}

/// `plan_escape` plus a FROZEN flag: true when the BFS never left the root node
/// (the part cannot exit or advance a `min_hop` in any direction). A frozen part
/// stays frozen until a neighbor capping one of its hops leaves — the assembly
/// bounds shrinking can't help (the obstruction is adjacent, not the exit
/// distance; and phase 1 re-checks the exit path every round before phase 2).
/// The flag is a free byproduct of the escape search, so the caller can cache it
/// with a neighbor-only invalidation and skip the frozen re-search across bounds
/// epochs — the bulk of the escape phase on dense assemblies.
pub fn plan_escape_annotated(
    part: &Component,
    others: &[&Component],
    world: &CollisionWorld,
    path_samples: usize,
    fasteners: &HashMap<String, FastenerInfo>,
    tolerance: f64,
) -> (Option<PlannedComponent>, bool) {
    if others.is_empty() {
        return (None, false);
    }
    let (static_min, static_max) = bounds_over(others);
    let part_diagonal = {
        let n = (part.bbox_max - part.bbox_min).norm();
        if n == 0.0 {
            1.0
        } else {
            n
        }
    };
    let min_hop = (part_diagonal * MIN_HOP_FRACTION).max(2.0);
    let hop_cap = part_diagonal * 1.5;
    let samples_segment = (path_samples / 3).max(12);
    let directions = candidate_directions(part);

    let mut queue: std::collections::VecDeque<(Vector3<f64>, Vec<(Vector3<f64>, f64)>)> =
        std::collections::VecDeque::new();
    queue.push_back((Vector3::zeros(), Vec::new()));
    let mut visited: HashSet<(i64, i64, i64)> = HashSet::new();
    visited.insert((0, 0, 0));
    let mut expansions = 0;

    while let Some((offset, segments)) = queue.pop_front() {
        if expansions >= MAX_ESCAPE_EXPANSIONS {
            break;
        }
        expansions += 1;
        for direction in &directions {
            if let Some(last) = segments.last() {
                if direction.dot(&last.0).abs() > 0.99 {
                    continue;
                }
            }
            let exempt = self_exempt(mate_exempt(part, direction, fasteners), &[&part.node_id]);

            let travel = exit_travel(part, &static_min, &static_max, direction, Some(&offset));
            let separation = separation_distance(
                &(part.bbox_min + offset),
                &(part.bbox_max + offset),
                &static_min,
                &static_max,
                direction,
            );
            if travel > 0.0 {
                let exit_touch = path_is_clear(
                    part,
                    world,
                    direction,
                    0.0,
                    travel,
                    samples_segment,
                    tolerance,
                    Some(&offset),
                    Some(exempt.clone()),
                    Some(separation + 2.0 * MAX_SAMPLE_SPACING_MM),
                );
                if let Some(et) = exit_touch {
                    let mut removal = segments.clone();
                    removal.push((*direction, recorded_travel(part, direction, travel, et)));
                    return (Some(removal_segments_to_planned(part, &removal)), false);
                }
            }

            if segments.len() + 1 >= MAX_ESCAPE_SEGMENTS {
                continue;
            }

            let free = free_travel(
                part,
                world,
                direction,
                &offset,
                hop_cap,
                samples_segment,
                Some(&exempt),
                tolerance,
            );
            if free < min_hop {
                continue;
            }
            let new_offset = offset + direction * free;
            let key = (
                (new_offset[0] / min_hop).round() as i64,
                (new_offset[1] / min_hop).round() as i64,
                (new_offset[2] / min_hop).round() as i64,
            );
            if visited.contains(&key) {
                continue;
            }
            visited.insert(key);
            let mut new_segments = segments.clone();
            new_segments.push((*direction, free));
            queue.push_back((new_offset, new_segments));
        }
    }
    // Frozen iff the search never enqueued a hop (only the root was visited).
    (None, visited.len() <= 1)
}

/// Per-direction escape blockers: for each candidate direction with positive
/// exit travel, the exact set of parts blocking that sweep. The union form
/// (`escape_blockers`, the Python-parity behavior) over-counts — a part whose
/// BEST direction is blocked by exactly one neighbor is a valid single-blocker
/// merge even when other directions add more blockers to the union. The flag
/// autopsy on the real assemblies showed this exact pattern behind most
/// manually-authored parts (panel pairs, servo/mount clusters).
pub fn escape_blockers_by_direction(
    part: &Component,
    remaining_map: &HashMap<String, Component>,
    others: &[&Component],
    world: &CollisionWorld,
    fasteners: &HashMap<String, FastenerInfo>,
    tolerance: f64,
    path_samples: usize,
) -> Vec<(Vector3<f64>, f64, BTreeSet<String>)> {
    if others.is_empty() {
        return Vec::new();
    }
    let (static_min, static_max) = bounds_over(others);
    let samples_segment = (path_samples / 3).max(12);
    let info = fasteners.get(&part.node_id);
    let directions: Vec<Vector3<f64>> = if is_fastener(part) && info.is_some() {
        let head = head_direction(part, info.unwrap(), Some(remaining_map));
        vec![head, -head]
    } else {
        candidate_directions(part)
    };
    let mut extra: Exempt = HashMap::new();
    extra.insert(part.node_id.clone(), f64::INFINITY);
    let mut out = Vec::new();
    for direction in directions {
        let travel = exit_travel(part, &static_min, &static_max, &direction, None);
        if travel <= 0.0 {
            continue;
        }
        let mut blockers = path_blockers(
            part,
            world,
            &[(direction, travel)],
            samples_segment,
            fasteners,
            Some(&extra),
            tolerance,
        );
        blockers.remove(&part.node_id);
        out.push((direction, travel, blockers));
    }
    out
}

/// `_escape_blockers`: union of sweep blockers over the part's candidate directions.
pub fn escape_blockers(
    part: &Component,
    remaining_map: &HashMap<String, Component>,
    others: &[&Component],
    world: &CollisionWorld,
    fasteners: &HashMap<String, FastenerInfo>,
    tolerance: f64,
    path_samples: usize,
) -> Vec<String> {
    if others.is_empty() {
        return Vec::new();
    }
    let (static_min, static_max) = bounds_over(others);
    let samples_segment = (path_samples / 3).max(12);
    let info = fasteners.get(&part.node_id);
    let directions: Vec<Vector3<f64>> = if is_fastener(part) && info.is_some() {
        let head = head_direction(part, info.unwrap(), Some(remaining_map));
        vec![head, -head]
    } else {
        candidate_directions(part)
    };
    let mut extra: Exempt = HashMap::new();
    extra.insert(part.node_id.clone(), f64::INFINITY);
    let mut blockers: BTreeSet<String> = BTreeSet::new();
    for direction in directions {
        let travel = exit_travel(part, &static_min, &static_max, &direction, None);
        if travel <= 0.0 {
            continue;
        }
        blockers.extend(path_blockers(
            part,
            world,
            &[(direction, travel)],
            samples_segment,
            fasteners,
            Some(&extra),
            tolerance,
        ));
    }
    blockers.remove(&part.node_id);
    blockers
        .into_iter()
        .take(crate::consts::MAX_REPORTED_BLOCKERS)
        .collect()
}

/// `_blockers`: parts whose bounding boxes overlap this part's (rough set).
fn bbox_blockers(part: &Component, remaining: &HashMap<String, Component>) -> Vec<String> {
    let mut out = Vec::new();
    for other in remaining.values() {
        if other.node_id == part.node_id {
            continue;
        }
        let overlaps = (0..3).all(|i| part.bbox_min[i] <= other.bbox_max[i])
            && (0..3).all(|i| other.bbox_min[i] <= part.bbox_max[i]);
        if overlaps {
            out.push(other.node_id.clone());
        }
    }
    out.truncate(crate::consts::MAX_REPORTED_BLOCKERS);
    out
}

/// `_group_exempt`: merged threaded-mate + sandwich allowances for a group.
fn group_exempt(
    members: &[&Component],
    direction: &Vector3<f64>,
    fasteners: &HashMap<String, FastenerInfo>,
    member_ids: &HashSet<String>,
) -> Option<Exempt> {
    let mut merged: Exempt = HashMap::new();
    let mut add = |k: &String, v: f64| {
        if member_ids.contains(k) {
            return;
        }
        let e = merged.entry(k.clone()).or_insert(f64::MIN);
        if v > *e {
            *e = v;
        }
    };
    for member in members {
        if let Some(exempt) = mate_exempt(member, direction, fasteners) {
            for (k, v) in &exempt {
                add(k, *v);
            }
        }
        if let Some(seated) = seated_exempt(member, direction) {
            for (k, v) in &seated {
                add(k, *v);
            }
        }
    }
    if merged.is_empty() {
        None
    } else {
        Some(merged)
    }
}

fn bbox_volume(part: &Component) -> f64 {
    let e = part.bbox_max - part.bbox_min;
    (e[0] * e[1] * e[2]).abs()
}

/// `_plan_group_removal`: find a connected subassembly that removes as one unit.
#[allow(clippy::too_many_arguments)]
pub fn plan_group_removal(
    remaining: &HashMap<String, Component>,
    world: &mut CollisionWorld,
    path_samples: usize,
    fasteners: &HashMap<String, FastenerInfo>,
    combined_cache: &mut HashMap<BTreeSet<String>, Component>,
    tolerance: f64,
    deep_bitten: &HashSet<String>,
) -> Option<(Vec<String>, Component, PlannedComponent)> {
    let parts: Vec<&Component> = remaining.values().collect();
    if parts.len() <= 2 {
        return None;
    }

    // Proximity adjacency (inflated bboxes).
    let mut adjacency: HashMap<String, HashSet<String>> = parts
        .iter()
        .map(|p| (p.node_id.clone(), HashSet::new()))
        .collect();
    for i in 0..parts.len() {
        for j in (i + 1)..parts.len() {
            let a = parts[i];
            let b = parts[j];
            let close = (0..3).all(|k| a.bbox_min[k] - GROUP_PROXIMITY_MM <= b.bbox_max[k])
                && (0..3).all(|k| b.bbox_min[k] - GROUP_PROXIMITY_MM <= a.bbox_max[k]);
            if close {
                adjacency
                    .get_mut(&a.node_id)
                    .unwrap()
                    .insert(b.node_id.clone());
                adjacency
                    .get_mut(&b.node_id)
                    .unwrap()
                    .insert(a.node_id.clone());
            }
        }
    }

    let diagonal = |p: &Component| (p.bbox_max - p.bbox_min).norm();
    let samples_segment = (path_samples / 3).max(12);
    let mut tests = 0usize;

    let mut seeds: Vec<&Component> = parts.clone();
    seeds.sort_by(|a, b| {
        b.bbox_max[2]
            .partial_cmp(&a.bbox_max[2])
            .unwrap()
            .then(a.node_id.cmp(&b.node_id))
    });

    for seed in seeds {
        if tests >= MAX_GROUP_TESTS {
            break;
        }
        let mut members: Vec<Component> = vec![seed.clone()];
        let mut member_ids: HashSet<String> = HashSet::from([seed.node_id.clone()]);

        while members.len() < MAX_GROUP_SIZE && tests < MAX_GROUP_TESTS {
            let mut neighbor_ids: Vec<String> = Vec::new();
            for member in &members {
                if let Some(adj) = adjacency.get(&member.node_id) {
                    for nid in adj {
                        if !member_ids.contains(nid) && remaining.contains_key(nid) {
                            neighbor_ids.push(nid.clone());
                        }
                    }
                }
            }
            neighbor_ids.sort();
            neighbor_ids.dedup();
            if neighbor_ids.is_empty() {
                break;
            }
            neighbor_ids.sort_by(|a, b| {
                let pa = &remaining[a];
                let pb = &remaining[b];
                let ka = (deep_bitten.contains(a) as i32, diagonal(pa), a.clone());
                let kb = (deep_bitten.contains(b) as i32, diagonal(pb), b.clone());
                ka.0.cmp(&kb.0)
                    .then(ka.1.partial_cmp(&kb.1).unwrap())
                    .then(ka.2.cmp(&kb.2))
            });
            let chosen = remaining[&neighbor_ids[0]].clone();
            member_ids.insert(chosen.node_id.clone());
            members.push(chosen);
            if members.len() >= remaining.len() {
                break;
            }

            let others: Vec<&Component> = parts
                .iter()
                .filter(|p| !member_ids.contains(&p.node_id))
                .copied()
                .collect();
            let (static_min, static_max) = bounds_over(&others);

            let cache_key: BTreeSet<String> = member_ids.iter().cloned().collect();
            let combined = combined_cache.entry(cache_key).or_insert_with(|| {
                let member_refs: Vec<&crate::types::Mesh> =
                    members.iter().map(|m| &m.mesh).collect();
                let combined_mesh = crate::types::Mesh::concatenate(&member_refs);
                let rep = members
                    .iter()
                    .max_by(|a, b| bbox_volume(a).partial_cmp(&bbox_volume(b)).unwrap())
                    .unwrap();
                let mut lo = members[0].bbox_min;
                let mut hi = members[0].bbox_max;
                for m in &members {
                    lo = lo.inf(&m.bbox_min);
                    hi = hi.sup(&m.bbox_max);
                }
                let name = members
                    .iter()
                    .map(|m| m.name.clone())
                    .collect::<Vec<_>>()
                    .join(" + ");
                let mut c = Component::new(
                    rep.node_id.clone(),
                    name,
                    combined_mesh,
                    lo,
                    hi,
                    members.iter().any(|m| m.is_proxy),
                );
                c.cached_volume = Some(members.iter().map(part_volume).sum());
                c
            });
            let combined = combined.clone();

            // Candidate directions from member axes, then world axes.
            let mut directions: Vec<Vector3<f64>> = Vec::new();
            for member in &members {
                let mut axes: Vec<Vector3<f64>> = Vec::new();
                if let Some(mi) = fasteners.get(&member.node_id) {
                    axes.push(mi.axis);
                }
                if let Some(a) = symmetry_axis(member) {
                    axes.push(a);
                }
                for base in axes {
                    for cand in [base, -base] {
                        if directions.iter().all(|d| cand.dot(d) < 0.999) {
                            directions.push(cand);
                        }
                    }
                }
            }
            for w in world_axes() {
                if directions.iter().all(|d| w.dot(d) < 0.999) {
                    directions.push(w);
                }
            }

            let member_id_list: Vec<&str> = member_ids.iter().map(|s| s.as_str()).collect();
            // Test the group against the OTHERS by hiding its members in the
            // persistent world, instead of rebuilding a fresh manager over ~n
            // parts every growth step. Restored before returning either way.
            for id in &member_id_list {
                world.set_active(id, false);
            }
            let mut winner: Option<(Vector3<f64>, f64, f64)> = None;
            for direction in &directions {
                tests += 1;
                let travel = exit_travel(&combined, &static_min, &static_max, direction, None);
                if travel <= 0.0 {
                    if tests >= MAX_GROUP_TESTS {
                        break;
                    }
                    continue;
                }
                let separation = separation_distance(
                    &combined.bbox_min,
                    &combined.bbox_max,
                    &static_min,
                    &static_max,
                    direction,
                );
                let exempt = self_exempt(
                    group_exempt(
                        &members.iter().collect::<Vec<_>>(),
                        direction,
                        fasteners,
                        &member_ids,
                    ),
                    &member_id_list,
                );
                let touch = path_is_clear(
                    &combined,
                    &world,
                    direction,
                    0.0,
                    travel,
                    samples_segment,
                    tolerance,
                    None,
                    Some(exempt),
                    Some(separation + 2.0 * MAX_SAMPLE_SPACING_MM),
                );
                if let Some(t) = touch {
                    winner = Some((*direction, travel, t));
                    break;
                }
                if tests >= MAX_GROUP_TESTS {
                    break;
                }
            }
            for id in &member_id_list {
                world.set_active(id, true);
            }
            if let Some((direction, travel, touch)) = winner {
                let entry = PlannedComponent {
                    node_id: combined.node_id.clone(),
                    motion: Motion::Linear {
                        direction: neg(&direction),
                        distance: recorded_travel(&combined, &direction, travel, touch),
                    },
                    confidence: Some("low".to_string()),
                    removal_direction: Some(arr(&direction)),
                    blocked_by: Vec::new(),
                    tier: Some("group".to_string()),
                    verified: false,
                    group_id: None,
                };
                let ordered: Vec<String> = members.iter().map(|m| m.node_id.clone()).collect();
                return Some((ordered, combined, entry));
            }
        }
    }
    None
}

/// `removal_priority`: fasteners first, then smallest/peripheral (ascending).
fn removal_priority(
    remaining: &HashMap<String, Component>,
    fasteners: &HashMap<String, FastenerInfo>,
    centroid: &Vector3<f64>,
    diagonal: f64,
) -> Vec<String> {
    // Precompute each part's sort key once (the comparator would otherwise
    // recompute structural_key — hypot/round/part_volume — O(n log n) times per
    // call). Fasteners first (0), then negate each structural-key component
    // (Python: `0 if fastener else 1`, then `tuple(-c for c in key)`).
    let mut keyed: Vec<(i32, f64, f64, &String)> = remaining
        .keys()
        .map(|id| {
            let (v, b) = structural_key(&remaining[id], centroid, diagonal);
            let f = if fasteners.contains_key(id) { 0 } else { 1 };
            (f, -v, -b, id)
        })
        .collect();
    keyed.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then(a.1.partial_cmp(&b.1).unwrap())
            .then(a.2.partial_cmp(&b.2).unwrap())
            .then(a.3.cmp(b.3))
    });
    keyed.into_iter().map(|(_, _, _, id)| id.clone()).collect()
}

/// Conservative "who could unblock this part" set for the blocked memo: every
/// remaining part whose bbox intersects any of the part's possible sweep
/// regions — the bbox inflated by the search's wander reach, extruded along
/// every direction the search can try (candidate directions, the fastener axis,
/// world axes) out to the assembly diagonal (≥ any exit travel). Fastener
/// mates/sliders are added unconditionally: exemptions and head-direction
/// heuristics read the mate set, so a mate's removal can change the verdict
/// without ever being geometrically in the way.
fn blocked_watch_set(
    part: &Component,
    remaining: &HashMap<String, Component>,
    fasteners: &HashMap<String, FastenerInfo>,
    reach: f64,
    travel: f64,
) -> HashSet<String> {
    let mut dirs = candidate_directions(part);
    if let Some(info) = fasteners.get(&part.node_id) {
        dirs.push(info.axis);
        dirs.push(-info.axis);
    }
    for w in world_axes() {
        if dirs.iter().all(|c| c.dot(&w) < 0.999) {
            dirs.push(w);
        }
    }
    let bmin = part.bbox_min.add_scalar(-reach);
    let bmax = part.bbox_max.add_scalar(reach);
    let mut watch: HashSet<String> = HashSet::new();
    for q in remaining.values() {
        if q.node_id == part.node_id {
            continue;
        }
        let hit = dirs.iter().any(|d| {
            let end_min = bmin + d * travel;
            let end_max = bmax + d * travel;
            let smin = bmin.inf(&end_min);
            let smax = bmax.sup(&end_max);
            (0..3).all(|k| smin[k] <= q.bbox_max[k] && q.bbox_min[k] <= smax[k])
        });
        if hit {
            watch.insert(q.node_id.clone());
        }
    }
    if let Some(info) = fasteners.get(&part.node_id) {
        watch.extend(info.mates.keys().cloned());
        watch.extend(info.sliding.keys().cloned());
    }
    for (fid, info) in fasteners {
        if info.mates.contains_key(&part.node_id) || info.sliding.contains_key(&part.node_id) {
            watch.insert(fid.clone());
        }
    }
    watch
}

/// Drop the removed part's own memo and every memo watching it.
fn blocked_memo_invalidate(memo: &mut HashMap<String, HashSet<String>>, removed: &str) {
    memo.remove(removed);
    memo.retain(|_, watch| !watch.contains(removed));
}

/// `_greedy_disassembly`: the full greedy loop over world-space parts.
#[allow(clippy::too_many_arguments)]
pub fn greedy_disassembly(
    parts: &[Component],
    _clearance: f64,
    path_samples: usize,
    tolerance: f64,
    fasteners: &HashMap<String, FastenerInfo>,
    deep_bitten: &HashSet<String>,
    sandwiched: &HashSet<String>,
    protected: Option<&HashSet<String>>,
    group_units: &mut HashMap<String, (Component, Vec<String>)>,
    late_merges: &mut HashMap<String, String>,
    warnings: &mut Vec<String>,
) -> (Vec<PlannedComponent>, Vec<String>, Tiers) {
    let mut remaining: HashMap<String, Component> = parts
        .iter()
        .map(|p| (p.node_id.clone(), p.clone()))
        .collect();

    let centroid = assembly_centroid(parts);
    let (amin, amax) = {
        let refs: Vec<&Component> = parts.iter().collect();
        bounds_over(&refs)
    };
    let assembly_diagonal = {
        let n = (amax - amin).norm();
        if n == 0.0 {
            1.0
        } else {
            n
        }
    };

    // Build every part's BVH up front, in parallel — `bvh()` is a thread-safe
    // OnceLock, and the two world builds below (plus every per-thread world) hit
    // them serially otherwise. Biggest on large assemblies (431 BVHs on BCU).
    {
        use rayon::prelude::*;
        parts.par_iter().for_each(|p| {
            p.bvh();
        });
    }

    // Persistent broadphase managers reused across the whole greedy loop
    // (Python keeps one). `world` mirrors `remaining` (parts set inactive on
    // removal); `full_world` holds every part always. The moving part is
    // excluded per-query by index, so no per-sweep rebuild or unregister.
    let mut world = CollisionWorld::from_components(parts);
    let full_world = CollisionWorld::from_components(parts);

    // The presumptive base: the largest-volume part (mirrors pipeline2's base
    // pick, which is connectivity-first with volume as the dominant tiebreak).
    // Phase-3 single-blocker merges must never fold a part INTO the base —
    // a knob merged into the frame simply vanishes from the instructions,
    // and any real removal motion it might have had (found once neighbors
    // clear) is lost. Stuck parts against the base get flagged instead,
    // preserving their install step. Merges into movable hosts (nut->bolt,
    // servo->mount, panel pairs) are unaffected.
    let base_candidate: Option<String> = parts
        .iter()
        .max_by(|a, b| {
            part_volume(a)
                .partial_cmp(&part_volume(b))
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.node_id.cmp(&b.node_id))
        })
        .map(|c| c.node_id.clone());

    let mut removal_order: Vec<PlannedComponent> = Vec::new();
    let mut group_mesh_cache: HashMap<BTreeSet<String>, Component> = HashMap::new();
    let mut stuck_blockers_cache: HashMap<String, Vec<String>> = HashMap::new();
    let mut tiers = new_tiers();

    let base_entry = |id: &str| PlannedComponent {
        node_id: id.to_string(),
        motion: Motion::None,
        confidence: Some("high".to_string()),
        removal_direction: None,
        blocked_by: Vec::new(),
        tier: Some("base".to_string()),
        verified: false,
        group_id: None,
    };

    let _timing = std::env::var("ASSEMBLER_TIMING").is_ok();
    let (mut t_p1, mut t_p2, mut t_p3, mut t_p4, mut t_p5) = (0.0f64, 0.0, 0.0, 0.0, 0.0);

    // Wilson-style blocked memo (the NDBG insight as exact memoization): a part
    // that failed its removal search stays failed until something that could
    // possibly unblock it leaves the world — a watched neighbor is removed, or
    // the assembly bounds shrink (which shortens exit travels and can clear a
    // path all by itself). Skipping re-tests of still-blocked parts turns the
    // O(rounds x remaining) re-search into near O(remaining) without changing a
    // single verdict. Keyed per phase: a phase-1 failure says nothing about
    // escape, so each memoizes independently (escape's wander reach is larger).
    let mut blocked_p1: HashMap<String, HashSet<String>> = HashMap::new();
    let mut blocked_p2: HashMap<String, HashSet<String>> = HashMap::new();
    // Frozen parts (immobile from their seat). Unlike blocked_p2 this is NOT
    // cleared on a bounds change — a frozen part is held by an adjacent
    // neighbor, not by the exit distance, so only a watched neighbor's removal
    // can free it. Populated as a free byproduct of the escape search.
    let mut frozen: HashMap<String, HashSet<String>> = HashMap::new();
    let mut bounds_epoch: Option<(Vector3<f64>, Vector3<f64>)> = None;
    let (mut memo_skips_p1, mut memo_skips_p2) = (0usize, 0usize);
    let watch_margin = tolerance + 2.0 * MAX_SAMPLE_SPACING_MM;

    let mut progressed = true;
    while !remaining.is_empty() && progressed {
        progressed = false;
        let _ts = std::time::Instant::now();

        // Bounds shrink when an extremal part leaves; exit_travel shrinks with
        // them, which can clear a previously-blocked path without any watched
        // part being removed — the memo cannot survive that.
        {
            let refs: Vec<&Component> = remaining.values().collect();
            let bounds = bounds_over(&refs);
            let changed = bounds_epoch
                .map(|(lo, hi)| lo != bounds.0 || hi != bounds.1)
                .unwrap_or(true);
            if changed {
                blocked_p1.clear();
                blocked_p2.clear();
                bounds_epoch = Some(bounds);
            }
        }

        // Phase 1: straight-line / L removal. Candidates are evaluated in
        // parallel; the first-in-priority success is taken (identical to the
        // sequential break-on-first — each eval is a pure read-only sweep).
        // Memoized-blocked parts are skipped: their verdict provably cannot
        // have changed, so the filtered first-success is the same first-success.
        let order = removal_priority(&remaining, fasteners, &centroid, assembly_diagonal);
        if remaining.len() == 1 {
            let id = order.into_iter().next().unwrap();
            remaining.remove(&id);
            world.set_active(&id, false);
            removal_order.push(base_entry(&id));
            progressed = true;
        } else {
            memo_skips_p1 += order.iter().filter(|id| blocked_p1.contains_key(*id)).count();
            let tryable: Vec<String> = order
                .into_iter()
                .filter(|id| !blocked_p1.contains_key(id))
                .collect();
            let result = par_first_success(
                &tryable,
                &remaining,
                &world,
                Some(&full_world),
                |part, others, w, fw| {
                    plan_removal(
                        part,
                        &remaining,
                        others,
                        w,
                        fw,
                        _clearance,
                        path_samples,
                        fasteners,
                        tolerance,
                    )
                },
            );
            // Everything before the first success (or everything, on a full
            // fail) was evaluated and failed — memoize those verdicts.
            let failed_upto = result.as_ref().map(|(i, _)| *i).unwrap_or(tryable.len());
            for id in &tryable[..failed_upto] {
                let part = &remaining[id];
                let reach = (part.bbox_max - part.bbox_min).norm().max(1.0) + watch_margin;
                blocked_p1.insert(
                    id.clone(),
                    blocked_watch_set(part, &remaining, fasteners, reach, assembly_diagonal),
                );
            }
            if let Some((i, p)) = result {
                let id = tryable[i].clone();
                let key = if p.tier.as_deref() == Some("linear") {
                    "linear"
                } else {
                    "l"
                };
                *tiers.get_mut(key).unwrap() += 1;
                removal_order.push(p);
                remaining.remove(&id);
                world.set_active(&id, false);
                blocked_memo_invalidate(&mut blocked_p1, &id);
                blocked_memo_invalidate(&mut blocked_p2, &id);
                blocked_memo_invalidate(&mut frozen, &id);
                progressed = true;
            }
        }

        t_p1 += _ts.elapsed().as_secs_f64();
        let _ts = std::time::Instant::now();
        // Phase 2: tier-3 escape (parallel candidate evaluation, first success).
        if !progressed && remaining.len() > 1 {
            let order = removal_priority(&remaining, fasteners, &centroid, assembly_diagonal);
            memo_skips_p2 += order
                .iter()
                .filter(|id| blocked_p2.contains_key(*id) || frozen.contains_key(*id))
                .count();
            // Skip both the (bounds-sensitive) escape memo and the
            // (neighbor-sensitive) frozen cache. A frozen part never wins the
            // first-success, so excluding it can't change which part wins.
            let tryable: Vec<String> = order
                .into_iter()
                .filter(|id| !blocked_p2.contains_key(id) && !frozen.contains_key(id))
                .collect();
            // Fan the candidates across cores and take the first-in-priority
            // escape, exactly like the other phases (find_map_first cancels the
            // rest once the lowest surviving index is found). The frozen flag
            // rides the escape's own root node, so each worker records its
            // verdict into a per-candidate atomic bit — a free byproduct,
            // collected lock-free with no separate immobility pass.
            let frozen_flags: Vec<std::sync::atomic::AtomicBool> =
                (0..tryable.len()).map(|_| std::sync::atomic::AtomicBool::new(false)).collect();
            let winner = {
                use rayon::prelude::*;
                use std::sync::atomic::Ordering::Relaxed;
                (0..tryable.len()).into_par_iter().find_map_first(|i| {
                    let id = &tryable[i];
                    let others: Vec<&Component> =
                        remaining.values().filter(|c| &c.node_id != id).collect();
                    let (res, is_frozen) = plan_escape_annotated(
                        &remaining[id],
                        &others,
                        &world,
                        path_samples,
                        fasteners,
                        tolerance,
                    );
                    if is_frozen {
                        frozen_flags[i].store(true, Relaxed);
                    }
                    res.map(|p| (i, p))
                })
            };
            let is_frozen_at =
                |i: usize| frozen_flags[i].load(std::sync::atomic::Ordering::Relaxed);
            let failed_upto = winner.as_ref().map(|(i, _)| *i).unwrap_or(tryable.len());
            // Cache every frozen verdict found (persist across bounds epochs);
            // memoize the non-frozen failures below the winner into the
            // bounds-sensitive escape memo, as before.
            for (i, id) in tryable.iter().enumerate() {
                if !is_frozen_at(i) {
                    continue;
                }
                let part = &remaining[id];
                let hop_cap = (part.bbox_max - part.bbox_min).norm().max(1.0) * 1.5;
                frozen.insert(
                    id.clone(),
                    blocked_watch_set(part, &remaining, fasteners, watch_margin, hop_cap),
                );
            }
            for (i, id) in tryable[..failed_upto].iter().enumerate() {
                if is_frozen_at(i) {
                    continue;
                }
                let part = &remaining[id];
                // Escape wanders up to MAX_ESCAPE_SEGMENTS hops of 1.5x the part
                // diagonal before its exit sweep — the watch region reaches that
                // much further than phase 1's single hop.
                let reach = (MAX_ESCAPE_SEGMENTS as f64)
                    * 1.5
                    * (part.bbox_max - part.bbox_min).norm().max(1.0)
                    + watch_margin;
                blocked_p2.insert(
                    id.clone(),
                    blocked_watch_set(part, &remaining, fasteners, reach, assembly_diagonal),
                );
            }
            if let Some((i, p)) = winner {
                let id = tryable[i].clone();
                *tiers.get_mut("escape").unwrap() += 1;
                removal_order.push(p);
                remaining.remove(&id);
                world.set_active(&id, false);
                blocked_memo_invalidate(&mut blocked_p1, &id);
                blocked_memo_invalidate(&mut blocked_p2, &id);
                blocked_memo_invalidate(&mut frozen, &id);
                progressed = true;
            }
        }

        t_p2 += _ts.elapsed().as_secs_f64();
        let _ts = std::time::Instant::now();
        // Phase 3: single-blocker rigid merge.
        if !progressed && remaining.len() > 1 {
            let order = removal_priority(&remaining, fasteners, &centroid, assembly_diagonal);
            for id in order.into_iter().take(8) {
                if sandwiched.contains(&id) {
                    continue;
                }
                if protected.map(|p| p.contains(&id)).unwrap_or(false) {
                    continue;
                }
                // The presumptive base neither merges into anything nor
                // absorbs stuck parts (see base_candidate above) — otherwise
                // the whole frame collapses into one step.
                if base_candidate.as_deref() == Some(id.as_str()) {
                    continue;
                }
                let cached_ok = stuck_blockers_cache
                    .get(&id)
                    .map(|c| c.iter().all(|b| remaining.contains_key(b)))
                    .unwrap_or(false);
                let blockers = if cached_ok {
                    stuck_blockers_cache[&id].clone()
                } else {
                    // The part's BEST (least-blocked) escape direction decides the
                    // merge: a part whose best direction has exactly one blocker
                    // merges with it, even when other directions add more blockers
                    // to the union (panel pairs, servo/mount and nut/bolt clusters).
                    let b: Vec<String> = {
                        let part = &remaining[&id];
                        let others: Vec<&Component> =
                            remaining.values().filter(|c| c.node_id != id).collect();
                        escape_blockers_by_direction(
                            part,
                            &remaining,
                            &others,
                            &world,
                            fasteners,
                            tolerance,
                            path_samples,
                        )
                        .into_iter()
                        .filter(|(_, _, b)| !b.is_empty())
                        .min_by_key(|(_, _, b)| b.len())
                        .map(|(_, _, b)| b.into_iter().take(8).collect())
                        .unwrap_or_default()
                    };
                    stuck_blockers_cache.insert(id.clone(), b.clone());
                    b
                };
                if blockers.len() != 1 {
                    continue;
                }
                let host_id = blockers[0].clone();
                if !remaining.contains_key(&host_id) || sandwiched.contains(&host_id) {
                    continue;
                }
                if base_candidate.as_deref() == Some(host_id.as_str()) {
                    continue;
                }
                if protected.map(|p| p.contains(&host_id)).unwrap_or(false) {
                    continue;
                }
                let part = remaining[&id].clone();
                let host = remaining[&host_id].clone();
                let combined_mesh = crate::types::Mesh::concatenate(&[&host.mesh, &part.mesh]);
                let mut merged_allowance = part.seated_allowance.clone();
                for (k, v) in &host.seated_allowance {
                    merged_allowance.insert(k.clone(), *v);
                }
                let mut merged_axes = part.seated_allowance_axes.clone();
                for (k, v) in &host.seated_allowance_axes {
                    merged_axes.insert(k.clone(), *v);
                }
                merged_allowance.remove(&host.node_id);
                merged_allowance.remove(&part.node_id);
                merged_axes.remove(&host.node_id);
                merged_axes.remove(&part.node_id);
                let mut combined = Component::new(
                    host.node_id.clone(),
                    host.name.clone(),
                    combined_mesh,
                    host.bbox_min.inf(&part.bbox_min),
                    host.bbox_max.sup(&part.bbox_max),
                    host.is_proxy || part.is_proxy,
                );
                combined.cached_volume = Some(part_volume(&host) + part_volume(&part));
                combined.seated_allowance = merged_allowance;
                combined.seated_allowance_axes = merged_axes;
                warnings.push(format!(
                    "'{}' cannot separate from '{}'; planned as one rigid unit",
                    if part.name.is_empty() {
                        &part.node_id
                    } else {
                        &part.name
                    },
                    if host.name.is_empty() {
                        &host_id
                    } else {
                        &host.name
                    },
                ));
                world.set_active(&id, false);
                world.set_active(&host_id, false);
                remaining.remove(&id);
                world.add(&host_id, &combined);
                remaining.insert(host_id.clone(), combined);
                late_merges.insert(id.clone(), host_id.clone());
                // The member left and the host's geometry changed — both must
                // fall out of the blocked memos (the grown host can only add
                // blockage, but its own cached verdict is stale).
                for memo in [&mut blocked_p1, &mut blocked_p2, &mut frozen] {
                    blocked_memo_invalidate(memo, &id);
                    blocked_memo_invalidate(memo, &host_id);
                }
                progressed = true;
                break;
            }
            if progressed {
                continue;
            }
        }

        t_p3 += _ts.elapsed().as_secs_f64();
        let _ts = std::time::Instant::now();
        // Phase 4: subassembly extraction.
        if !progressed && remaining.len() > 2 {
            let mut group = plan_group_removal(
                &remaining,
                &mut world,
                path_samples,
                fasteners,
                &mut group_mesh_cache,
                tolerance,
                deep_bitten,
            );
            if let Some((members, _, _)) = &group {
                if let Some(p) = protected {
                    if members.iter().any(|m| p.contains(m)) {
                        group = None;
                    }
                }
            }
            if let Some((members, combined, entry)) = group {
                for member_id in &members {
                    remaining.remove(member_id);
                    world.set_active(member_id, false);
                    for memo in [&mut blocked_p1, &mut blocked_p2, &mut frozen] {
                        blocked_memo_invalidate(memo, member_id);
                    }
                }
                let rep = entry.node_id.clone();
                removal_order.push(entry);
                group_units.insert(rep, (combined, members));
                *tiers.get_mut("group").unwrap() += 1;
                progressed = true;
                continue;
            }
        }

        t_p4 += _ts.elapsed().as_secs_f64();
        let _ts = std::time::Instant::now();
        // Phase 5: flag.
        if !progressed && remaining.len() > 1 {
            let id =
                removal_priority(&remaining, fasteners, &centroid, assembly_diagonal)[0].clone();
            let blocked_by = {
                let part = &remaining[&id];
                let others: Vec<&Component> =
                    remaining.values().filter(|c| c.node_id != id).collect();
                let eb = escape_blockers(
                    part,
                    &remaining,
                    &others,
                    &world,
                    fasteners,
                    tolerance,
                    path_samples,
                );
                if eb.is_empty() {
                    bbox_blockers(part, &remaining)
                } else {
                    eb
                }
            };
            let name = {
                let part = &remaining[&id];
                if part.name.is_empty() {
                    id.clone()
                } else {
                    part.name.clone()
                }
            };
            warnings.push(format!(
                "'{name}' has no collision-free escape; flagged for review — it fades in during playback"
            ));
            // ASSEMBLER_EXPLAIN=1: autopsy every flag — per candidate direction,
            // how far it could exit and exactly who blocks it. Quality work is
            // aimed at this output ("minimize manual intervention"), so the
            // failure reasons must be inspectable, not inferred.
            if std::env::var("ASSEMBLER_EXPLAIN").is_ok() {
                let part = &remaining[&id];
                let others: Vec<&Component> =
                    remaining.values().filter(|c| c.node_id != id).collect();
                let (smin, smax) = bounds_over(&others);
                let info = fasteners.get(&id);
                let dirs = if is_fastener(part) && info.is_some() {
                    let h = head_direction(part, info.unwrap(), Some(&remaining));
                    vec![h, -h]
                } else {
                    candidate_directions(part)
                };
                eprintln!(
                    "EXPLAIN flag {name} ({id}) remaining={} fastener={} dirs={}",
                    remaining.len(),
                    info.is_some(),
                    dirs.len()
                );
                let mut extra: Exempt = HashMap::new();
                extra.insert(id.clone(), f64::INFINITY);
                for d in &dirs {
                    let travel = exit_travel(part, &smin, &smax, d, None);
                    if travel <= 0.0 {
                        eprintln!(
                            "  dir=[{:+.2},{:+.2},{:+.2}] travel=0 (inside bounds)",
                            d[0], d[1], d[2]
                        );
                        continue;
                    }
                    let blockers = path_blockers(
                        part,
                        &world,
                        &[(*d, travel)],
                        (path_samples / 3).max(12),
                        fasteners,
                        Some(&extra),
                        tolerance,
                    );
                    let names: Vec<String> = blockers
                        .iter()
                        .map(|b| {
                            remaining
                                .get(b)
                                .map(|p| {
                                    if p.name.is_empty() {
                                        b.clone()
                                    } else {
                                        p.name.clone()
                                    }
                                })
                                .unwrap_or_else(|| b.clone())
                        })
                        .collect();
                    eprintln!(
                        "  dir=[{:+.2},{:+.2},{:+.2}] travel={travel:.1} blockers={names:?}",
                        d[0], d[1], d[2]
                    );
                }
            }
            removal_order.push(PlannedComponent {
                node_id: id.clone(),
                motion: Motion::None,
                confidence: Some("low".to_string()),
                removal_direction: None,
                blocked_by,
                tier: Some("flagged".to_string()),
                verified: false,
                group_id: None,
            });
            *tiers.get_mut("flagged").unwrap() += 1;
            remaining.remove(&id);
            world.set_active(&id, false);
            for memo in [&mut blocked_p1, &mut blocked_p2, &mut frozen] {
                blocked_memo_invalidate(memo, &id);
            }
            progressed = true;
        }
        t_p5 += _ts.elapsed().as_secs_f64();
    }
    if _timing {
        eprintln!("    greedy phases: p1_removal={:.1}s p2_escape={:.1}s p3_merge={:.1}s p4_group={:.1}s p5_flag={:.1}s memo_skips p1={memo_skips_p1} p2={memo_skips_p2}", t_p1, t_p2, t_p3, t_p4, t_p5);
    }

    let sequence: Vec<String> = removal_order
        .iter()
        .rev()
        .map(|e| e.node_id.clone())
        .collect();
    (removal_order, sequence, tiers)
}
