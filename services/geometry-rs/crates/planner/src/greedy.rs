//! Greedy disassembly + tier-1/2/3 motion search + subassembly extraction —
//! 1:1 port of `_plan_removal`, `_plan_escape`, `_plan_group_removal`,
//! `_escape_blockers`, `_blockers`, `_greedy_disassembly` from `app/plan.py`.

use crate::collide::*;
use crate::consts::*;
use crate::fasteners::{head_direction, is_fastener};
use crate::geom::*;
use crate::types::{Component, FastenerInfo, Motion, MotionSegment, PlannedComponent};
use nalgebra::Vector3;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

pub type Tiers = BTreeMap<String, i64>;

pub fn new_tiers() -> Tiers {
    let mut t = BTreeMap::new();
    for k in ["linear", "l", "escape", "group", "flagged", "forced", "unplanned"] {
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
        let separation =
            separation_distance(&part.bbox_min, &part.bbox_max, &static_min, &static_max, direction);
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
            clear.push((index, *direction, recorded_travel(part, direction, travel, lt)));
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
            motion: Motion::Linear { direction: neg(&direction), distance: recorded },
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
        if path_is_clear(part, world, &first, 0.0, hop, samples_segment, tolerance, None, Some(exempt), None)
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
                            MotionSegment { direction: neg(&first), distance: round_py(hop, 3) },
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
fn removal_segments_to_planned(part: &Component, removal: &[(Vector3<f64>, f64)]) -> PlannedComponent {
    let first_direction = removal[0].0;
    let motion = if removal.len() == 1 {
        let (direction, distance) = removal[0];
        Motion::Linear { direction: neg(&direction), distance: round_py(distance, 3) }
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
    if others.is_empty() {
        return None;
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
                    return Some(removal_segments_to_planned(part, &removal));
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
    None
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
    blockers.into_iter().take(8).collect()
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
    out.truncate(8);
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
pub fn plan_group_removal(
    remaining: &HashMap<String, Component>,
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
    let mut adjacency: HashMap<String, HashSet<String>> =
        parts.iter().map(|p| (p.node_id.clone(), HashSet::new())).collect();
    for i in 0..parts.len() {
        for j in (i + 1)..parts.len() {
            let a = parts[i];
            let b = parts[j];
            let close = (0..3).all(|k| a.bbox_min[k] - GROUP_PROXIMITY_MM <= b.bbox_max[k])
                && (0..3).all(|k| b.bbox_min[k] - GROUP_PROXIMITY_MM <= a.bbox_max[k]);
            if close {
                adjacency.get_mut(&a.node_id).unwrap().insert(b.node_id.clone());
                adjacency.get_mut(&b.node_id).unwrap().insert(a.node_id.clone());
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
                ka.0
                    .cmp(&kb.0)
                    .then(ka.1.partial_cmp(&kb.1).unwrap())
                    .then(ka.2.cmp(&kb.2))
            });
            let chosen = remaining[&neighbor_ids[0]].clone();
            member_ids.insert(chosen.node_id.clone());
            members.push(chosen);
            if members.len() >= remaining.len() {
                break;
            }

            let others: Vec<&Component> =
                parts.iter().filter(|p| !member_ids.contains(&p.node_id)).copied().collect();
            let (static_min, static_max) = bounds_over(&others);
            let world = CollisionWorld::new(&others);

            let cache_key: BTreeSet<String> = member_ids.iter().cloned().collect();
            let combined = combined_cache.entry(cache_key).or_insert_with(|| {
                let member_refs: Vec<&crate::types::Mesh> = members.iter().map(|m| &m.mesh).collect();
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
                let name = members.iter().map(|m| m.name.clone()).collect::<Vec<_>>().join(" + ");
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
                    group_exempt(&members.iter().collect::<Vec<_>>(), direction, fasteners, &member_ids),
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
    let mut ids: Vec<String> = remaining.keys().cloned().collect();
    ids.sort_by(|a, b| {
        let pa = &remaining[a];
        let pb = &remaining[b];
        let (va, ba) = structural_key(pa, centroid, diagonal);
        let (vb, bb) = structural_key(pb, centroid, diagonal);
        // Fasteners first (0), then negate each structural-key component
        // (Python: `0 if fastener else 1`, then `tuple(-c for c in key)`).
        let fa = if fasteners.contains_key(a) { 0 } else { 1 };
        let fb = if fasteners.contains_key(b) { 0 } else { 1 };
        let ka = (fa, -va, -ba);
        let kb = (fb, -vb, -bb);
        ka.0
            .cmp(&kb.0)
            .then(ka.1.partial_cmp(&kb.1).unwrap())
            .then(ka.2.partial_cmp(&kb.2).unwrap())
            .then(a.cmp(b))
    });
    ids
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
    let mut remaining: HashMap<String, Component> =
        parts.iter().map(|p| (p.node_id.clone(), p.clone())).collect();

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

    // Persistent broadphase managers reused across the whole greedy loop
    // (Python keeps one). `world` mirrors `remaining` (parts set inactive on
    // removal); `full_world` holds every part always. The moving part is
    // excluded per-query by index, so no per-sweep rebuild or unregister.
    let mut world = CollisionWorld::from_components(parts);
    let full_world = CollisionWorld::from_components(parts);

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

    let _timing = std::env::var("GEOMETRY_TIMING").is_ok();
    let (mut t_p1, mut t_p2, mut t_p3, mut t_p4, mut t_p5) = (0.0f64, 0.0, 0.0, 0.0, 0.0);
    let mut progressed = true;
    while !remaining.is_empty() && progressed {
        progressed = false;
        let _ts = std::time::Instant::now();

        // Phase 1: straight-line / L removal.
        for id in removal_priority(&remaining, fasteners, &centroid, assembly_diagonal) {
            if remaining.len() == 1 {
                remaining.remove(&id);
                world.set_active(&id, false);
                removal_order.push(base_entry(&id));
                progressed = true;
                break;
            }
            let planned = {
                let part = &remaining[&id];
                let others: Vec<&Component> =
                    remaining.values().filter(|c| c.node_id != id).collect();
                plan_removal(
                    part,
                    &remaining,
                    &others,
                    &world,
                    Some(&full_world),
                    _clearance,
                    path_samples,
                    fasteners,
                    tolerance,
                )
            };
            if let Some(p) = planned {
                let key = if p.tier.as_deref() == Some("linear") { "linear" } else { "l" };
                *tiers.get_mut(key).unwrap() += 1;
                removal_order.push(p);
                remaining.remove(&id);
                world.set_active(&id, false);
                progressed = true;
                break;
            }
        }

        t_p1 += _ts.elapsed().as_secs_f64();
        let _ts = std::time::Instant::now();
        // Phase 2: tier-3 escape.
        if !progressed && remaining.len() > 1 {
            for id in removal_priority(&remaining, fasteners, &centroid, assembly_diagonal) {
                let planned = {
                    let part = &remaining[&id];
                    let others: Vec<&Component> =
                        remaining.values().filter(|c| c.node_id != id).collect();
                    plan_escape(part, &others, &world, path_samples, fasteners, tolerance)
                };
                if let Some(p) = planned {
                    *tiers.get_mut("escape").unwrap() += 1;
                    removal_order.push(p);
                    remaining.remove(&id);
                    world.set_active(&id, false);
                    progressed = true;
                    break;
                }
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
                let cached_ok = stuck_blockers_cache
                    .get(&id)
                    .map(|c| c.iter().all(|b| remaining.contains_key(b)))
                    .unwrap_or(false);
                let blockers = if cached_ok {
                    stuck_blockers_cache[&id].clone()
                } else {
                    let b = {
                        let part = &remaining[&id];
                        let others: Vec<&Component> =
                            remaining.values().filter(|c| c.node_id != id).collect();
                        escape_blockers(part, &remaining, &others, &world, fasteners, tolerance, path_samples)
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
                    if part.name.is_empty() { &part.node_id } else { &part.name },
                    if host.name.is_empty() { &host_id } else { &host.name },
                ));
                world.set_active(&id, false);
                world.set_active(&host_id, false);
                remaining.remove(&id);
                world.add(&host_id, &combined);
                remaining.insert(host_id.clone(), combined);
                late_merges.insert(id.clone(), host_id.clone());
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
            let id = removal_priority(&remaining, fasteners, &centroid, assembly_diagonal)[0].clone();
            let blocked_by = {
                let part = &remaining[&id];
                let others: Vec<&Component> =
                    remaining.values().filter(|c| c.node_id != id).collect();
                let eb = escape_blockers(part, &remaining, &others, &world, fasteners, tolerance, path_samples);
                if eb.is_empty() {
                    bbox_blockers(part, &remaining)
                } else {
                    eb
                }
            };
            let name = {
                let part = &remaining[&id];
                if part.name.is_empty() { id.clone() } else { part.name.clone() }
            };
            warnings.push(format!(
                "'{name}' has no collision-free escape; flagged for review — it fades in during playback"
            ));
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
            progressed = true;
        }
        t_p5 += _ts.elapsed().as_secs_f64();
    }
    if _timing {
        eprintln!("    greedy phases: p1_removal={:.1}s p2_escape={:.1}s p3_merge={:.1}s p4_group={:.1}s p5_flag={:.1}s", t_p1, t_p2, t_p3, t_p4, t_p5);
    }

    let sequence: Vec<String> = removal_order.iter().rev().map(|e| e.node_id.clone()).collect();
    (removal_order, sequence, tiers)
}
