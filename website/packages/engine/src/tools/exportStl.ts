/** STL export: the model as posed, hidden parts removed, scaled for a slicer. */
import type { Object3D, SkinnedMesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { STL_SCALE } from "../constants";
import { restorePivots } from "../model/figure";

export async function exportStl(root: Object3D): Promise<Blob> {
  const copy = clone(root);
  restorePivots(copy);
  copy.position.set(0, 0, 0);
  copy.scale.setScalar(STL_SCALE);
  copy.updateMatrixWorld(true);
  const hidden: Object3D[] = [];
  copy.traverse((o) => {
    const mesh = o as SkinnedMesh;
    if (mesh.isMesh && !mesh.visible) hidden.push(mesh);
    else if (mesh.isSkinnedMesh) mesh.skeleton.update();
  });
  for (const o of hidden) o.removeFromParent();
  const data = new STLExporter().parse(copy, { binary: true }) as unknown as DataView;
  return new Blob([data.buffer as ArrayBuffer], { type: "application/octet-stream" });
}
