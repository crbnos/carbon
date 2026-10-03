// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

export enum OnshapeWVMType {
  WORKSPACE = "w",
  VERSION = "v",
  MICROVERSION = "m"
}

export interface OnshapeDocument {
  documentId: string;
  wvm: OnshapeWVMType;
  wvmId: string;
}
