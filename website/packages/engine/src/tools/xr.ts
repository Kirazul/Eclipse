/** XR controllers, loaded when a session starts. Select grabs and moves the model. */
import { Vector3, type Object3D, type Scene, type WebGLRenderer } from "three";
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js";

export function enableXRControllers(
  renderer: WebGLRenderer,
  scene: Scene,
  grab: { active: Object3D | null; offset: Vector3 },
  root: () => Object3D | null,
): void {
  renderer.xr.enabled = true;
  const factory = new XRControllerModelFactory();
  for (const index of [0, 1]) {
    const controller = renderer.xr.getController(index);
    controller.addEventListener("selectstart", () => {
      const r = root();
      if (grab.active || !r) return;
      grab.offset.copy(controller.position).sub(r.position);
      grab.active = controller;
    });
    controller.addEventListener("selectend", () => {
      if (grab.active === controller) grab.active = null;
    });
    scene.add(controller);
    const handle = renderer.xr.getControllerGrip(index);
    handle.add(factory.createControllerModel(handle));
    scene.add(handle);
  }
}
