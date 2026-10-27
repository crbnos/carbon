#pragma once
// Document helpers shared by occt.cc (geometry) and pmi.cc (PMI). Internal to
// the bridge: not part of the cxx surface.
#include <string>

#include <TCollection_ExtendedString.hxx>
#include <TDF_Label.hxx>
#include <TDocStd_Application.hxx>
#include <TDocStd_Document.hxx>
#include <TopoDS_Shape.hxx>

namespace carbon_occt {

std::string to_utf8(const TCollection_ExtendedString &ext);
std::string label_name(const TDF_Label &label);
void ensure_step_init();
const Handle(TDocStd_Application) & xcaf_app();
Handle(TDocStd_Document) read_step_to_doc(const std::string &p, std::string &error);
double adaptive_deflection(const TopoDS_Shape &shape, double lin);

}  // namespace carbon_occt
