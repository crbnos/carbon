#include "collision/src/shim.h"

#include <vector>

#include <fcl/broadphase/broadphase_dynamic_AABB_tree.h>
#include <fcl/geometry/bvh/BVH_model.h>
#include <fcl/math/bv/OBBRSS.h>
#include <fcl/narrowphase/collision.h>
#include <fcl/narrowphase/collision_object.h>
#include <fcl/narrowphase/collision_request.h>
#include <fcl/narrowphase/collision_result.h>
#include <fcl/narrowphase/distance.h>
#include <fcl/narrowphase/distance_request.h>
#include <fcl/narrowphase/distance_result.h>

#include <cmath>
#include <limits>
#include <fcl/narrowphase/detail/traversal/collision/mesh_collision_traversal_node.h>
#include <fcl/narrowphase/detail/traversal/collision_node.h>

#include "collision/src/lib.rs.h"

#include <atomic>
#include <set>

using Model = fcl::BVHModel<fcl::OBBRSS<double>>;

namespace carbon_fcl {

static std::atomic<uint64_t> g_raw_contacts{0};
static std::atomic<uint64_t> g_narrow_pairs{0};

uint64_t raw_contacts_enumerated() { return g_raw_contacts.load(); }
uint64_t narrow_pairs_run() { return g_narrow_pairs.load(); }

static std::shared_ptr<Model> as_model(const Bvh &bvh) {
  return std::static_pointer_cast<Model>(bvh.model);
}

std::unique_ptr<Bvh> new_bvh(rust::Slice<const double> verts,
                             rust::Slice<const uint32_t> tris) {
  const size_t n_verts = verts.size() / 3;
  const size_t n_tris = tris.size() / 3;

  std::vector<fcl::Vector3<double>> points;
  points.reserve(n_verts);
  for (size_t i = 0; i < n_verts; ++i) {
    points.emplace_back(verts[i * 3 + 0], verts[i * 3 + 1], verts[i * 3 + 2]);
  }
  std::vector<fcl::Triangle> triangles;
  triangles.reserve(n_tris);
  for (size_t i = 0; i < n_tris; ++i) {
    triangles.emplace_back(tris[i * 3 + 0], tris[i * 3 + 1], tris[i * 3 + 2]);
  }

  auto model = std::make_shared<Model>();
  model->beginModel(n_tris, n_verts);
  model->addSubModel(points, triangles);
  model->endModel();

  auto bvh = std::make_unique<Bvh>();
  bvh->model = model;  // shared_ptr<Model> -> shared_ptr<void>
  return bvh;
}

rust::Vec<Contact> collide_pair(const Bvh &a, double ax, double ay, double az,
                                const Bvh &b, double bx, double by, double bz,
                                size_t num_max_contacts) {
  fcl::Transform3<double> ta = fcl::Transform3<double>::Identity();
  ta.translation() = fcl::Vector3<double>(ax, ay, az);
  fcl::Transform3<double> tb = fcl::Transform3<double>::Identity();
  tb.translation() = fcl::Vector3<double>(bx, by, bz);

  fcl::CollisionObject<double> oa(as_model(a), ta);
  fcl::CollisionObject<double> ob(as_model(b), tb);

  fcl::CollisionRequest<double> request(num_max_contacts, true);
  fcl::CollisionResult<double> result;
  fcl::collide(&oa, &ob, request, result);

  rust::Vec<Contact> out;
  if (!result.isCollision()) {
    return out;
  }
  std::vector<fcl::Contact<double>> contacts;
  result.getContacts(contacts);
  for (const auto &c : contacts) {
    Contact rc;
    rc.depth = c.penetration_depth;
    rc.nx = c.normal[0];
    rc.ny = c.normal[1];
    rc.nz = c.normal[2];
    rc.px = c.pos[0];
    rc.py = c.pos[1];
    rc.pz = c.pos[2];
    rc.b1 = c.b1;
    rc.b2 = c.b2;
    out.push_back(rc);
  }
  return out;
}

double distance_pair(const Bvh &a, const Bvh &b) {
  fcl::Transform3<double> id = fcl::Transform3<double>::Identity();
  fcl::CollisionObject<double> oa(as_model(a), id);
  fcl::CollisionObject<double> ob(as_model(b), id);
  fcl::DistanceRequest<double> request;
  fcl::DistanceResult<double> result;
  fcl::distance(&oa, &ob, request, result);
  return result.min_distance;
}

// --- broadphase manager (DynamicAABBTree) ---

struct ManagerImpl {
  fcl::DynamicAABBTreeCollisionManager<double> mgr;
  std::vector<std::shared_ptr<fcl::CollisionObject<double>>> objs;
  std::map<const fcl::CollisionGeometry<double> *, size_t> index;
};

static ManagerImpl *as_impl(const Manager &m) {
  return static_cast<ManagerImpl *>(m.impl.get());
}

struct AccumData {
  fcl::CollisionRequest<double> request;
  const std::map<const fcl::CollisionGeometry<double> *, size_t> *index;
  rust::Vec<InternalContact> *out;
};

static bool collide_callback(fcl::CollisionObject<double> *o1,
                             fcl::CollisionObject<double> *o2, void *cdata) {
  AccumData *d = static_cast<AccumData *>(cdata);
  fcl::CollisionResult<double> res;
  fcl::collide(o1, o2, d->request, res);
  if (res.isCollision()) {
    std::vector<fcl::Contact<double>> cs;
    res.getContacts(cs);
    auto ia = d->index->find(o1->collisionGeometry().get());
    auto ib = d->index->find(o2->collisionGeometry().get());
    if (ia != d->index->end() && ib != d->index->end()) {
      for (const auto &c : cs) {
        InternalContact ic;
        ic.a = ia->second;
        ic.b = ib->second;
        ic.depth = c.penetration_depth;
        ic.nx = c.normal[0];
        ic.ny = c.normal[1];
        ic.nz = c.normal[2];
        ic.px = c.pos[0];
        ic.py = c.pos[1];
        ic.pz = c.pos[2];
        d->out->push_back(ic);
      }
    }
  }
  return false;  // continue traversal (accumulate all pairs)
}

std::unique_ptr<Manager> manager_new() {
  auto m = std::make_unique<Manager>();
  m->impl = std::make_shared<ManagerImpl>();
  return m;
}

void manager_add(Manager &m, const Bvh &bvh) {
  ManagerImpl *impl = as_impl(m);
  auto model = std::static_pointer_cast<Model>(bvh.model);
  fcl::Transform3<double> id = fcl::Transform3<double>::Identity();
  auto obj = std::make_shared<fcl::CollisionObject<double>>(model, id);
  impl->mgr.registerObject(obj.get());
  impl->index[obj->collisionGeometry().get()] = impl->objs.size();
  impl->objs.push_back(obj);
}

void manager_setup(Manager &m) { as_impl(m)->mgr.setup(); }

rust::Vec<InternalContact> manager_internal_contacts(const Manager &m, size_t num_max_contacts) {
  ManagerImpl *impl = as_impl(m);
  rust::Vec<InternalContact> out;
  AccumData accum{fcl::CollisionRequest<double>(num_max_contacts, true), &impl->index, &out};
  impl->mgr.collide(&accum, collide_callback);
  return out;
}

void manager_set_active(Manager &m, size_t index, bool active) {
  ManagerImpl *impl = as_impl(m);
  if (index >= impl->objs.size()) {
    return;
  }
  auto *obj = impl->objs[index].get();
  if (active) {
    impl->mgr.registerObject(obj);
  } else {
    impl->mgr.unregisterObject(obj);
  }
  impl->mgr.update();
}

// A single moving object vs the manager: ONE shared CollisionResult with a
// total num_max_contacts budget across all pairs. Delegates to the multi-skip
// form with the moving part's own index as the only skip (so the swept part is
// never narrowphased against its own seated copy).
rust::Vec<SingleContact> manager_collide_single(const Manager &m, const Bvh &moving,
                                                int64_t moving_index, double tx, double ty,
                                                double tz, size_t num_max_contacts) {
  int64_t one[1] = {moving_index};
  rust::Slice<const int64_t> s(moving_index >= 0 ? one : nullptr,
                               moving_index >= 0 ? 1 : 0);
  return manager_collide_single_multi(m, moving, s, tx, ty, tz, num_max_contacts);
}

// Skip a SET of registered objects at the broadphase callback. Used by
// `_path_blockers`: once a partner is a known blocker its contacts are never
// needed again, so skipping it stops re-enumerating its full triangle-contact
// set (thousands) at every subsequent sample, without a manager rebuild.
struct AccumMulti {
  fcl::CollisionRequest<double> request;
  fcl::CollisionResult<double> result;
  // CollisionOBJECT identities (unique per registration) — NOT geometry
  // pointers, which identical parts share (skipping one would cull them all).
  const std::set<const fcl::CollisionObject<double> *> *skip;
};

static bool multi_callback(fcl::CollisionObject<double> *o1,
                           fcl::CollisionObject<double> *o2, void *cdata) {
  AccumMulti *d = static_cast<AccumMulti *>(cdata);
  if (d->skip->count(o1) || d->skip->count(o2)) {
    return false;
  }
  size_t before = d->result.numContacts();
  fcl::collide(o1, o2, d->request, d->result);
  g_narrow_pairs.fetch_add(1, std::memory_order_relaxed);
  g_raw_contacts.fetch_add(d->result.numContacts() - before, std::memory_order_relaxed);
  return d->result.numContacts() >= d->request.num_max_contacts;
}

rust::Vec<SingleContact> manager_collide_single_multi(const Manager &m, const Bvh &moving,
                                                      rust::Slice<const int64_t> skip_indices,
                                                      double tx, double ty, double tz,
                                                      size_t num_max_contacts) {
  ManagerImpl *impl = as_impl(m);
  auto model = std::static_pointer_cast<Model>(moving.model);
  fcl::Transform3<double> tf = fcl::Transform3<double>::Identity();
  tf.translation() = fcl::Vector3<double>(tx, ty, tz);
  fcl::CollisionObject<double> moving_obj(model, tf);

  std::set<const fcl::CollisionObject<double> *> skip;
  for (int64_t idx : skip_indices) {
    if (idx >= 0 && (size_t)idx < impl->objs.size()) {
      skip.insert(impl->objs[idx].get());
    }
  }
  AccumMulti accum{fcl::CollisionRequest<double>(num_max_contacts, true), {}, &skip};
  impl->mgr.collide(&moving_obj, &accum, multi_callback);

  // Collapse the shared contact list to max depth per other. Skipped objects
  // (moving part + known blockers) never narrowphased, so they can't appear here.
  std::vector<fcl::Contact<double>> cs;
  accum.result.getContacts(cs);
  std::map<size_t, double> per_other;
  for (const auto &c : cs) {
    auto i1 = impl->index.find(c.o1);
    auto i2 = impl->index.find(c.o2);
    int64_t other = -1;
    if (i1 != impl->index.end()) {
      other = (int64_t)i1->second;
    } else if (i2 != impl->index.end()) {
      other = (int64_t)i2->second;
    }
    if (other < 0) {
      continue;
    }
    auto it = per_other.find((size_t)other);
    if (it == per_other.end() || c.penetration_depth > it->second) {
      per_other[(size_t)other] = c.penetration_depth;
    }
  }

  rust::Vec<SingleContact> out;
  for (const auto &kv : per_other) {
    SingleContact sc;
    sc.other = kv.first;
    sc.depth = kv.second;
    out.push_back(sc);
  }
  return out;
}

// FCL-native early-stop classify — the avoid-work core, with FCL's exact math.
//
// The planner's sweep consumers only test PREDICATES per neighbor: blocked
// (∃ exempt-filtered pair deeper than t_block = max(tol, allowance+margin)),
// near (> tol/2), touching (any contact). "∃ pair > t_block" ⟺
// "max > t_block", so the deep-overlap case — the one that enumerates
// thousands of triangle contacts today — may STOP at the first such pair with
// a byte-identical verdict (no plan field serializes the depth value; every
// consumer thresholds it). On a miss, the traversal has ALREADY enumerated the
// neighbor's full exact contact set, so near/touch/exempt behavior is
// byte-identical to full enumeration.
//
// Implemented by subclassing FCL's own OBBRSS mesh-mesh traversal node and
// tripping its built-in `canStop()` hook (the mechanism num_max already uses)
// when a contact exceeds the threshold — FCL's traversal order and Intersect
// depths are untouched.
struct ThresholdMeshNode : fcl::detail::MeshCollisionTraversalNodeOBBRSS<double> {
  double threshold = std::numeric_limits<double>::infinity();
  mutable size_t seen = 0;
  mutable bool hit = false;
  mutable double hit_depth = 0.0;

  bool canStop() const override {
    const size_t n = this->result->numContacts();
    for (; seen < n; ++seen) {
      double d = this->result->getContact(seen).penetration_depth;
      if (d > threshold) {
        hit = true;
        hit_depth = d;
        return true;
      }
    }
    return fcl::detail::MeshCollisionTraversalNodeOBBRSS<double>::canStop();
  }
};

struct AccumClassify {
  ManagerImpl *impl;
  const fcl::CollisionObject<double> *moving;
  const std::set<const fcl::CollisionObject<double> *> *skip;
  rust::Slice<const int64_t> ov_idx;
  rust::Slice<const double> ov_am;
  double tol;
  size_t budget_left;  // shared num_max budget across neighbors
  std::vector<std::pair<size_t, double>> out;
};

static bool classify_callback(fcl::CollisionObject<double> *o1,
                              fcl::CollisionObject<double> *o2, void *cdata) {
  AccumClassify *d = static_cast<AccumClassify *>(cdata);
  if (d->skip->count(o1) || d->skip->count(o2)) {
    return false;
  }
  if (d->budget_left == 0) {
    return true;
  }
  fcl::CollisionObject<double> *reg = (o1 == d->moving) ? o2 : o1;
  auto it = d->impl->index.find(reg->collisionGeometry().get());
  if (it == d->impl->index.end()) {
    return false;
  }
  size_t idx = it->second;
  double am = -1.0;
  for (size_t i = 0; i < d->ov_idx.size(); ++i) {
    if (d->ov_idx[i] == (int64_t)idx) {
      am = d->ov_am[i];
      break;
    }
  }
  if (std::isinf(am)) {
    return false;  // infinite allowance: can never block, near, or touch
  }
  double t_block = am > d->tol ? am : d->tol;

  const Model *m1 = static_cast<const Model *>(o1->collisionGeometry().get());
  const Model *m2 = static_cast<const Model *>(o2->collisionGeometry().get());
  fcl::CollisionRequest<double> request(d->budget_left, true);
  fcl::CollisionResult<double> result;
  ThresholdMeshNode node;
  node.threshold = t_block;
  if (!fcl::detail::initialize(node, *m1, o1->getTransform(), *m2, o2->getTransform(), request,
                               result)) {
    return false;
  }
  fcl::detail::collide(&node);
  g_narrow_pairs.fetch_add(1, std::memory_order_relaxed);
  g_raw_contacts.fetch_add(result.numContacts(), std::memory_order_relaxed);
  size_t n = result.numContacts();
  d->budget_left = d->budget_left > n ? d->budget_left - n : 0;

  if (node.hit) {
    d->out.emplace_back(idx, node.hit_depth);
  } else if (n > 0) {
    double max_depth = 0.0;
    for (size_t i = 0; i < n; ++i) {
      double dep = result.getContact(i).penetration_depth;
      if (dep > max_depth) max_depth = dep;
    }
    d->out.emplace_back(idx, max_depth);
  }
  return d->budget_left == 0;
}

rust::Vec<SingleContact> manager_classify_multi(const Manager &m, const Bvh &moving,
                                                rust::Slice<const int64_t> skip_indices,
                                                rust::Slice<const int64_t> ov_idx,
                                                rust::Slice<const double> ov_am, double tx,
                                                double ty, double tz, double tol,
                                                bool /*want_touch_near*/, size_t num_max_contacts) {
  ManagerImpl *impl = as_impl(m);
  auto model = std::static_pointer_cast<Model>(moving.model);
  fcl::Transform3<double> tf = fcl::Transform3<double>::Identity();
  tf.translation() = fcl::Vector3<double>(tx, ty, tz);
  fcl::CollisionObject<double> moving_obj(model, tf);

  std::set<const fcl::CollisionObject<double> *> skip;
  for (int64_t idx : skip_indices) {
    if (idx >= 0 && (size_t)idx < impl->objs.size()) {
      skip.insert(impl->objs[idx].get());
    }
  }
  AccumClassify accum{impl, &moving_obj, &skip, ov_idx, ov_am, tol, num_max_contacts, {}};
  impl->mgr.collide(&moving_obj, &accum, classify_callback);

  rust::Vec<SingleContact> out;
  for (const auto &kv : accum.out) {
    SingleContact sc;
    sc.other = kv.first;
    sc.depth = kv.second;
    out.push_back(sc);
  }
  return out;
}

}  // namespace carbon_fcl
