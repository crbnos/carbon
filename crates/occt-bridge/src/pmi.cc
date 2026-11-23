// PMI (Product Manufacturing Information) out of an XCAF document: the
// dimensions, geometric tolerances and datums OCCT's STEP reader puts in the
// DimTolTool (AP242 semantic PMI, with the graphical presentation it found),
// and the saved views in the ViewTool. A second, read-only pass over the
// document: it never touches the geometry walk in occt.cc, so the GLB and
// every nodeId stay as they are.
//
// Every point leaves here in world mm. OCCT keeps a part's PMI in the part's
// own frame; the walk below records the first world placement of every
// product, and each item moves with the part its first referenced shape
// belongs to.
#include "occt-bridge/src/occt.h"
#include "occt-bridge/src/occt_doc.h"

#include <algorithm>
#include <fstream>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <Interface_Static.hxx>
#include <NCollection_HArray1.hxx>
#include <PCDM_ReaderStatus.hxx>
#include <Poly_Polygon3D.hxx>
#include <Poly_Triangulation.hxx>
#include <STEPCAFControl_Writer.hxx>
#include <Standard_Failure.hxx>
#include <TCollection_HAsciiString.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDF_Tool.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <XCAFDimTolObjects_DatumObject.hxx>
#include <XCAFDimTolObjects_DimensionObject.hxx>
#include <XCAFDimTolObjects_GeomToleranceObject.hxx>
#include <XCAFDoc_Datum.hxx>
#include <XCAFDoc_DimTolTool.hxx>
#include <XCAFDoc_Dimension.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_GeomTolerance.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <XCAFDoc_View.hxx>
#include <XCAFDoc_ViewTool.hxx>
#include <XCAFView_Object.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

#include "occt-bridge/src/lib.rs.h"

namespace carbon_occt {

namespace {

// ---- enum names: lower camel case, in each OCCT enum's declaration order ----

const char *const DIMENSION_TYPES[] = {
    "none",
    "curvedDistance",
    "linearDistance",
    "linearDistanceFromCenterToOuter",
    "linearDistanceFromCenterToInner",
    "linearDistanceFromOuterToCenter",
    "linearDistanceFromOuterToOuter",
    "linearDistanceFromOuterToInner",
    "linearDistanceFromInnerToCenter",
    "linearDistanceFromInnerToOuter",
    "linearDistanceFromInnerToInner",
    "angular",
    "oriented",
    "withPath",
    "curveLength",
    "diameter",
    "sphericalDiameter",
    "radius",
    "sphericalRadius",
    "toroidalMinorDiameter",
    "toroidalMajorDiameter",
    "toroidalMinorRadius",
    "toroidalMajorRadius",
    "toroidalHighMajorDiameter",
    "toroidalLowMajorDiameter",
    "toroidalHighMajorRadius",
    "toroidalLowMajorRadius",
    "thickness",
    "angularSize",
    "sizeWithPath",
    "commonLabel",
    "presentation",
};

const char *const TOLERANCE_TYPES[] = {
    "none",          "angularity",       "circularRunout",
    "circularityOrRoundness", "coaxiality", "concentricity",
    "cylindricity",  "flatness",         "parallelism",
    "perpendicularity", "position",      "profileOfLine",
    "profileOfSurface", "straightness",  "symmetry",
    "totalRunout",
};

const char *const DIMENSION_MODIFIERS[] = {
    "controlledRadius",
    "square",
    "statisticalTolerance",
    "continuousFeature",
    "twoPointSize",
    "localSizeDefinedBySphere",
    "leastSquaresAssociationCriterion",
    "maximumInscribedAssociation",
    "minimumCircumscribedAssociation",
    "circumferenceDiameter",
    "areaDiameter",
    "volumeDiameter",
    "maximumSize",
    "minimumSize",
    "averageSize",
    "medianSize",
    "midRangeSize",
    "rangeOfSizes",
    "anyRestrictedPortionOfFeature",
    "anyCrossSection",
    "specificFixedCrossSection",
    "commonTolerance",
    "freeStateCondition",
    "between",
};

const char *const TOLERANCE_MODIFIERS[] = {
    "anyCrossSection",
    "commonZone",
    "eachRadialElement",
    "freeState",
    "leastMaterialRequirement",
    "lineElement",
    "majorDiameter",
    "maximumMaterialRequirement",
    "minorDiameter",
    "notConvex",
    "pitchDiameter",
    "reciprocityRequirement",
    "separateRequirement",
    "statisticalTolerance",
    "tangentPlane",
    "allAround",
    "allOver",
};

const char *const DATUM_MODIFIERS[] = {
    "anyCrossSection",
    "anyLongitudinalSection",
    "basic",
    "contactingFeature",
    "degreeOfFreedomConstraintU",
    "degreeOfFreedomConstraintV",
    "degreeOfFreedomConstraintW",
    "degreeOfFreedomConstraintX",
    "degreeOfFreedomConstraintY",
    "degreeOfFreedomConstraintZ",
    "distanceVariable",
    "freeState",
    "leastMaterialRequirement",
    "line",
    "majorDiameter",
    "maximumMaterialRequirement",
    "minorDiameter",
    "orientation",
    "pitchDiameter",
    "plane",
    "point",
    "translation",
};

const char *const DATUM_TARGET_TYPES[] = {"point", "line", "rectangle", "circle", "area"};

const char *const FORM_VARIANCES[] = {
    "",  "A", "B", "C", "CD", "D", "E", "EF", "F", "FG", "G", "H", "JS", "J", "K",
    "M", "N", "P", "R", "S",  "T", "U", "V", "X", "Y",  "Z", "ZA", "ZB", "ZC",
};

const char *const GRADES[] = {
    "IT01", "IT0",  "IT1",  "IT2",  "IT3",  "IT4",  "IT5",  "IT6",  "IT7",  "IT8",
    "IT9",  "IT10", "IT11", "IT12", "IT13", "IT14", "IT15", "IT16", "IT17", "IT18",
};

template <size_t N>
const char *enum_name(const char *const (&names)[N], int value) {
  return value >= 0 && static_cast<size_t>(value) < N ? names[value] : "";
}

// Lossy: a name an older exporter wrote in Latin-1 is not valid UTF-8, and
// rust::String's own constructor would throw on it and lose the whole tree.
rust::String hstring(const Handle(TCollection_HAsciiString) &s) {
  return s.IsNull() ? rust::String() : rust::String::lossy(s->ToCString());
}

std::string entry_of(const TDF_Label &label) {
  TCollection_AsciiString entry;
  TDF_Tool::Entry(label, entry);
  return std::string(entry.ToCString());
}

// The walk ends here when an item names a shape its document never placed.
const TopLoc_Location IDENTITY;

// ---- the extraction ----

class PmiReader {
 public:
  PmiReader(const Handle(TDocStd_Document) &doc, double angular)
      : doc_(doc), angular_(angular) {
    shape_tool_ = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  }

  PmiTree read() {
    PmiTree tree;
    tree.ok = true;
    // DimTolTool()/ViewTool() create the tool on a document without one, so
    // ask first. The STEP reader creates both on every document it reads, so
    // this skips only documents from elsewhere; a STEP with no PMI is caught
    // below, where every label list comes back empty.
    const bool has_gdt = XCAFDoc_DocumentTool::CheckDimTolTool(doc_->Main());
    const bool has_views = XCAFDoc_DocumentTool::CheckViewTool(doc_->Main());
    if (!has_gdt && !has_views) return tree;

    place_free_shapes();

    if (has_gdt) {
      Handle(XCAFDoc_DimTolTool) tool = XCAFDoc_DocumentTool::DimTolTool(doc_->Main());
      TDF_LabelSequence labels;
      tool->GetDimensionLabels(labels);
      for (int i = 1; i <= labels.Length(); ++i) read_dimension(labels.Value(i), tree);
      labels.Clear();
      tool->GetGeomToleranceLabels(labels);
      for (int i = 1; i <= labels.Length(); ++i) read_tolerance(labels.Value(i), tree);
      labels.Clear();
      tool->GetDatumLabels(labels);
      for (int i = 1; i <= labels.Length(); ++i) read_datum(labels.Value(i), tree);
    }
    if (has_views) read_views(tree);
    return tree;
  }

 private:
  Handle(TDocStd_Document) doc_;
  Handle(XCAFDoc_ShapeTool) shape_tool_;
  double angular_;
  // Product label entry → its first world placement in the tree walk.
  std::map<std::string, TopLoc_Location> placement_;
  // GD&T label entry → index in tree.items (for the views).
  std::map<std::string, uint32_t> item_index_;
  // Referenced shape label entry → index in tree.faces, or the indices in
  // tree.edges (a wire reference is one polyline per edge).
  std::map<std::string, uint32_t> face_index_;
  std::map<std::string, std::vector<uint32_t>> edge_index_;

  void place_free_shapes() {
    TDF_LabelSequence free_shapes;
    shape_tool_->GetFreeShapes(free_shapes);
    for (int i = 1; i <= free_shapes.Length(); ++i) place(free_shapes.Value(i), TopLoc_Location());
  }

  // Mirrors Builder::build in occt.cc: a component's world placement is its
  // parent's times the component's own location.
  void place(const TDF_Label &product, const TopLoc_Location &world) {
    placement_.emplace(entry_of(product), world);
    if (!XCAFDoc_ShapeTool::IsAssembly(product)) return;
    TDF_LabelSequence components;
    XCAFDoc_ShapeTool::GetComponents(product, components);
    for (int i = 1; i <= components.Length(); ++i) {
      TDF_Label comp = components.Value(i);
      TDF_Label referred;
      if (!XCAFDoc_ShapeTool::GetReferredShape(comp, referred)) continue;
      place(referred, world * XCAFDoc_ShapeTool::GetLocation(comp));
    }
  }

  // The world placement of the part a referenced shape label belongs to. A
  // face/edge reference is a sub-shape label directly under its part's label.
  const TopLoc_Location &placement_of(const TDF_Label &shape_label) const {
    TDF_Label owner = XCAFDoc_ShapeTool::IsSubShape(shape_label) ? shape_label.Father()
                                                                 : shape_label;
    auto it = placement_.find(entry_of(owner));
    return it == placement_.end() ? IDENTITY : it->second;
  }

  static void push_point(rust::Vec<double> &out, const gp_Pnt &p, const gp_Trsf &t) {
    gp_Pnt q = p.Transformed(t);
    out.push_back(q.X());
    out.push_back(q.Y());
    out.push_back(q.Z());
  }

  static void push_dir(rust::Vec<double> &out, const gp_Dir &d, const gp_Trsf &t) {
    gp_Dir q = d.Transformed(t);
    out.push_back(q.X());
    out.push_back(q.Y());
    out.push_back(q.Z());
  }

  // An edge as a polyline: its 3D curve sampled by tangential deflection, else
  // the 3D polygon a tessellated presentation carries. Empty when neither.
  bool edge_polyline(const TopoDS_Edge &edge, const gp_Trsf &t, double sag,
                     PmiPolyline &out) const {
    if (BRep_Tool::Degenerated(edge)) return false;
    double first, last;
    if (!BRep_Tool::Curve(edge, first, last).IsNull()) {
      BRepAdaptor_Curve curve(edge);
      GCPnts_TangentialDeflection sampler(curve, angular_, sag, 2);
      if (sampler.NbPoints() < 2) return false;
      for (int i = 1; i <= sampler.NbPoints(); ++i) push_point(out.points, sampler.Value(i), t);
      return true;
    }
    TopLoc_Location loc;
    Handle(Poly_Polygon3D) polygon = BRep_Tool::Polygon3D(edge, loc);
    if (polygon.IsNull() || polygon->NbNodes() < 2) return false;
    const gp_Trsf local = t * loc.Transformation();
    for (int i = 1; i <= polygon->NbNodes(); ++i) push_point(out.points, polygon->Nodes().Value(i), local);
    return true;
  }

  static void append_triangulation(const TopoDS_Face &face, const gp_Trsf &t, PmiMesh &mesh) {
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
    if (tri.IsNull()) return;
    const gp_Trsf local = t * loc.Transformation();
    const uint32_t offset = static_cast<uint32_t>(mesh.positions.size() / 3);
    for (int i = 1; i <= tri->NbNodes(); ++i) push_point(mesh.positions, tri->Node(i), local);
    for (int i = 1; i <= tri->NbTriangles(); ++i) {
      Standard_Integer a, b, c;
      tri->Triangle(i).Get(a, b, c);
      mesh.indices.push_back(offset + a - 1);
      mesh.indices.push_back(offset + b - 1);
      mesh.indices.push_back(offset + c - 1);
    }
  }

  // The author's drawing: edges become polylines, the surface-less triangulated
  // faces of a tessellated annotation (filled text) become triangles.
  void read_presentation(const TopoDS_Shape &shape, const gp_Trsf &t, PmiRaw &item) const {
    if (shape.IsNull()) return;
    for (TopExp_Explorer exp(shape, TopAbs_EDGE); exp.More(); exp.Next()) {
      PmiPolyline line;
      if (edge_polyline(TopoDS::Edge(exp.Current()), t, 0.01, line)) item.lines.push_back(line);
    }
    for (TopExp_Explorer exp(shape, TopAbs_FACE); exp.More(); exp.Next()) {
      append_triangulation(TopoDS::Face(exp.Current()), t, item.mesh);
    }
  }

  // Each referenced face or edge is meshed once and shared by every item that
  // references it. Solids, vertices and whole parts get no highlight.
  void read_references(const TDF_LabelSequence &labels, PmiTree &tree, PmiRaw &item) {
    for (int i = 1; i <= labels.Length(); ++i) {
      const TDF_Label &label = labels.Value(i);
      TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(label);
      if (shape.IsNull()) continue;
      const gp_Trsf t = placement_of(label).Transformation();
      const std::string key = entry_of(label);
      if (shape.ShapeType() == TopAbs_FACE) {
        auto found = face_index_.find(key);
        if (found == face_index_.end()) {
          TopoDS_Face face = TopoDS::Face(shape);
          TopLoc_Location loc;
          if (BRep_Tool::Triangulation(face, loc).IsNull()) {
            BRepMesh_IncrementalMesh(face, adaptive_deflection(face, 0.1), Standard_False, 0.5);
          }
          PmiMesh mesh;
          append_triangulation(face, t, mesh);
          if (mesh.indices.empty()) continue;
          tree.faces.push_back(mesh);
          found = face_index_.emplace(key, static_cast<uint32_t>(tree.faces.size() - 1)).first;
        }
        item.faces.push_back(found->second);
      } else if (shape.ShapeType() == TopAbs_EDGE || shape.ShapeType() == TopAbs_WIRE) {
        auto found = edge_index_.find(key);
        if (found == edge_index_.end()) {
          // One polyline per edge: the explorer neither orders a wire's edges
          // nor orients them, so joining them would draw lines across it.
          std::vector<uint32_t> indices;
          for (TopExp_Explorer exp(shape, TopAbs_EDGE); exp.More(); exp.Next()) {
            PmiPolyline line;
            if (edge_polyline(TopoDS::Edge(exp.Current()), t, 0.05, line)) {
              tree.edges.push_back(line);
              indices.push_back(static_cast<uint32_t>(tree.edges.size() - 1));
            }
          }
          found = edge_index_.emplace(key, indices).first;
        }
        for (uint32_t index : found->second) item.edges.push_back(index);
      }
    }
  }

  // The first referenced shape decides the frame of the item's own geometry.
  gp_Trsf frame_of(const TDF_LabelSequence &first, const TDF_LabelSequence &second) const {
    if (first.Length() > 0) return placement_of(first.Value(1)).Transformation();
    if (second.Length() > 0) return placement_of(second.Value(1)).Transformation();
    return gp_Trsf();
  }

  static void set_plane(PmiRaw &item, bool has, const gp_Ax2 &plane, const gp_Trsf &t) {
    if (!has) return;
    item.has_plane = true;
    push_point(item.plane, plane.Location(), t);
    push_dir(item.plane, plane.Direction(), t);
    push_dir(item.plane, plane.XDirection(), t);
  }

  static void set_text(PmiRaw &item, bool has, const gp_Pnt &p, const gp_Trsf &t) {
    if (!has) return;
    item.has_text = true;
    push_point(item.text, p, t);
  }

  static PmiRaw blank(uint8_t kind) {
    PmiRaw item;
    item.kind = kind;
    item.has_value = false;
    item.value = 0;
    item.has_plus_minus = false;
    item.upper = 0;
    item.lower = 0;
    item.has_range = false;
    item.upper_bound = 0;
    item.lower_bound = 0;
    item.has_fit = false;
    item.fit_hole = false;
    item.has_decimals = false;
    item.decimals_left = 0;
    item.decimals_right = 0;
    item.zone_modifier_value = 0;
    item.max_value = 0;
    item.has_plane = false;
    item.has_text = false;
    return item;
  }

  void finish(const TDF_Label &label, PmiRaw &item, PmiTree &tree) {
    item_index_[entry_of(label)] = static_cast<uint32_t>(tree.items.size());
    tree.items.push_back(item);
  }

  void read_dimension(const TDF_Label &label, PmiTree &tree) {
    Handle(XCAFDoc_Dimension) attr;
    if (!label.FindAttribute(XCAFDoc_Dimension::GetID(), attr)) return;
    Handle(XCAFDimTolObjects_DimensionObject) obj = attr->GetObject();
    if (obj.IsNull()) return;
    const XCAFDimTolObjects_DimensionType type = obj->GetType();
    const bool graphic_only = type == XCAFDimTolObjects_DimensionType_CommonLabel ||
                              type == XCAFDimTolObjects_DimensionType_DimensionPresentation;
    PmiRaw item = blank(graphic_only ? 3 : 0);
    item.type_name = enum_name(DIMENSION_TYPES, static_cast<int>(type));
    item.name = hstring(obj->GetSemanticName());
    if (item.name.empty()) item.name = hstring(obj->GetPresentationName());

    if (!graphic_only) {
      Handle(NCollection_HArray1<double>) values = obj->GetValues();
      if (!values.IsNull() && values->Length() > 0) {
        item.has_value = true;
        item.value = obj->GetValue();
      }
      if (obj->IsDimWithPlusMinusTolerance()) {
        item.has_plus_minus = true;
        item.upper = obj->GetUpperTolValue();
        // OCCT's STEP reader keeps only the lower deviation's magnitude, so a
        // one-sided tolerance (+0.03/+0.01) cannot be told apart here; the
        // artifact signs it as the usual case, below the nominal.
        item.lower = -std::abs(obj->GetLowerTolValue());
      }
      if (obj->IsDimWithRange()) {
        item.has_range = true;
        item.upper_bound = obj->GetUpperBound();
        item.lower_bound = obj->GetLowerBound();
      }
      if (obj->IsDimWithClassOfTolerance()) {
        bool hole = false;
        XCAFDimTolObjects_DimensionFormVariance variance;
        XCAFDimTolObjects_DimensionGrade grade;
        if (obj->GetClassOfTolerance(hole, variance, grade)) {
          item.has_fit = true;
          item.fit_hole = hole;
          item.fit_variance = enum_name(FORM_VARIANCES, static_cast<int>(variance));
          item.fit_grade = enum_name(GRADES, static_cast<int>(grade));
        }
      }
      if (obj->HasQualifier()) {
        switch (obj->GetQualifier()) {
          case XCAFDimTolObjects_DimensionQualifier_Min: item.qualifier = "min"; break;
          case XCAFDimTolObjects_DimensionQualifier_Max: item.qualifier = "max"; break;
          case XCAFDimTolObjects_DimensionQualifier_Avg: item.qualifier = "avg"; break;
          default: break;
        }
      }
      int left = 0, right = 0;
      obj->GetNbOfDecimalPlaces(left, right);
      if (left > 0 || right > 0) {
        item.has_decimals = true;
        item.decimals_left = left;
        item.decimals_right = right;
      }
      NCollection_Sequence<XCAFDimTolObjects_DimensionModif> modifiers = obj->GetModifiers();
      for (int i = 1; i <= modifiers.Length(); ++i) {
        item.modifiers.push_back(enum_name(DIMENSION_MODIFIERS, static_cast<int>(modifiers.Value(i))));
      }
    }
    for (int i = 0; i < obj->NbDescriptions(); ++i) {
      rust::String text = hstring(obj->GetDescription(i));
      if (!text.empty()) item.descriptions.push_back(text);
    }

    TDF_LabelSequence first, second;
    XCAFDoc_DimTolTool::GetRefShapeLabel(label, first, second);
    const gp_Trsf t = frame_of(first, second);
    read_presentation(obj->GetPresentation(), t, item);
    set_plane(item, obj->HasPlane(), obj->GetPlane(), t);
    set_text(item, obj->HasTextPoint(), obj->GetPointTextAttach(), t);
    read_references(first, tree, item);
    read_references(second, tree, item);
    finish(label, item, tree);
  }

  void read_tolerance(const TDF_Label &label, PmiTree &tree) {
    Handle(XCAFDoc_GeomTolerance) attr;
    if (!label.FindAttribute(XCAFDoc_GeomTolerance::GetID(), attr)) return;
    Handle(XCAFDimTolObjects_GeomToleranceObject) obj = attr->GetObject();
    if (obj.IsNull()) return;
    PmiRaw item = blank(1);
    item.type_name = enum_name(TOLERANCE_TYPES, static_cast<int>(obj->GetType()));
    item.name = hstring(obj->GetSemanticName());
    if (item.name.empty()) item.name = hstring(obj->GetPresentationName());
    item.has_value = true;
    item.value = obj->GetValue();
    switch (obj->GetTypeOfValue()) {
      case XCAFDimTolObjects_GeomToleranceTypeValue_Diameter: item.zone_shape = "diameter"; break;
      case XCAFDimTolObjects_GeomToleranceTypeValue_SphericalDiameter:
        item.zone_shape = "sphericalDiameter";
        break;
      default: break;
    }
    switch (obj->GetMaterialRequirementModifier()) {
      case XCAFDimTolObjects_GeomToleranceMatReqModif_M: item.material = "M"; break;
      case XCAFDimTolObjects_GeomToleranceMatReqModif_L: item.material = "L"; break;
      default: break;
    }
    switch (obj->GetZoneModifier()) {
      case XCAFDimTolObjects_GeomToleranceZoneModif_Projected: item.zone_modifier = "projected"; break;
      case XCAFDimTolObjects_GeomToleranceZoneModif_Runout: item.zone_modifier = "runout"; break;
      case XCAFDimTolObjects_GeomToleranceZoneModif_NonUniform: item.zone_modifier = "nonUniform"; break;
      default: break;
    }
    item.zone_modifier_value = obj->GetValueOfZoneModifier();
    item.max_value = obj->GetMaxValueModifier();
    NCollection_Sequence<XCAFDimTolObjects_GeomToleranceModif> modifiers = obj->GetModifiers();
    for (int i = 1; i <= modifiers.Length(); ++i) {
      item.modifiers.push_back(enum_name(TOLERANCE_MODIFIERS, static_cast<int>(modifiers.Value(i))));
    }

    // Datum references in precedence order. The "with object" variant drops
    // the extra labels a datum's targets add.
    TDF_LabelSequence datum_labels;
    XCAFDoc_DimTolTool::GetDatumWithObjectOfTolerLabels(label, datum_labels);
    std::vector<std::pair<int, std::pair<std::string, std::string>>> datums;
    for (int i = 1; i <= datum_labels.Length(); ++i) {
      Handle(XCAFDoc_Datum) datum_attr;
      if (!datum_labels.Value(i).FindAttribute(XCAFDoc_Datum::GetID(), datum_attr)) continue;
      Handle(XCAFDimTolObjects_DatumObject) datum = datum_attr->GetObject();
      if (datum.IsNull()) continue;
      std::string mods;
      NCollection_Sequence<XCAFDimTolObjects_DatumSingleModif> dm = datum->GetModifiers();
      for (int j = 1; j <= dm.Length(); ++j) {
        if (!mods.empty()) mods += ",";
        mods += enum_name(DATUM_MODIFIERS, static_cast<int>(dm.Value(j)));
      }
      datums.push_back({datum->GetPosition(), {std::string(hstring(datum->GetName())), mods}});
    }
    std::stable_sort(datums.begin(), datums.end(),
                     [](const auto &a, const auto &b) { return a.first < b.first; });
    for (const auto &d : datums) {
      item.datum_refs.push_back(d.second.first);
      item.datum_ref_modifiers.push_back(d.second.second);
    }

    TDF_LabelSequence first, second;
    XCAFDoc_DimTolTool::GetRefShapeLabel(label, first, second);
    const gp_Trsf t = frame_of(first, second);
    read_presentation(obj->GetPresentation(), t, item);
    set_plane(item, obj->HasPlane(), obj->GetPlane(), t);
    set_text(item, obj->HasPointText(), obj->GetPointTextAttach(), t);
    read_references(first, tree, item);
    finish(label, item, tree);
  }

  void read_datum(const TDF_Label &label, PmiTree &tree) {
    Handle(XCAFDoc_Datum) attr;
    if (!label.FindAttribute(XCAFDoc_Datum::GetID(), attr)) return;
    Handle(XCAFDimTolObjects_DatumObject) obj = attr->GetObject();
    if (obj.IsNull()) return;
    PmiRaw item = blank(2);
    item.type_name = "datum";
    item.name = hstring(obj->GetName());
    NCollection_Sequence<XCAFDimTolObjects_DatumSingleModif> modifiers = obj->GetModifiers();
    for (int i = 1; i <= modifiers.Length(); ++i) {
      item.modifiers.push_back(enum_name(DATUM_MODIFIERS, static_cast<int>(modifiers.Value(i))));
    }
    if (obj->IsDatumTarget()) {
      item.datum_target = enum_name(DATUM_TARGET_TYPES, static_cast<int>(obj->GetDatumTargetType()));
    }
    TDF_LabelSequence first, second;
    XCAFDoc_DimTolTool::GetRefShapeLabel(label, first, second);
    const gp_Trsf t = frame_of(first, second);
    read_presentation(obj->GetPresentation(), t, item);
    set_plane(item, obj->HasPlane(), obj->GetPlane(), t);
    set_text(item, obj->HasPointText(), obj->GetPointTextAttach(), t);
    read_references(first, tree, item);
    finish(label, item, tree);
  }

  // Saved views. OCCT's view direction is the look direction, camera towards
  // model (NIST CTC 01's isometric "MBD_0" reads (-0.59, 0.57, -0.58) with up
  // +Z). The projection point is relative to the camera's own frame and not a
  // world point, so it is not read: the viewer fits the view's items instead.
  // OCCT stops reading views at the first camera it cannot tie to a
  // draughting model (STEPCAFControl_Reader::ReadViews), so an AP242 e3 file
  // such as NIST STC 06 can arrive with none.
  void read_views(PmiTree &tree) {
    Handle(XCAFDoc_ViewTool) tool = XCAFDoc_DocumentTool::ViewTool(doc_->Main());
    TDF_LabelSequence labels;
    tool->GetViewLabels(labels);
    for (int i = 1; i <= labels.Length(); ++i) {
      Handle(XCAFDoc_View) attr;
      if (!labels.Value(i).FindAttribute(XCAFDoc_View::GetID(), attr)) continue;
      Handle(XCAFView_Object) obj = attr->GetObject();
      if (obj.IsNull()) continue;
      PmiViewRaw view;
      view.name = hstring(obj->Name());
      const gp_Dir look = obj->ViewDirection();
      const gp_Dir up = obj->UpDirection();
      view.direction = {look.X(), look.Y(), look.Z()};
      view.up = {up.X(), up.Y(), up.Z()};
      switch (obj->Type()) {
        case XCAFView_ProjectionType_Parallel: view.projection = 1; break;
        case XCAFView_ProjectionType_Central: view.projection = 2; break;
        default: view.projection = 0; break;
      }
      TDF_LabelSequence gdt;
      tool->GetRefGDTLabel(labels.Value(i), gdt);
      std::vector<uint32_t> seen;
      for (int j = 1; j <= gdt.Length(); ++j) {
        auto found = item_index_.find(entry_of(gdt.Value(j)));
        if (found == item_index_.end()) continue;
        // ReadViews can list one GD&T once per annotation plane element.
        if (std::find(seen.begin(), seen.end(), found->second) != seen.end()) continue;
        seen.push_back(found->second);
        view.items.push_back(found->second);
      }
      tree.views.push_back(view);
    }
  }
};

// A BinXCAF document is read from a stream, not opened by path: the
// application refuses a path whose document it already holds open
// (PCDM_RS_AlreadyRetrieved), and the optimize ingest's `read_xbf` has just
// opened this one. `opened_by_app` tells the caller to Close() it again, so the
// application does not keep the document alive.
Handle(TDocStd_Document) open_document(const std::string &path, std::string &error,
                                       bool &opened_by_app) {
  opened_by_app = false;
  std::ifstream file(path, std::ios::binary);
  char magic[7] = {0};
  const bool xbf = file && file.read(magic, 7) && std::string(magic, 7) == "BINFILE";
  if (!xbf) return read_step_to_doc(path, error);
  file.clear();
  file.seekg(0);
  Handle(TDocStd_Document) doc;
  PCDM_ReaderStatus rs = xcaf_app()->Open(file, doc);
  if (rs != PCDM_RS_OK || doc.IsNull()) {
    error = "could not open XBF document";
    return nullptr;
  }
  opened_by_app = true;
  return doc;
}

}  // namespace

PmiTree read_pmi(rust::Str path, double angular_deflection) {
  PmiTree tree;
  tree.ok = false;
  try {
    std::string error;
    bool opened_by_app = false;
    Handle(TDocStd_Document) doc = open_document(std::string(path), error, opened_by_app);
    if (doc.IsNull()) {
      tree.error = error;
      return tree;
    }
    struct CloseOnExit {
      Handle(TDocStd_Document) doc;
      bool active;
      ~CloseOnExit() {
        if (!active) return;
        try {
          xcaf_app()->Close(doc);
        } catch (...) {
        }
      }
    } close_on_exit{doc, opened_by_app};
    tree = PmiReader(doc, angular_deflection).read();
  } catch (Standard_Failure &e) {
    tree = PmiTree();
    tree.ok = false;
    tree.error = std::string("OCCT error: ") + e.GetMessageString();
  } catch (...) {
    tree = PmiTree();
    tree.ok = false;
    tree.error = "unknown OCCT error";
  }
  return tree;
}

// Test fixture generator: a 100 x 50 x 20 mm box as AP242 with semantic PMI —
// a 100 mm (+0.1/-0.05) distance between the two X faces with a two-edge
// presentation, a 0.05 flatness on the top face referencing datum A, and
// datum A on the bottom face. Hermetic converter tests read it back.
bool write_test_pmi_step(rust::Str path) {
  try {
    ensure_step_init();
    Handle(TDocStd_Document) doc = new TDocStd_Document(TCollection_ExtendedString("BinXCAF"));
    Handle(XCAFDoc_ShapeTool) shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
    Handle(XCAFDoc_DimTolTool) gdt = XCAFDoc_DocumentTool::DimTolTool(doc->Main());

    TopoDS_Shape box = BRepPrimAPI_MakeBox(100.0, 50.0, 20.0).Shape();
    TDF_Label part = shapes->AddShape(box, Standard_False);

    // BRepPrimAPI_MakeBox face order: -X, +X, -Y, +Y, -Z (bottom), +Z (top).
    std::vector<TopoDS_Shape> faces;
    for (TopExp_Explorer exp(box, TopAbs_FACE); exp.More(); exp.Next()) faces.push_back(exp.Current());
    if (faces.size() != 6) return false;
    TDF_Label left = shapes->AddSubShape(part, faces[0]);
    TDF_Label right = shapes->AddSubShape(part, faces[1]);
    TDF_Label bottom = shapes->AddSubShape(part, faces[4]);
    TDF_Label top = shapes->AddSubShape(part, faces[5]);

    TDF_Label dim = gdt->AddDimension();
    gdt->SetDimension(left, right, dim);
    Handle(XCAFDimTolObjects_DimensionObject) dim_obj = new XCAFDimTolObjects_DimensionObject();
    dim_obj->SetType(XCAFDimTolObjects_DimensionType_Location_LinearDistance);
    dim_obj->SetValue(100.0);
    dim_obj->SetUpperTolValue(0.1);
    dim_obj->SetLowerTolValue(0.05);
    dim_obj->SetPlane(gp_Ax2(gp_Pnt(50.0, -10.0, 10.0), gp_Dir(0.0, -1.0, 0.0), gp_Dir(1.0, 0.0, 0.0)));
    dim_obj->SetPointTextAttach(gp_Pnt(50.0, -10.0, 30.0));
    TopoDS_Compound presentation;
    BRep_Builder builder;
    builder.MakeCompound(presentation);
    builder.Add(presentation, BRepBuilderAPI_MakeEdge(gp_Pnt(0.0, -10.0, 25.0), gp_Pnt(100.0, -10.0, 25.0)).Edge());
    builder.Add(presentation, BRepBuilderAPI_MakeEdge(gp_Pnt(0.0, -10.0, 20.0), gp_Pnt(0.0, -10.0, 28.0)).Edge());
    dim_obj->SetPresentation(presentation, new TCollection_HAsciiString("length"));
    XCAFDoc_Dimension::Set(dim)->SetObject(dim_obj);

    TDF_Label datum = gdt->AddDatum();
    TDF_LabelSequence datum_shapes;
    datum_shapes.Append(bottom);
    gdt->SetDatum(datum_shapes, datum);
    Handle(XCAFDimTolObjects_DatumObject) datum_obj = new XCAFDimTolObjects_DatumObject();
    datum_obj->SetName(new TCollection_HAsciiString("A"));
    datum_obj->SetPosition(1);
    XCAFDoc_Datum::Set(datum)->SetObject(datum_obj);

    TDF_Label tol = gdt->AddGeomTolerance();
    gdt->SetGeomTolerance(top, tol);
    Handle(XCAFDimTolObjects_GeomToleranceObject) tol_obj = new XCAFDimTolObjects_GeomToleranceObject();
    tol_obj->SetType(XCAFDimTolObjects_GeomToleranceType_Flatness);
    tol_obj->SetValue(0.05);
    XCAFDoc_GeomTolerance::Set(tol)->SetObject(tol_obj);
    gdt->SetDatumToGeomTol(datum, tol);

    STEPCAFControl_Writer writer;
    writer.SetDimTolMode(Standard_True);
    Interface_Static::SetIVal("write.step.schema", 5);
    if (!writer.Transfer(doc, STEPControl_AsIs)) return false;
    std::string p(path);
    return writer.Write(p.c_str()) == IFSelect_RetDone;
  } catch (...) {
    return false;
  }
}

}  // namespace carbon_occt
