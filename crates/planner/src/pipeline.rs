//! Ordering pipeline, part 1: seated pair depths, fastener/sandwich
//! classification, rigid merge, joints, and ordering adjacency.
//! (Precedence edges, topo sort, verification, and the drivers are in pipeline2.)

use crate::consts::*;
use crate::contains::mesh_contains;
use crate::fasteners::{axis_span, is_fastener};
use crate::geom::*;
use crate::types::{Component, FastenerInfo, FastenerKind};
use nalgebra::{Matrix3, Vector3};
use std::collections::{BTreeMap, HashMap, HashSet};

pub fn pair_key(a: &str, b: &str) -> (String, String) {
    if a <= b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}

#[derive(Clone)]
pub struct PairData {
    pub a: String,
    pub b: String,
    pub depth: f64,
    pub points: Vec<Vector3<f64>>,
    pub normals: Vec<Vector3<f64>>,
    pub tensor: Matrix3<f64>,
}

impl PairData {
    pub fn other(&self, id: &str) -> &str {
        if self.a == id {
            &self.b
        } else {
            &self.a
        }
    }
}

pub type PairDepths = HashMap<(String, String), PairData>;

/// Max depth + capped contact points/normals + structure tensor per touching
/// pair, over the broadphase all-pairs contact set. `points`/`normals` are
/// capped at the first 64 in traversal order, feeding sandwich-side means,
/// fastener ring-axis fits, and support normals.
pub fn seated_pair_depths(parts: &[Component]) -> PairDepths {
    let mut mgr = collision::manager_new();
    for p in parts {
        collision::manager_add(mgr.pin_mut(), &p.bvh());
    }
    collision::manager_setup(mgr.pin_mut());
    let contacts = collision::manager_internal_contacts(&mgr, 100_000);

    let mut pairs: PairDepths = HashMap::new();
    for c in &contacts {
        let pa = &parts[c.a];
        let pb = &parts[c.b];
        let (lo, hi) = if pa.node_id <= pb.node_id {
            (pa, pb)
        } else {
            (pb, pa)
        };
        let entry = pairs
            .entry(pair_key(&lo.node_id, &hi.node_id))
            .or_insert_with(|| PairData {
                a: lo.node_id.clone(),
                b: hi.node_id.clone(),
                depth: 0.0,
                points: Vec::new(),
                normals: Vec::new(),
                tensor: Matrix3::zeros(),
            });
        entry.depth = entry.depth.max(c.depth);
        if entry.points.len() < 64 {
            entry.points.push(Vector3::new(c.px, c.py, c.pz));
            entry.normals.push(Vector3::new(c.nx, c.ny, c.nz));
        }
        let normal = Vector3::new(c.nx, c.ny, c.nz);
        let len = normal.norm();
        if len > 1e-9 {
            let u = normal / len;
            entry.tensor += u * u.transpose();
        }
    }
    pairs
}

fn center(part: &Component) -> Vector3<f64> {
    (part.bbox_min + part.bbox_max) / 2.0
}

/// `_shank_radius`.
fn shank_radius(
    part: &Component,
    axis: &Vector3<f64>,
    mate_points: &[Vector3<f64>],
) -> Option<f64> {
    let c = center(part);
    let radial = |p: &Vector3<f64>| {
        let rel = p - c;
        (rel - axis * rel.dot(axis)).norm()
    };
    let radius = if mate_points.len() >= 8 {
        let vals: Vec<f64> = mate_points.iter().map(radial).collect();
        crate::npy::mean(&vals)
    } else {
        let verts = &part.mesh.vertices;
        if verts.len() < 8 {
            return None;
        }
        let vals: Vec<f64> = verts.iter().map(radial).collect();
        crate::npy::percentile25(&vals)
    };
    if radius <= 0.2 {
        None
    } else {
        Some(radius)
    }
}

/// `_classify_fasteners`.
pub fn classify_fasteners(
    parts: &[Component],
    pair_depths: &PairDepths,
) -> HashMap<String, FastenerInfo> {
    let refs: Vec<&Component> = parts.iter().collect();
    let (amin, amax) = bounds(&refs);
    let assembly_diagonal = (amax - amin).norm();
    let max_extent = MAX_FASTENER_EXTENT_MM.max(MAX_FASTENER_DIAGONAL_FRACTION * assembly_diagonal);

    let mut fasteners = HashMap::new();
    for part in parts {
        if !is_fastener(part) {
            continue;
        }
        if (part.bbox_max - part.bbox_min).norm() > max_extent {
            continue;
        }
        let mut mates: HashMap<String, f64> = HashMap::new();
        let mut mate_points: Vec<Vector3<f64>> = Vec::new();
        let mut all_points: Vec<Vector3<f64>> = Vec::new();
        // Deterministic pair iteration (sorted) for stable point order.
        let mut keys: Vec<&(String, String)> = pair_depths.keys().collect();
        keys.sort();
        for k in keys {
            let data = &pair_depths[k];
            if data.a != part.node_id && data.b != part.node_id {
                continue;
            }
            all_points.extend(data.points.iter().cloned());
            if data.depth > MATE_MIN_DEPTH_MM {
                let other = data.other(&part.node_id).to_string();
                mates.insert(other, data.depth);
                mate_points.extend(data.points.iter().cloned());
            }
        }

        let axis_kind = symmetry_axis_kind(part).or_else(|| bbox_axis_kind(part));
        let (axis, kind): (Vector3<f64>, Option<FastenerKind>) = match axis_kind {
            Some((a, k)) => (a, Some(k)),
            None => {
                let ring = axis_from_contacts(&mate_points)
                    .or_else(|| axis_from_contacts(&all_points))
                    .or_else(|| normal_clusters(&part.contact_normals, 1).into_iter().next());
                match ring {
                    Some(a) => (a, None),
                    None => continue,
                }
            }
        };
        let sr = shank_radius(part, &axis, &mate_points);
        fasteners.insert(
            part.node_id.clone(),
            FastenerInfo {
                axis,
                mates,
                kind,
                shank_radius: sr,
                sliding: HashMap::new(),
            },
        );
    }
    fasteners
}

pub fn bounds(parts: &[&Component]) -> (Vector3<f64>, Vector3<f64>) {
    let mut lo = Vector3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY);
    let mut hi = Vector3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in parts {
        lo = lo.inf(&p.bbox_min);
        hi = hi.sup(&p.bbox_max);
    }
    (lo, hi)
}

/// `_embedded_pairs`: (inner, outer) where inner sits fully inside outer.
pub fn embedded_pairs(parts: &[Component]) -> Vec<(String, String)> {
    let epsilon = 0.01;
    let mut out = Vec::new();
    for inner in parts {
        for outer in parts {
            if inner.node_id == outer.node_id {
                continue;
            }
            let contained = (0..3).all(|i| inner.bbox_min[i] >= outer.bbox_min[i] - epsilon)
                && (0..3).all(|i| inner.bbox_max[i] <= outer.bbox_max[i] + epsilon);
            if !contained {
                continue;
            }
            let verts = &inner.mesh.vertices;
            if verts.is_empty() {
                continue;
            }
            let step = (verts.len() / 24).max(1);
            let sample: Vec<Vector3<f64>> = verts.iter().step_by(step).take(24).cloned().collect();
            let inside = mesh_contains(&outer.mesh, &sample);
            let frac = inside.iter().filter(|&&b| b).count() as f64 / inside.len() as f64;
            if frac > 0.8 {
                out.push((inner.node_id.clone(), outer.node_id.clone()));
            }
        }
    }
    out
}

/// `_merge_rigid_groups`: union-find over embedded (contained) pairs.
pub fn merge_rigid_groups(
    parts: &[Component],
    _pair_depths: &PairDepths,
    fasteners: &HashMap<String, FastenerInfo>,
    warnings: &mut Vec<String>,
) -> (Vec<Component>, HashMap<String, String>) {
    let mut parent: HashMap<String, String> = parts
        .iter()
        .map(|p| (p.node_id.clone(), p.node_id.clone()))
        .collect();
    fn find(parent: &mut HashMap<String, String>, x: &str) -> String {
        let mut cur = x.to_string();
        while parent[&cur] != cur {
            let gp = parent[&parent[&cur]].clone();
            parent.insert(cur.clone(), gp.clone());
            cur = gp;
        }
        cur
    }
    for (inner, outer) in embedded_pairs(parts) {
        let ra = find(&mut parent, &inner);
        let rb = find(&mut parent, &outer);
        if ra != rb {
            parent.insert(rb, ra);
        }
    }

    let by_id: HashMap<&str, &Component> = parts.iter().map(|p| (p.node_id.as_str(), p)).collect();
    let mut clusters: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let ids: Vec<String> = parts.iter().map(|p| p.node_id.clone()).collect();
    for id in &ids {
        let root = find(&mut parent, id);
        clusters.entry(root).or_default().push(id.clone());
    }

    let bbox_vol = |p: &Component| {
        let e = p.bbox_max - p.bbox_min;
        (e[0] * e[1] * e[2]).abs()
    };

    let mut units: Vec<Component> = Vec::new();
    let mut merged_into: HashMap<String, String> = HashMap::new();
    // Preserve input order of representatives for determinism.
    let mut seen_roots: Vec<String> = Vec::new();
    for id in &ids {
        let root = find(&mut parent, id);
        if !seen_roots.contains(&root) {
            seen_roots.push(root);
        }
    }
    for root in seen_roots {
        let members_ids = &clusters[&root];
        let members: Vec<&Component> = members_ids.iter().map(|m| by_id[m.as_str()]).collect();
        if members.len() == 1 {
            units.push(members[0].clone());
            continue;
        }
        let rep = members
            .iter()
            .max_by(|a, b| {
                let ka = (fasteners.contains_key(&a.node_id) as i32, bbox_vol(a));
                let kb = (fasteners.contains_key(&b.node_id) as i32, bbox_vol(b));
                ka.0.cmp(&kb.0).then(ka.1.partial_cmp(&kb.1).unwrap())
            })
            .unwrap();
        let meshes: Vec<&crate::types::Mesh> = members.iter().map(|m| &m.mesh).collect();
        let combined_mesh = crate::types::Mesh::concatenate(&meshes);
        let (lo, hi) = bounds(&members);
        let mut combined = Component::new(
            rep.node_id.clone(),
            rep.name.clone(),
            combined_mesh,
            lo,
            hi,
            members.iter().any(|m| m.is_proxy),
        );
        combined.cached_volume = Some(members.iter().map(|m| part_volume(m)).sum());
        units.push(combined);
        for m in &members {
            if m.node_id != rep.node_id {
                merged_into.insert(m.node_id.clone(), rep.node_id.clone());
            }
        }
        let names: Vec<String> = members
            .iter()
            .map(|m| {
                format!(
                    "'{}'",
                    if m.name.is_empty() {
                        &m.node_id
                    } else {
                        &m.name
                    }
                )
            })
            .collect();
        warnings.push(format!(
            "{} interpenetrate when seated; planned as one rigid unit",
            names.join(", ")
        ));
    }
    (units, merged_into)
}

/// Largest eigenvector (by eigenvalue) of a symmetric 3x3 matrix — numpy
/// `eigh(...)[1][:, -1]`.
pub fn dominant_eigenvector(m: &Matrix3<f64>) -> Vector3<f64> {
    // numpy eigh (dsyevd): ascending eigenvalues, vectors as columns -> [:, -1]
    match crate::npy::eigh3(m) {
        Some((_w, vecs)) => vecs.column(2).into(),
        None => {
            let eig = m.symmetric_eigen();
            let mut best = 0;
            for i in 1..3 {
                if eig.eigenvalues[i] > eig.eigenvalues[best] {
                    best = i;
                }
            }
            eig.eigenvectors.column(best).into()
        }
    }
}

/// A sandwiched compliant part and its two sides.
pub struct SandwichInfo {
    pub axis: Vector3<f64>,
    pub side_a: HashSet<String>,
    pub side_b: HashSet<String>,
}

/// `_fastener_joints`: parts each fastener joins → projection along its axis.
pub fn fastener_joints(
    parts: &[Component],
    fasteners: &HashMap<String, FastenerInfo>,
) -> HashMap<String, HashMap<String, f64>> {
    let by_id: HashMap<&str, &Component> = parts.iter().map(|p| (p.node_id.as_str(), p)).collect();
    let mut joints: HashMap<String, HashMap<String, f64>> = HashMap::new();

    for part in parts {
        let info = match fasteners.get(&part.node_id) {
            Some(i) => i,
            None => continue,
        };
        let fid = &part.node_id;
        let center0 = center(part);
        let mut joint: HashMap<String, f64> = HashMap::new();
        for mate in info.mates.keys() {
            if let Some(mp) = by_id.get(mate.as_str()) {
                joint.insert(mate.clone(), (center(mp) - center0).dot(&info.axis));
            }
        }
        if let Some(radius) = info.shank_radius {
            let axis = info.axis;
            let c = center0;
            let seed = if axis.dot(&world_axes()[0]).abs() < 0.9 {
                world_axes()[0]
            } else {
                world_axes()[2]
            };
            let mut u = axis.cross(&seed);
            let un = u.norm();
            u /= if un == 0.0 { 1.0 } else { un };
            let v = axis.cross(&u);
            let ring_radii = [radius * 1.2, radius * 1.2 + 2.0];
            let ring_offsets: Vec<Vector3<f64>> = (0..8)
                .map(|i| {
                    let a = i as f64 * 2.0 * std::f64::consts::PI / 8.0;
                    u * a.cos() + v * a.sin()
                })
                .collect();
            let (f_lo, f_hi) = axis_span(part, &axis, &c);
            let max_radial = part
                .mesh
                .vertices
                .iter()
                .map(|p| {
                    let rel = p - c;
                    (rel - axis * rel.dot(&axis)).norm()
                })
                .fold(0.0, f64::max);
            let probe_cap = max_radial * 5.0 + 5.0;

            for other in parts {
                if other.node_id == *fid || joint.contains_key(&other.node_id) {
                    continue;
                }
                let inflate = probe_cap + 2.0;
                let near = (0..3).all(|k| part.bbox_min[k] - inflate <= other.bbox_max[k])
                    && (0..3).all(|k| other.bbox_min[k] - inflate <= part.bbox_max[k]);
                if !near {
                    continue;
                }
                let (o_lo, o_hi) = axis_span(other, &axis, &c);
                let lo = f_lo.max(o_lo);
                let hi = f_hi.min(o_hi);
                if hi - lo < 0.5 {
                    continue;
                }
                let mut probe_radii = ring_radii.to_vec();
                let mut probe_heights = vec![
                    lo + (hi - lo) * 0.5,
                    lo + (hi - lo) * 0.25,
                    lo + (hi - lo) * 0.75,
                ];
                let in_span: Vec<(&Vector3<f64>, f64)> = other
                    .mesh
                    .vertices
                    .iter()
                    .filter_map(|vtx| {
                        let proj = (vtx - c).dot(&axis);
                        if proj >= lo && proj <= hi {
                            Some((vtx, proj))
                        } else {
                            None
                        }
                    })
                    .collect();
                if in_span.len() >= 3 {
                    let mut min_radial = f64::INFINITY;
                    let mut rim_t = 0.0;
                    for (vtx, proj) in &in_span {
                        let rel = *vtx - c;
                        let r = (rel - axis * rel.dot(&axis)).norm();
                        if r < min_radial {
                            min_radial = r;
                            rim_t = *proj;
                        }
                    }
                    let adaptive = min_radial * 1.05 + 0.5;
                    if adaptive <= probe_cap {
                        probe_radii.push(adaptive);
                        probe_heights.push(rim_t.clamp(lo + 0.25, hi - 0.25));
                    }
                }

                let mut surrounded = false;
                let mut surround_t = 0.0;
                'outer: for t in &probe_heights {
                    for rr in &probe_radii {
                        let ring: Vec<Vector3<f64>> = ring_offsets
                            .iter()
                            .map(|o| c + axis * *t + o * *rr)
                            .collect();
                        let inside = mesh_contains(&other.mesh, &ring);
                        if !inside.is_empty() {
                            let frac =
                                inside.iter().filter(|&&b| b).count() as f64 / inside.len() as f64;
                            if frac >= 0.75 {
                                surrounded = true;
                                surround_t = *t;
                                break 'outer;
                            }
                        }
                    }
                }
                if surrounded {
                    joint.insert(other.node_id.clone(), surround_t);
                }
            }
        }
        joints.insert(fid.clone(), joint);
    }
    joints
}

/// `_sandwiched_parts`: thin parts pressed from both sides along one axis.
/// Mutates each partner's `seated_allowance` / `seated_allowance_axes`.
pub fn sandwiched_parts(
    units: &mut [Component],
    pair_depths: &PairDepths,
    fasteners: &HashMap<String, FastenerInfo>,
    merged_into: &HashMap<String, String>,
) -> HashMap<String, SandwichInfo> {
    let unit_ids: HashSet<String> = units.iter().map(|u| u.node_id.clone()).collect();
    // unit -> partner -> (tensor, points, depth)
    let mut contacts: HashMap<String, HashMap<String, (Matrix3<f64>, Vec<Vector3<f64>>, f64)>> =
        HashMap::new();
    let mut keys: Vec<&(String, String)> = pair_depths.keys().collect();
    keys.sort();
    for k in keys {
        let data = &pair_depths[k];
        let unit_a = merged_into
            .get(&data.a)
            .cloned()
            .unwrap_or_else(|| data.a.clone());
        let unit_b = merged_into
            .get(&data.b)
            .cloned()
            .unwrap_or_else(|| data.b.clone());
        if unit_a == unit_b || !unit_ids.contains(&unit_a) || !unit_ids.contains(&unit_b) {
            continue;
        }
        for (me, other) in [(&unit_a, &unit_b), (&unit_b, &unit_a)] {
            let slot = contacts
                .entry(me.clone())
                .or_default()
                .entry(other.clone())
                .or_insert_with(|| (Matrix3::zeros(), Vec::new(), 0.0));
            slot.0 += data.tensor;
            slot.1.extend(data.points.iter().cloned());
            slot.2 = slot.2.max(data.depth);
        }
    }

    let unit_by_id: HashMap<String, (Vector3<f64>, Vector3<f64>, bool)> = units
        .iter()
        .map(|u| (u.node_id.clone(), (u.bbox_min, u.bbox_max, u.is_proxy)))
        .collect();

    let mut result: HashMap<String, SandwichInfo> = HashMap::new();
    // (unit_id, partner_id, allowance, axis)
    let mut updates: Vec<(String, String, f64, Vector3<f64>)> = Vec::new();

    for unit in units.iter() {
        if unit.is_proxy || fasteners.contains_key(&unit.node_id) {
            continue;
        }
        let empty = HashMap::new();
        let all = contacts.get(&unit.node_id).unwrap_or(&empty);
        let mut partner_ids: Vec<&String> = all
            .iter()
            .filter(|(other, slot)| !fasteners.contains_key(*other) && !slot.1.is_empty())
            .map(|(other, _)| other)
            .collect();
        partner_ids.sort();
        if partner_ids.len() < 2 {
            continue;
        }
        let axes: Vec<Vector3<f64>> = partner_ids
            .iter()
            .map(|p| dominant_eigenvector(&all[*p].0))
            .collect();
        let axis = axes[0];
        if axes[1..]
            .iter()
            .any(|a| axis.dot(a).abs() < SANDWICH_AXIS_ALIGNMENT)
        {
            continue;
        }
        let extents = unit.bbox_max - unit.bbox_min;
        let thickness = crate::geom::vabs(&axis).dot(&extents);
        let max_extent = extents.iter().cloned().fold(f64::MIN, f64::max);
        if thickness > SANDWICH_MAX_THICKNESS_RATIO * max_extent {
            continue;
        }
        if thickness > SANDWICH_MAX_THICKNESS_MM {
            continue;
        }
        if partner_ids
            .iter()
            .any(|p| all[*p].2 > SANDWICH_MAX_SQUISH_MM)
        {
            continue;
        }
        let center_axis = axis.dot(&((unit.bbox_min + unit.bbox_max) / 2.0));
        let mut side_a: HashSet<String> = HashSet::new();
        let mut side_b: HashSet<String> = HashSet::new();
        for p in &partner_ids {
            let pts = &all[*p].1;
            let mean = crate::npy::mean_rows(pts);
            let m = axis.dot(&mean);
            if m < center_axis {
                side_a.insert((*p).clone());
            } else {
                side_b.insert((*p).clone());
            }
        }
        if side_a.is_empty() || side_b.is_empty() {
            continue;
        }
        for p in &partner_ids {
            let allowance = all[*p].2.max(0.0);
            updates.push((unit.node_id.clone(), (*p).clone(), allowance, axis));
            updates.push(((*p).clone(), unit.node_id.clone(), allowance, axis));
        }
        result.insert(
            unit.node_id.clone(),
            SandwichInfo {
                axis,
                side_a,
                side_b,
            },
        );
    }
    let _ = unit_by_id;

    // Apply allowance updates (max wins).
    let mut idx: HashMap<String, usize> = units
        .iter()
        .enumerate()
        .map(|(i, u)| (u.node_id.clone(), i))
        .collect();
    for (unit_id, partner, allowance, axis) in updates {
        if let Some(&i) = idx.get(&unit_id) {
            let cur = units[i]
                .seated_allowance
                .get(&partner)
                .cloned()
                .unwrap_or(0.0);
            if allowance > cur {
                units[i].seated_allowance.insert(partner.clone(), allowance);
                units[i].seated_allowance_axes.insert(partner, axis);
            }
        }
    }
    let _ = &mut idx;
    result
}

/// `_ordering_adjacency`: leaf-level "mates with" graph for ordering.
pub fn ordering_adjacency(
    parts: &[Component],
    pair_depths: &PairDepths,
    contact_mm: f64,
) -> HashMap<String, HashSet<String>> {
    let mut adjacency: HashMap<String, HashSet<String>> = parts
        .iter()
        .map(|p| (p.node_id.clone(), HashSet::new()))
        .collect();
    for data in pair_depths.values() {
        adjacency.get_mut(&data.a).unwrap().insert(data.b.clone());
        adjacency.get_mut(&data.b).unwrap().insert(data.a.clone());
    }
    let count = parts.len();
    if count < 2 {
        return adjacency;
    }
    let mins: Vec<Vector3<f64>> = parts
        .iter()
        .map(|p| p.bbox_min.add_scalar(-contact_mm))
        .collect();
    let maxs: Vec<Vector3<f64>> = parts
        .iter()
        .map(|p| p.bbox_max.add_scalar(contact_mm))
        .collect();
    let mut candidates: Vec<(usize, usize)> = Vec::new();
    for i in 0..(count - 1) {
        for j in (i + 1)..count {
            let overlap = (0..3).all(|k| mins[i][k] <= maxs[j][k] && mins[j][k] <= maxs[i][k]);
            if !overlap {
                continue;
            }
            if adjacency[&parts[i].node_id].contains(&parts[j].node_id) {
                continue;
            }
            candidates.push((i, j));
        }
    }
    let exact = candidates.len() <= MAX_ADJACENCY_DISTANCE_PAIRS;
    for (i, j) in candidates {
        if exact {
            let d = collision::distance_pair(&parts[i].bvh(), &parts[j].bvh());
            if d > contact_mm {
                continue;
            }
        }
        adjacency
            .get_mut(&parts[i].node_id)
            .unwrap()
            .insert(parts[j].node_id.clone());
        adjacency
            .get_mut(&parts[j].node_id)
            .unwrap()
            .insert(parts[i].node_id.clone());
    }
    adjacency
}
