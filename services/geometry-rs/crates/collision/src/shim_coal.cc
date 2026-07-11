// Coal (github.com/coal-library/coal, the hpp-fcl successor of FCL) backend for
// the SAME carbon_fcl bridge surface as shim.cc. Selected by the `coal` cargo
// feature; the Rust side is identical.
//
// ############################  EXPERIMENTAL — DO NOT SHIP  ###################
// Pose-matched probes against FCL (see .ai/runs/2026-07-10-geometry-rust-
// rewrite.md, "coal early-stop experiment") showed coal's TriangleP GJK/EPA
// returns UNRELIABLE penetration depths on OCCT-tessellated thin triangles:
// e.g. 20mm "penetration" for a part pair with ZERO intersecting triangles
// under FCL's exact Intersect (a tri-pair depth cannot exceed triangle scale).
// Its `distance_lower_bound` is also BV-polluted under margin queries, so the
// classify dlb-recovery below is unsound. The early-stop CONCEPT measured
// 150-800x fewer contacts / 3-4x faster plans — but the depths driving the
// plans are garbage on this mesh class, so the backend stays experimental.
// ##############################################################################
//
// API differences handled here vs FCL 0.7:
// - no <double> templates (CoalScalar), Transform3s/Vec3s
// - CollisionRequest(CONTACT, num_max) flag ctor
// - broadphase callbacks are objects deriving CollisionCallBackBase
//   (return true = stop traversal, same convention as FCL's fn-pointer)
// - free collide() accumulation into a shared result is not documented — each
//   pair uses a LOCAL result with the REMAINING budget, merged manually
// - contact penetration_depth sign is calibrated by the `coal_calibration`
//   example against the known FCL fixture before trusting (see normalize_depth)

#include "collision/src/shim.h"

#include <atomic>
#include <cstdlib>
#include <cmath>
#include <limits>
#include <map>
#include <set>
#include <vector>

#include <coal/BVH/BVH_model.h>
#include <coal/broadphase/broadphase_callbacks.h>
#include <coal/broadphase/broadphase_dynamic_AABB_tree.h>
#include <coal/collision.h>
#include <coal/collision_object.h>
#include <coal/distance.h>

#include "collision/src/lib.rs.h"

using Model = coal::BVHModel<coal::OBBRSS>;

namespace carbon_fcl {

static std::atomic<uint64_t> g_raw_contacts{0};
static std::atomic<uint64_t> g_narrow_pairs{0};

uint64_t raw_contacts_enumerated() { return g_raw_contacts.load(); }
uint64_t narrow_pairs_run() { return g_narrow_pairs.load(); }

// Coal reports penetration_depth NEGATIVE for overlapping contacts (it is the
// signed distance; see coal/collision_data.h Contact docs: dist(o1,o2) =
// -(p2-p1).norm() when shapes overlap). The planner's contract (from FCL /
// python-fcl) is depth > 0 for penetration, compared against a positive
// tolerance — so flip the sign here. Verified empirically by the
// `coal_calibration` example against the FCL box fixture.
static inline double normalize_depth(double d) { return -d; }

static std::shared_ptr<Model> as_model(const Bvh &bvh) {
  return std::static_pointer_cast<Model>(bvh.model);
}

std::unique_ptr<Bvh> new_bvh(rust::Slice<const double> verts,
                             rust::Slice<const uint32_t> tris) {
  const size_t n_verts = verts.size() / 3;
  const size_t n_tris = tris.size() / 3;

  std::vector<coal::Vec3s> points;
  points.reserve(n_verts);
  for (size_t i = 0; i < n_verts; ++i) {
    points.emplace_back(verts[i * 3 + 0], verts[i * 3 + 1], verts[i * 3 + 2]);
  }
  std::vector<coal::Triangle> triangles;
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
  coal::Transform3s ta;
  ta.setTranslation(coal::Vec3s(ax, ay, az));
  coal::Transform3s tb;
  tb.setTranslation(coal::Vec3s(bx, by, bz));

  coal::CollisionObject oa(as_model(a), ta);
  coal::CollisionObject ob(as_model(b), tb);

  coal::CollisionRequest request(coal::CONTACT, num_max_contacts);
  coal::CollisionResult result;
  coal::collide(&oa, &ob, request, result);
  g_narrow_pairs.fetch_add(1, std::memory_order_relaxed);
  g_raw_contacts.fetch_add(result.numContacts(), std::memory_order_relaxed);

  rust::Vec<Contact> out;
  if (!result.isCollision()) {
    return out;
  }
  for (const auto &c : result.getContacts()) {
    Contact rc;
    rc.depth = normalize_depth(c.penetration_depth);
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
  coal::Transform3s id;
  coal::CollisionObject oa(as_model(a), id);
  coal::CollisionObject ob(as_model(b), id);
  coal::DistanceRequest request;
  coal::DistanceResult result;
  coal::distance(&oa, &ob, request, result);
  // Coal's min_distance is SIGNED (negative when penetrating); FCL reported
  // 0.0. The only consumer is a near-contact threshold (d < eps), for which
  // clamping preserves the FCL meaning.
  return result.min_distance < 0.0 ? 0.0 : result.min_distance;
}

// --- broadphase manager (DynamicAABBTree) ---

struct ManagerImpl {
  coal::DynamicAABBTreeCollisionManager mgr;
  std::vector<std::shared_ptr<coal::CollisionObject>> objs;
  std::map<const coal::CollisionGeometry *, size_t> index;
};

static ManagerImpl *as_impl(const Manager &m) {
  return static_cast<ManagerImpl *>(m.impl.get());
}

// All-pairs accumulation (seated-pair depths). Per-pair local result, merged.
struct AccumAll : coal::CollisionCallBackBase {
  coal::CollisionRequest request;
  const std::map<const coal::CollisionGeometry *, size_t> *index;
  rust::Vec<InternalContact> *out;

  AccumAll(size_t num_max,
           const std::map<const coal::CollisionGeometry *, size_t> *idx,
           rust::Vec<InternalContact> *o)
      : request(coal::CONTACT, num_max), index(idx), out(o) {}

  bool collide(coal::CollisionObject *o1, coal::CollisionObject *o2) override {
    coal::CollisionResult res;
    coal::collide(o1, o2, request, res);
    g_narrow_pairs.fetch_add(1, std::memory_order_relaxed);
    g_raw_contacts.fetch_add(res.numContacts(), std::memory_order_relaxed);
    if (res.isCollision()) {
      auto ia = index->find(o1->collisionGeometry().get());
      auto ib = index->find(o2->collisionGeometry().get());
      if (ia != index->end() && ib != index->end()) {
        for (const auto &c : res.getContacts()) {
          InternalContact ic;
          ic.a = ia->second;
          ic.b = ib->second;
          ic.depth = normalize_depth(c.penetration_depth);
          ic.nx = c.normal[0];
          ic.ny = c.normal[1];
          ic.nz = c.normal[2];
          ic.px = c.pos[0];
          ic.py = c.pos[1];
          ic.pz = c.pos[2];
          out->push_back(ic);
        }
      }
    }
    return false;  // accumulate all pairs
  }
};

std::unique_ptr<Manager> manager_new() {
  auto m = std::make_unique<Manager>();
  m->impl = std::make_shared<ManagerImpl>();
  return m;
}

void manager_add(Manager &m, const Bvh &bvh) {
  ManagerImpl *impl = as_impl(m);
  auto model = std::static_pointer_cast<Model>(bvh.model);
  coal::Transform3s id;
  auto obj = std::make_shared<coal::CollisionObject>(model, id);
  impl->mgr.registerObject(obj.get());
  impl->index[obj->collisionGeometry().get()] = impl->objs.size();
  impl->objs.push_back(obj);
}

void manager_setup(Manager &m) { as_impl(m)->mgr.setup(); }

rust::Vec<InternalContact> manager_internal_contacts(const Manager &m,
                                                     size_t num_max_contacts) {
  ManagerImpl *impl = as_impl(m);
  rust::Vec<InternalContact> out;
  AccumAll accum(num_max_contacts, &impl->index, &out);
  impl->mgr.collide(&accum);
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

// GEOMETRY_SECURITY_MARGIN (mm, negative). When set, this is coal's avoid-work
// mode: per neighbor pair, `security_margin = margin` + `num_max_contacts = 1`
// makes coal's BVH traversal STOP at the first triangle pair penetrating deeper
// than |margin| — instead of enumerating the neighbor's whole (thousands-deep)
// contact set. That is exactly the planner's "is this neighbor blocking > tol"
// question. 0.0 (default) keeps full enumeration. This trades FCL byte-parity
// for far fewer triangle tests; validated by plan validity, not byte-diff.
static double coal_security_margin() {
  static double m = []() {
    const char *e = std::getenv("GEOMETRY_SECURITY_MARGIN");
    return e ? std::atof(e) : 0.0;
  }();
  return m;
}

// Moving object vs the manager, skipping a set of registered objects at the
// broadphase (moving part + known blockers). Total contact budget across pairs.
struct AccumSingle : coal::CollisionCallBackBase {
  size_t budget;
  const std::set<const coal::CollisionObject *> *skip;
  double margin;  // < 0 => early-stop mode; 0 => full enumerate
  std::vector<coal::Contact> contacts;

  AccumSingle(size_t num_max, const std::set<const coal::CollisionObject *> *s, double margin_)
      : budget(num_max), skip(s), margin(margin_) {}

  bool collide(coal::CollisionObject *o1, coal::CollisionObject *o2) override {
    if (skip->count(o1) || skip->count(o2)) {
      return false;
    }
    if (margin < 0.0) {
      // Early-stop: first pair penetrating > |margin| marks this neighbor
      // blocking; coal stops that neighbor's traversal at num_max=1.
      coal::CollisionRequest request(coal::CONTACT, 1);
      request.security_margin = margin;
      coal::CollisionResult res;
      coal::collide(o1, o2, request, res);
      g_narrow_pairs.fetch_add(1, std::memory_order_relaxed);
      g_raw_contacts.fetch_add(res.numContacts(), std::memory_order_relaxed);
      const auto &cs = res.getContacts();
      contacts.insert(contacts.end(), cs.begin(), cs.end());
      return false;  // keep visiting OTHER neighbors (each early-stops itself)
    }
    size_t remaining = budget > contacts.size() ? budget - contacts.size() : 0;
    if (remaining == 0) {
      return true;
    }
    coal::CollisionRequest request(coal::CONTACT, remaining);
    coal::CollisionResult res;
    coal::collide(o1, o2, request, res);
    g_narrow_pairs.fetch_add(1, std::memory_order_relaxed);
    g_raw_contacts.fetch_add(res.numContacts(), std::memory_order_relaxed);
    const auto &cs = res.getContacts();
    contacts.insert(contacts.end(), cs.begin(), cs.end());
    return contacts.size() >= budget;
  }
};

rust::Vec<SingleContact> manager_collide_single_multi(
    const Manager &m, const Bvh &moving, rust::Slice<const int64_t> skip_indices,
    double tx, double ty, double tz, size_t num_max_contacts) {
  ManagerImpl *impl = as_impl(m);
  auto model = std::static_pointer_cast<Model>(moving.model);
  coal::Transform3s tf;
  tf.setTranslation(coal::Vec3s(tx, ty, tz));
  coal::CollisionObject moving_obj(model, tf);

  std::set<const coal::CollisionObject *> skip;
  for (int64_t idx : skip_indices) {
    if (idx >= 0 && (size_t)idx < impl->objs.size()) {
      skip.insert(impl->objs[idx].get());
    }
  }
  AccumSingle accum(num_max_contacts, &skip, coal_security_margin());
  impl->mgr.collide(&moving_obj, &accum);

  // Max depth per other registered object.
  std::map<size_t, double> per_other;
  for (const auto &c : accum.contacts) {
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
    double depth = normalize_depth(c.penetration_depth);
    auto it = per_other.find((size_t)other);
    if (it == per_other.end() || depth > it->second) {
      per_other[(size_t)other] = depth;
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

rust::Vec<SingleContact> manager_collide_single(const Manager &m, const Bvh &moving,
                                                int64_t moving_index, double tx,
                                                double ty, double tz,
                                                size_t num_max_contacts) {
  int64_t one[1] = {moving_index};
  rust::Slice<const int64_t> s(moving_index >= 0 ? one : nullptr,
                               moving_index >= 0 ? 1 : 0);
  return manager_collide_single_multi(m, moving, s, tx, ty, tz, num_max_contacts);
}

// Coal's avoid-work core: bracket-faithful classification with GJK early-stop.
//
// Per broadphase-candidate neighbor, the planner only needs to know which
// PREDICATE BRACKET the neighbor's deepest (exempt-filtered) contact falls in:
//   blocked  : depth > t_block   where t_block = max(tol, allowance+margin)
//   near     : depth in (t_near, t_block]   (t_near = max(tol/2, allowance+margin))
//   touching : any contact at all
// A query with `security_margin = -T` and `num_max_contacts = 1` makes coal's
// BVH traversal STOP at the first triangle pair penetrating deeper than T —
// so a deep pass-through costs ONE GJK pair instead of enumerating thousands.
// The reported depth is a real pair depth inside its bracket, so every planner
// predicate evaluates exactly as full enumeration would; only the depth VALUE
// within the bracket differs (no consumer uses it beyond the predicates).
struct ClassifySingle : coal::CollisionCallBackBase {
  const std::set<const coal::CollisionObject *> *skip;
  const coal::CollisionObject *moving;
  const ManagerImpl *impl;
  rust::Slice<const int64_t> ov_idx;
  rust::Slice<const double> ov_am;
  double tol;
  bool want_touch_near;
  // (registered index, bracket depth) accumulated per overlapping neighbor.
  std::vector<std::pair<size_t, double>> found;

  ClassifySingle(const std::set<const coal::CollisionObject *> *s,
                 const coal::CollisionObject *mv, const ManagerImpl *im,
                 rust::Slice<const int64_t> oi, rust::Slice<const double> oa, double tol_,
                 bool wtn)
      : skip(s), moving(mv), impl(im), ov_idx(oi), ov_am(oa), tol(tol_), want_touch_near(wtn) {}

  double allowance_for(size_t idx) const {
    for (size_t i = 0; i < ov_idx.size(); ++i) {
      if (ov_idx[i] == (int64_t)idx) return ov_am[i];
    }
    return -1.0;  // no allowance override
  }

  bool collide(coal::CollisionObject *o1, coal::CollisionObject *o2) override {
    if (skip->count(o1) || skip->count(o2)) {
      return false;
    }
    coal::CollisionObject *other = (o1 == moving) ? o2 : o1;
    auto it = impl->index.find(other->collisionGeometry().get());
    if (it == impl->index.end()) {
      return false;
    }
    size_t idx = it->second;
    double am = allowance_for(idx);
    if (std::isinf(am)) {
      return false;  // infinite allowance — can never block, near, or count as touching
    }
    double t_block = am > tol ? am : tol;

    // ONE traversal per neighbor. `security_margin = -t_block` + num_max=1
    // early-stops at the first pair penetrating past the blocking threshold
    // (the expensive deep-overlap case costs a single GJK pair). On a miss,
    // coal's always-computed `distance_lower_bound` holds the minimum
    // distToCollision over the traversal — culling only prunes subtrees that
    // provably can't lower it — so the TRUE max penetration is recovered as
    // `t_block - distance_lower_bound`, giving exact near/touch classification
    // without extra probes.
    coal::CollisionRequest request(coal::CONTACT, 1);
    request.security_margin = -t_block;
    coal::CollisionResult res;
    coal::collide(o1, o2, request, res);
    g_narrow_pairs.fetch_add(1, std::memory_order_relaxed);
    g_raw_contacts.fetch_add(res.numContacts(), std::memory_order_relaxed);
    if (res.numContacts() > 0) {
      found.emplace_back(idx, normalize_depth(res.getContact(0).penetration_depth));
      return false;
    }
    if (!want_touch_near) {
      return false;
    }
    // distToCollision = distance - margin = distance + t_block, minimized over
    // the traversal → max_depth = -min_distance = t_block - dlb.
    double max_depth = t_block - res.distance_lower_bound;
    if (max_depth > 1e-12) {
      found.emplace_back(idx, max_depth);
    }
    return false;
  }
};

rust::Vec<SingleContact> manager_classify_multi(const Manager &m, const Bvh &moving,
                                                rust::Slice<const int64_t> skip_indices,
                                                rust::Slice<const int64_t> ov_idx,
                                                rust::Slice<const double> ov_am, double tx,
                                                double ty, double tz, double tol,
                                                bool want_touch_near, size_t /*num_max*/) {
  ManagerImpl *impl = as_impl(m);
  auto model = std::static_pointer_cast<Model>(moving.model);
  coal::Transform3s tf;
  tf.setTranslation(coal::Vec3s(tx, ty, tz));
  coal::CollisionObject moving_obj(model, tf);

  std::set<const coal::CollisionObject *> skip;
  for (int64_t idx : skip_indices) {
    if (idx >= 0 && (size_t)idx < impl->objs.size()) {
      skip.insert(impl->objs[idx].get());
    }
  }
  ClassifySingle cb(&skip, &moving_obj, impl, ov_idx, ov_am, tol, want_touch_near);
  impl->mgr.collide(&moving_obj, &cb);

  rust::Vec<SingleContact> out;
  for (const auto &kv : cb.found) {
    SingleContact sc;
    sc.other = kv.first;
    sc.depth = kv.second;
    out.push_back(sc);
  }
  return out;
}

}  // namespace carbon_fcl
