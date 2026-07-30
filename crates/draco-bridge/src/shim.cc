#include "draco-bridge/src/shim.h"

#include "draco-bridge/src/lib.rs.h"

#include "draco/attributes/geometry_attribute.h"
#include "draco/compression/encode.h"
#include "draco/core/encoder_buffer.h"
#include "draco/mesh/mesh.h"

namespace carbon_draco {

// Add one float attribute (identity-mapped: point i -> attribute value i) and
// stamp its unique_id (what the KHR_draco extension references). Returns the id.
static int32_t add_attribute(draco::Mesh &mesh, draco::GeometryAttribute::Type type,
                             int8_t components, const float *values, size_t num_points,
                             uint32_t unique_id) {
  draco::GeometryAttribute ga;
  ga.Init(type, nullptr, components, draco::DT_FLOAT32, /*normalized=*/false,
          /*byte_stride=*/sizeof(float) * components, /*byte_offset=*/0);
  const int att_id = mesh.AddAttribute(ga, /*identity_mapping=*/true, num_points);
  draco::PointAttribute *att = mesh.attribute(att_id);
  att->set_unique_id(unique_id);
  for (size_t i = 0; i < num_points; i++) {
    att->SetAttributeValue(draco::AttributeValueIndex(static_cast<uint32_t>(i)),
                           &values[i * components]);
  }
  return static_cast<int32_t>(unique_id);
}

DracoEncoded encode_mesh(rust::Slice<const float> positions, rust::Slice<const float> normals,
                         rust::Slice<const float> uvs, rust::Slice<const uint32_t> indices,
                         int32_t pos_bits, int32_t norm_bits, int32_t uv_bits) {
  DracoEncoded out;
  out.ok = false;
  out.pos_id = -1;
  out.norm_id = -1;
  out.uv_id = -1;

  const size_t nv = positions.size() / 3;
  const size_t nf = indices.size() / 3;
  if (nv == 0 || nf == 0) {
    return out;
  }

  draco::Mesh mesh;
  mesh.set_num_points(static_cast<uint32_t>(nv));
  mesh.SetNumFaces(nf);
  for (size_t f = 0; f < nf; f++) {
    draco::Mesh::Face face;
    face[0] = draco::PointIndex(indices[f * 3 + 0]);
    face[1] = draco::PointIndex(indices[f * 3 + 1]);
    face[2] = draco::PointIndex(indices[f * 3 + 2]);
    mesh.SetFace(draco::FaceIndex(static_cast<uint32_t>(f)), face);
  }

  uint32_t uid = 0;
  out.pos_id =
      add_attribute(mesh, draco::GeometryAttribute::POSITION, 3, positions.data(), nv, uid++);
  const bool has_normals = normals.size() == nv * 3;
  const bool has_uvs = uvs.size() == nv * 2;
  if (has_normals) {
    out.norm_id =
        add_attribute(mesh, draco::GeometryAttribute::NORMAL, 3, normals.data(), nv, uid++);
  }
  if (has_uvs) {
    out.uv_id =
        add_attribute(mesh, draco::GeometryAttribute::TEX_COORD, 2, uvs.data(), nv, uid++);
  }

  draco::Encoder encoder;
  if (pos_bits > 0) {
    encoder.SetAttributeQuantization(draco::GeometryAttribute::POSITION, pos_bits);
  }
  if (has_normals && norm_bits > 0) {
    encoder.SetAttributeQuantization(draco::GeometryAttribute::NORMAL, norm_bits);
  }
  if (has_uvs && uv_bits > 0) {
    encoder.SetAttributeQuantization(draco::GeometryAttribute::TEX_COORD, uv_bits);
  }

  draco::EncoderBuffer buffer;
  const draco::Status status = encoder.EncodeMeshToBuffer(mesh, &buffer);
  if (!status.ok()) {
    return out;
  }

  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(buffer.data());
  out.data.reserve(buffer.size());
  for (size_t i = 0; i < buffer.size(); i++) {
    out.data.push_back(bytes[i]);
  }
  out.ok = true;
  return out;
}

}  // namespace carbon_draco
