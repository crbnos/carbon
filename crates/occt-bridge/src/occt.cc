#include "occt-bridge/src/occt.h"

#include <map>
#include <string>
#include <vector>

#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <chrono>
#include <mutex>
#include <cstdio>
#include <cstdlib>
#include <BinXCAFDrivers.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Interface_Static.hxx>
#include <PCDM_ReaderStatus.hxx>
#include <PCDM_StoreStatus.hxx>
#include <Poly_Triangle.hxx>
#include <Poly_Triangulation.hxx>
#include <Quantity_ColorRGBA.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <IGESCAFControl_Reader.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <STEPControl_Controller.hxx>
#include <STEPControl_Writer.hxx>
#include <Standard_Failure.hxx>
#include <TCollection_AsciiString.hxx>
#include <TCollection_ExtendedString.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDF_Tool.hxx>
#include <TDataStd_Name.hxx>
#include <TDocStd_Application.hxx>
#include <TDocStd_Document.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_ColorType.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

#include "occt-bridge/src/lib.rs.h"

namespace carbon_occt {

static const std::vector<double> IDENTITY_4X4 = {
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};

// UTF-8, not TCollection_AsciiString: the ASCII conversion replaces every
// non-Latin character with '?', which mangles e.g. CJK part names.
static std::string to_utf8(const TCollection_ExtendedString &ext) {
  const int len = ext.LengthOfCString();
  if (len <= 0) return "";
  std::string out(static_cast<size_t>(len) + 1, '\0');
  Standard_PCharacter p = out.data();
  ext.ToUTF8CString(p);
  out.resize(static_cast<size_t>(len));
  return out;
}

static std::string label_name(const TDF_Label &label) {
  Handle(TDataStd_Name) attr;
  if (label.FindAttribute(TDataStd_Name::GetID(), attr)) {
    return to_utf8(attr->Get());
  }
  return "";
}

static std::string label_entry(const TDF_Label &label) {
  TCollection_AsciiString entry;
  TDF_Tool::Entry(label, entry);
  return std::string(entry.ToCString());
}

static bool label_color(const TDF_Label &a, const TDF_Label &b, bool have_b,
                        std::vector<double> &out) {
  Quantity_ColorRGBA rgba;
  const XCAFDoc_ColorType types[2] = {XCAFDoc_ColorSurf, XCAFDoc_ColorGen};
  const TDF_Label labels[2] = {a, b};
  const int n = have_b ? 2 : 1;
  for (int i = 0; i < n; ++i) {
    if (labels[i].IsNull()) continue;
    for (int t = 0; t < 2; ++t) {
      if (XCAFDoc_ColorTool::GetColor(labels[i], types[t], rgba)) {
        Quantity_Color rgb = rgba.GetRGB();
        out = {rgb.Red(), rgb.Green(), rgb.Blue(), rgba.Alpha()};
        return true;
      }
    }
  }
  return false;
}

static std::vector<double> location_col_major(const TopLoc_Location &loc) {
  gp_Trsf t = loc.Transformation();
  return {t.Value(1, 1), t.Value(2, 1), t.Value(3, 1), 0.0,
          t.Value(1, 2), t.Value(2, 2), t.Value(3, 2), 0.0,
          t.Value(1, 3), t.Value(2, 3), t.Value(3, 3), 0.0,
          t.Value(1, 4), t.Value(2, 4), t.Value(3, 4), 1.0};
}

struct MeshData {
  std::vector<float> vertices;
  std::vector<uint32_t> indices;
  bool is_proxy;
};

// ASSEMBLER_MESH_PARALLEL=0 => serial per-request meshing. A server handling
// concurrent requests wants this: each convert runs single-threaded on its own
// worker thread, so N concurrent converts use N cores cleanly instead of each
// fanning out to all cores and oversubscribing. Default (unset) = parallel, for
// lowest single-request latency (CLI / one-shot use).
static bool mesh_parallel() {
  static bool v = []() {
    const char *e = std::getenv("ASSEMBLER_MESH_PARALLEL");
    return !(e && e[0] == '0');
  }();
  return v;
}

static void tessellate(const TopoDS_Shape &shape, double lin, double ang,
                       std::vector<float> &verts, std::vector<uint32_t> &indices) {
  BRepMesh_IncrementalMesh(shape, lin, Standard_False, ang,
                           mesh_parallel() ? Standard_True : Standard_False);
  uint32_t offset = 0;
  for (TopExp_Explorer exp(shape, TopAbs_FACE); exp.More(); exp.Next()) {
    TopoDS_Face face = TopoDS::Face(exp.Current());
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
    if (tri.IsNull()) continue;
    gp_Trsf trsf = loc.Transformation();
    const int nn = tri->NbNodes();
    for (int i = 1; i <= nn; ++i) {
      gp_Pnt p = tri->Node(i).Transformed(trsf);
      verts.push_back(static_cast<float>(p.X()));
      verts.push_back(static_cast<float>(p.Y()));
      verts.push_back(static_cast<float>(p.Z()));
    }
    const bool reversed = face.Orientation() == TopAbs_REVERSED;
    const int nt = tri->NbTriangles();
    for (int i = 1; i <= nt; ++i) {
      Standard_Integer a, b, c;
      tri->Triangle(i).Get(a, b, c);
      if (reversed) {
        indices.push_back(a - 1 + offset);
        indices.push_back(c - 1 + offset);
        indices.push_back(b - 1 + offset);
      } else {
        indices.push_back(a - 1 + offset);
        indices.push_back(b - 1 + offset);
        indices.push_back(c - 1 + offset);
      }
    }
    offset += nn;
  }
}

static void bbox_proxy(const TopoDS_Shape &shape, std::vector<float> &verts,
                       std::vector<uint32_t> &indices) {
  Bnd_Box box;
  BRepBndLib::Add(shape, box);
  if (box.IsVoid()) return;
  Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
  box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  const float corners[8][3] = {
      {(float)xmin, (float)ymin, (float)zmin}, {(float)xmax, (float)ymin, (float)zmin},
      {(float)xmax, (float)ymax, (float)zmin}, {(float)xmin, (float)ymax, (float)zmin},
      {(float)xmin, (float)ymin, (float)zmax}, {(float)xmax, (float)ymin, (float)zmax},
      {(float)xmax, (float)ymax, (float)zmax}, {(float)xmin, (float)ymax, (float)zmax}};
  for (auto &c : corners) {
    verts.push_back(c[0]);
    verts.push_back(c[1]);
    verts.push_back(c[2]);
  }
  const uint32_t faces[12][3] = {{0, 2, 1}, {0, 3, 2}, {4, 5, 6}, {4, 6, 7},
                                 {0, 1, 5}, {0, 5, 4}, {1, 2, 6}, {1, 6, 5},
                                 {2, 3, 7}, {2, 7, 6}, {3, 0, 4}, {3, 4, 7}};
  for (auto &f : faces) {
    indices.push_back(f[0]);
    indices.push_back(f[1]);
    indices.push_back(f[2]);
  }
}

static double shape_volume(const TopoDS_Shape &shape) {
  try {
    GProp_GProps props;
    BRepGProp::VolumeProperties(shape, props);
    double v = props.Mass();
    if (v > 0) return v;
  } catch (...) {
  }
  Bnd_Box box;
  BRepBndLib::Add(shape, box);
  if (box.IsVoid()) return 0.0;
  Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
  box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  double dx = xmax - xmin, dy = ymax - ymin, dz = zmax - zmin;
  if (dx < 0) dx = 0;
  if (dy < 0) dy = 0;
  if (dz < 0) dz = 0;
  return dx * dy * dz;
}

static int count_faces(const TopoDS_Shape &shape) {
  int n = 0;
  for (TopExp_Explorer exp(shape, TopAbs_FACE); exp.More(); exp.Next()) n++;
  return n;
}

// Every face of the shape belongs to exactly one of the solids? Sheet/surface
// bodies living beside the solids would silently vanish from a per-solid
// split, so their presence keeps the merged mesh instead.
static bool faces_covered_by_solids(const TopoDS_Shape &shape,
                                    const std::vector<TopoDS_Shape> &solids) {
  int covered = 0;
  for (const auto &solid : solids) covered += count_faces(solid);
  return covered == count_faces(shape);
}

class Builder {
 public:
  Builder(double lin, double ang, const Handle(XCAFDoc_ShapeTool) &shapeTool)
      : lin_(lin), ang_(ang), shape_tool_(shapeTool) {}

  std::vector<RawNode> nodes;

  uint64_t build(const TDF_Label &product, const TDF_Label &instance, bool have_instance,
                 const TopLoc_Location &loc, bool have_loc) {
    std::string product_name = label_name(product);
    std::string instance_name = have_instance ? label_name(instance) : "";
    std::string name = !product_name.empty() ? product_name : instance_name;

    RawNode node;
    node.transform = have_loc ? to_vec(location_col_major(loc)) : to_vec(IDENTITY_4X4);
    std::vector<double> color;
    node.has_color = label_color(have_instance ? instance : product, product, have_instance, color);
    if (node.has_color) node.color = to_vec(color);

    if (XCAFDoc_ShapeTool::IsAssembly(product)) {
      TDF_LabelSequence components;
      XCAFDoc_ShapeTool::GetComponents(product, components);
      std::vector<uint64_t> children;
      for (int i = 1; i <= components.Length(); ++i) {
        TDF_Label comp = components.Value(i);
        TDF_Label referred;
        if (!XCAFDoc_ShapeTool::GetReferredShape(comp, referred)) continue;
        TopLoc_Location cloc = XCAFDoc_ShapeTool::GetLocation(comp);
        children.push_back(build(referred, comp, true, cloc, true));
      }
      node.name = name.empty() ? "ASSEMBLY" : name;
      node.product_name = product_name.empty() ? "ASSEMBLY" : product_name;
      node.is_assembly = true;
      node.has_mesh = false;
      node.is_proxy = false;
      node.has_volume = false;
      node.volume = 0.0;
      for (auto c : children) node.children.push_back(c);
      nodes.push_back(node);
      return nodes.size() - 1;
    }

    TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(product);
    const std::string base_name = name.empty() ? "PART" : name;
    const std::string base_product = product_name.empty() ? "PART" : product_name;

    // Flat multi-body products (common Fusion/SolidWorks export shape: one
    // PRODUCT, many solids, no assembly tree) split into per-solid child
    // components — merged they'd be one un-plannable blob. Only when every
    // face belongs to some solid; otherwise (sheet/surface bodies present)
    // keep the merged mesh so no geometry is lost.
    std::vector<TopoDS_Shape> solids;
    for (TopExp_Explorer exp(shape, TopAbs_SOLID); exp.More(); exp.Next()) {
      solids.push_back(exp.Current());
    }
    if (solids.size() >= 2 && faces_covered_by_solids(shape, solids)) {
      const std::string entry = label_entry(product);
      std::vector<uint64_t> children;
      for (size_t i = 0; i < solids.size(); ++i) {
        RawNode child;
        // Solids are already in product-local coordinates
        child.transform = to_vec(IDENTITY_4X4);
        // Display name from the solid's own XCAF sub-label when present;
        // the id-path product_name stays a pure function of (product, index)
        // so nodeIds don't depend on optional naming.
        std::string solid_name;
        std::vector<double> solid_color;
        bool solid_has_color = false;
        TDF_Label sub;
        if (!shape_tool_.IsNull() &&
            shape_tool_->FindSubShape(product, solids[i], sub)) {
          solid_name = label_name(sub);
          solid_has_color = label_color(sub, TDF_Label(), false, solid_color);
        }
        child.name = !solid_name.empty()
                         ? solid_name
                         : base_name + " Body " + std::to_string(i + 1);
        child.product_name = base_product + "#" + std::to_string(i);
        child.has_color = solid_has_color || node.has_color;
        if (solid_has_color) {
          child.color = to_vec(solid_color);
        } else if (node.has_color) {
          child.color = node.color;
        }
        MeshData mesh = mesh_for(entry + "#" + std::to_string(i), solids[i]);
        child.is_assembly = false;
        child.has_mesh = true;
        child.is_proxy = mesh.is_proxy;
        for (float v : mesh.vertices) child.vertices.push_back(v);
        for (uint32_t idx : mesh.indices) child.indices.push_back(idx);
        child.has_volume = true;
        child.volume = shape_volume(solids[i]);
        nodes.push_back(child);
        children.push_back(nodes.size() - 1);
      }
      node.name = base_name;
      node.product_name = base_product;
      node.is_assembly = true;
      node.has_mesh = false;
      node.is_proxy = false;
      node.has_volume = false;
      node.volume = 0.0;
      for (auto c : children) node.children.push_back(c);
      nodes.push_back(node);
      return nodes.size() - 1;
    }

    MeshData mesh = mesh_for(label_entry(product), shape);
    node.name = base_name;
    node.product_name = base_product;
    node.is_assembly = false;
    node.has_mesh = true;
    node.is_proxy = mesh.is_proxy;
    for (float v : mesh.vertices) node.vertices.push_back(v);
    for (uint32_t i : mesh.indices) node.indices.push_back(i);
    node.has_volume = true;
    node.volume = shape_volume(shape);
    nodes.push_back(node);
    return nodes.size() - 1;
  }

 private:
  double lin_, ang_;
  Handle(XCAFDoc_ShapeTool) shape_tool_;
  std::map<std::string, MeshData> cache_;

  MeshData mesh_for(const std::string &key, const TopoDS_Shape &shape) {
    auto it = cache_.find(key);
    if (it != cache_.end()) return it->second;
    MeshData m;
    m.is_proxy = false;
    try {
      tessellate(shape, lin_, ang_, m.vertices, m.indices);
    } catch (...) {
      m.vertices.clear();
      m.indices.clear();
    }
    if (m.indices.empty()) {
      m.vertices.clear();
      m.indices.clear();
      bbox_proxy(shape, m.vertices, m.indices);
      m.is_proxy = true;
    }
    cache_[key] = m;
    return m;
  }

  static rust::Vec<double> to_vec(const std::vector<double> &v) {
    rust::Vec<double> out;
    for (double x : v) out.push_back(x);
    return out;
  }
};

// OCCT STEP reading is thread-safe under a strict contract: one reader per
// thread AND no per-request mutation of the process-wide Interface_Static /
// no concurrent STEPControl_Controller::Init(). So warm both ONCE here,
// single-threaded; concurrent reads then only touch their own local reader
// instance and read (never write) the shared config.
static void ensure_step_init() {
  static std::once_flag occt_init;
  std::call_once(occt_init, [] {
    STEPControl_Controller::Init();
    Interface_Static::SetCVal("xstep.cascade.unit", "MM");
  });
}

// One process-wide XCAF application with the BinXCAF (`.xbf`) storage/retrieval
// drivers registered — required to SaveAs/Open XCAF documents. TDocStd_Application
// is internally guarded, so a single shared instance is fine across threads.
static const Handle(TDocStd_Application) & xcaf_app() {
  static Handle(TDocStd_Application) app = [] {
    Handle(TDocStd_Application) a = new TDocStd_Application();
    BinXCAFDrivers::DefineFormat(a);
    return a;
  }();
  return app;
}

// Read + transfer a STEP file into a fresh XCAF document. Returns null and sets
// `error` on failure (unreadable STEP, transfer failure).
static Handle(TDocStd_Document) read_step_to_doc(const std::string &p,
                                                 std::string &error) {
  ensure_step_init();
  STEPCAFControl_Reader reader;
  reader.SetColorMode(true);
  reader.SetNameMode(true);
  reader.SetLayerMode(false);
  reader.SetMatMode(false);
  if (reader.ReadFile(p.c_str()) != IFSelect_RetDone) {
    error = "could not read STEP file";
    return nullptr;
  }
  Handle(TDocStd_Document) doc = new TDocStd_Document(TCollection_ExtendedString("BinXCAF"));
  if (!reader.Transfer(doc)) {
    error = "STEP transfer to XCAF failed";
    return nullptr;
  }
  return doc;
}

// Walk an XCAF document's free shapes into the flat node `Tree` — the single
// tessellation path shared by STEP and XBF loaders, so both yield identical
// nodeIds + geometry.
static Tree doc_to_tree(const Handle(TDocStd_Document) &doc, double lin, double ang) {
  Tree t;
  t.ok = false;
  t.root_index = 0;
  Handle(XCAFDoc_ShapeTool) shapeTool = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  TDF_LabelSequence freeShapes;
  shapeTool->GetFreeShapes(freeShapes);
  if (freeShapes.Length() == 0) {
    t.error = "document contains no shapes";
    return t;
  }

  Builder b(lin, ang, shapeTool);
  std::vector<uint64_t> roots;
  for (int i = 1; i <= freeShapes.Length(); ++i) {
    roots.push_back(b.build(freeShapes.Value(i), TDF_Label(), false, TopLoc_Location(), false));
  }
  uint64_t root_index;
  if (roots.size() == 1) {
    root_index = roots[0];
  } else {
    RawNode r;
    r.name = "ROOT";
    r.product_name = "ROOT";
    for (double x : IDENTITY_4X4) r.transform.push_back(x);
    r.is_assembly = true;
    r.has_mesh = false;
    r.is_proxy = false;
    r.has_color = false;
    r.has_volume = false;
    r.volume = 0.0;
    for (auto c : roots) r.children.push_back(c);
    b.nodes.push_back(r);
    root_index = b.nodes.size() - 1;
  }

  for (auto &n : b.nodes) t.nodes.push_back(n);
  t.root_index = root_index;
  t.ok = true;
  return t;
}

Tree read_step(rust::Str path, double linear_deflection, double angular_deflection) {
  Tree t;
  t.ok = false;
  t.root_index = 0;
  const bool prof = std::getenv("OCCT_PROFILE") != nullptr;
  auto now = [] { return std::chrono::steady_clock::now(); };
  auto ms = [](auto a, auto b) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(b - a).count();
  };
  try {
    auto t0 = now();
    std::string p(path);
    std::string err;
    Handle(TDocStd_Document) doc = read_step_to_doc(p, err);
    if (doc.IsNull()) {
      t.error = err;
      return t;
    }
    auto t2 = now();
    t = doc_to_tree(doc, linear_deflection, angular_deflection);
    if (prof) {
      auto t3 = now();
      fprintf(stderr, "OCCT read+transfer=%lldms walk+mesh=%lldms\n",
              (long long)ms(t0, t2), (long long)ms(t2, t3));
    }
  } catch (Standard_Failure &e) {
    t.error = std::string("OCCT error: ") + e.GetMessageString();
  } catch (...) {
    t.error = "unknown OCCT error";
  }
  return t;
}

// IGES → XCAF doc, mirroring read_step_to_doc (IGESCAFControl_Reader is the
// XDE twin of the STEP one; same statics, same transfer target).
static Handle(TDocStd_Document) read_iges_to_doc(const std::string &p,
                                                 std::string &error) {
  ensure_step_init();
  IGESCAFControl_Reader reader;
  reader.SetColorMode(true);
  reader.SetNameMode(true);
  reader.SetLayerMode(false);
  if (reader.ReadFile(p.c_str()) != IFSelect_RetDone) {
    error = "could not read IGES file";
    return nullptr;
  }
  Handle(TDocStd_Document) doc = new TDocStd_Document(TCollection_ExtendedString("BinXCAF"));
  if (!reader.Transfer(doc)) {
    error = "IGES transfer to XCAF failed";
    return nullptr;
  }
  return doc;
}

Tree read_iges(rust::Str path, double linear_deflection, double angular_deflection) {
  Tree t;
  t.ok = false;
  t.root_index = 0;
  try {
    std::string p(path);
    std::string err;
    Handle(TDocStd_Document) doc = read_iges_to_doc(p, err);
    if (doc.IsNull()) {
      t.error = err;
      return t;
    }
    t = doc_to_tree(doc, linear_deflection, angular_deflection);
  } catch (Standard_Failure &e) {
    t.error = std::string("OCCT error: ") + e.GetMessageString();
  } catch (...) {
    t.error = "unknown OCCT error";
  }
  return t;
}

Tree read_brep(rust::Str path, double linear_deflection, double angular_deflection) {
  // A .brep file is a bare shape (no product structure, names, or colors).
  // Wrap it in a fresh XCAF doc so the exact same doc_to_tree walk applies —
  // one tessellation path for every OCCT-loaded format.
  Tree t;
  t.ok = false;
  t.root_index = 0;
  try {
    std::string p(path);
    TopoDS_Shape shape;
    BRep_Builder builder;
    if (!BRepTools::Read(shape, p.c_str(), builder)) {
      t.error = "could not read BREP file";
      return t;
    }
    Handle(TDocStd_Document) doc =
        new TDocStd_Document(TCollection_ExtendedString("BinXCAF"));
    Handle(XCAFDoc_ShapeTool) shapeTool = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
    shapeTool->AddShape(shape);
    t = doc_to_tree(doc, linear_deflection, angular_deflection);
  } catch (Standard_Failure &e) {
    t.error = std::string("OCCT error: ") + e.GetMessageString();
  } catch (...) {
    t.error = "unknown OCCT error";
  }
  return t;
}

bool step_to_xbf(rust::Str step_path, rust::Str xbf_path) {
  try {
    std::string sp(step_path);
    std::string error;
    Handle(TDocStd_Document) doc = read_step_to_doc(sp, error);
    if (doc.IsNull()) {
      fprintf(stderr, "step_to_xbf: %s\n", error.c_str());
      return false;
    }
    std::string xp(xbf_path);
    PCDM_StoreStatus st = xcaf_app()->SaveAs(doc, TCollection_ExtendedString(xp.c_str()));
    return st == PCDM_SS_OK;
  } catch (Standard_Failure &e) {
    fprintf(stderr, "step_to_xbf: OCCT error: %s\n", e.GetMessageString());
    return false;
  } catch (...) {
    fprintf(stderr, "step_to_xbf: unknown OCCT error\n");
    return false;
  }
}

Tree read_xbf(rust::Str path, double linear_deflection, double angular_deflection) {
  Tree t;
  t.ok = false;
  t.root_index = 0;
  try {
    std::string p(path);
    Handle(TDocStd_Document) doc;
    PCDM_ReaderStatus rs = xcaf_app()->Open(TCollection_ExtendedString(p.c_str()), doc);
    if (rs != PCDM_RS_OK || doc.IsNull()) {
      t.error = "could not open XBF document";
      return t;
    }
    t = doc_to_tree(doc, linear_deflection, angular_deflection);
  } catch (Standard_Failure &e) {
    t.error = std::string("OCCT error: ") + e.GetMessageString();
  } catch (...) {
    t.error = "unknown OCCT error";
  }
  return t;
}

// Test fixture generator: writes `boxes` disjoint solids as ONE product (a
// compound, no assembly tree) — the flat multi-body export shape the split
// path handles. Hermetic converter tests build their own STEP with this
// instead of committing fixture files.
bool write_test_step(rust::Str path, uint32_t boxes) {
  try {
    ensure_step_init();
    TopoDS_Shape shape;
    if (boxes <= 1) {
      shape = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
    } else {
      TopoDS_Compound compound;
      BRep_Builder builder;
      builder.MakeCompound(compound);
      for (uint32_t i = 0; i < boxes; ++i) {
        builder.Add(compound,
                    BRepPrimAPI_MakeBox(gp_Pnt(i * 30.0, 0.0, 0.0), 10.0, 10.0,
                                        10.0)
                        .Shape());
      }
      shape = compound;
    }
    STEPControl_Writer writer;
    if (writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone) {
      return false;
    }
    std::string p(path);
    return writer.Write(p.c_str()) == IFSelect_RetDone;
  } catch (...) {
    return false;
  }
}

}  // namespace carbon_occt
