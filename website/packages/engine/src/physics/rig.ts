/**
 * One figure's `.phys` simulation, wired to its bones. The solver (./index) knows
 * nothing of three.js and works in retail's axes, Z up, so gravity stays down it; this
 * file converts at the boundary, as PhysicsLive.cpp does for the client:
 *
 *   every frame, after the mixer: animated bones -> drive -> step -> dynamic bones
 *
 * A bone a dynamic body writes takes its matrix from the solver, and the bones under it
 * follow. Bones of a collection the body does not have (a cloak's tail) have no clip of
 * their own, so they follow their parent bone on the body in the same pass. Nothing here
 * allocates after the constructor.
 */
import { Matrix4, type Object3D } from "three";
import type { Figure } from "../model/figure";
import { PhysInstance, type PhysFrame, type PhysModel, type PhysScene } from "./index";

/** Retail index -> engine axis: the baker writes (x, y, z) as (y, z, x). */
const AXIS = [2, 0, 1, 3] as const;

const _inv = new Matrix4();
const _local = new Matrix4();
const _world = new Matrix4();

export class PhysicsRig {
  private instance: PhysInstance;
  private readonly frame: PhysFrame;
  /** Retail bone -> scene node. */
  private readonly nodes: (Object3D | null)[];
  private readonly parent: Int32Array;
  /** Bones whose pose this rig computes: under a dynamic bone, or a collection's own. Parents first. */
  private readonly chain: Int32Array;
  private readonly inChain: Uint8Array;
  /** Body writing each bone, -1 for none. */
  private readonly writer: Int32Array;
  /** Column-major, engine axes: each chain bone's animated pose. */
  private readonly anim: Float64Array;
  private readonly next: Float64Array;
  private readonly out = new Float64Array(16);
  private written = false;

  constructor(
    readonly figure: Figure,
    readonly model: PhysModel,
    private readonly scene: PhysScene,
    private readonly attached: boolean,
  ) {
    const own = figure.boneList;
    const n = own.length;
    this.nodes = own.map((_, i) => figure.boneAt(i));
    this.parent = new Int32Array(n).fill(-1);
    const index = new Map<Object3D, number>();
    own.forEach((b, i) => index.set(b, i));
    own.forEach((b, i) => {
      const p = b.parent ? index.get(b.parent) : undefined;
      if (p !== undefined) this.parent[i] = p;
    });

    this.instance = new PhysInstance(model, scene, attached);
    this.writer = new Int32Array(n).fill(-1);
    // The bodies the solver will write: dynamic, with a bone.
    model.bodies.forEach((b, i) => {
      if (b.type === 0 && b.bone < n) this.writer[b.bone] = i;
    });

    // Who is on the chain: written bones, what hangs under them, and a collection's own.
    const inChain = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = this.parent[i]!;
      const hostless = figure.host !== null && this.nodes[i] === own[i];
      if (this.writer[i]! >= 0 || hostless || (p >= 0 && inChain[p])) inChain[i] = 1;
    }
    this.inChain = inChain;
    // Retail's parents always come before their children; this order holds for the pass.
    const chain: number[] = [];
    for (let i = 0; i < n; i++) if (inChain[i]) chain.push(i);
    this.chain = Int32Array.from(chain);
    this.anim = new Float64Array(n * 16);
    this.next = new Float64Array(n * 16);

    // Pivots stay in retail axes for the solver.
    const pivots = new Float32Array(n * 3);
    const baked = figure.assets.manifest.pivots;
    for (let i = 0; i < n; i++) {
      pivots[i * 3] = baked?.[i * 3 + 2] ?? 0;
      pivots[i * 3 + 1] = baked?.[i * 3] ?? 0;
      pivots[i * 3 + 2] = baked?.[i * 3 + 1] ?? 0;
    }
    this.frame = { boneWorld: new Float64Array(n * 16), pivots, boneCount: n, placement: new Float64Array(16), dt: 0, camDist2: 0 };
  }

  /** Reads this frame's animated pose and steps. World matrices must be current. */
  drive(dt: number): void {
    const { frame, nodes, chain, parent, anim, inChain } = this;
    const root = this.figure.root.matrixWorld.elements;
    // A mirrored figure simulates in a mirror world, with the same gravity. What comes
    // back is relative to the placement, so it lands right in the real one.
    const flip = root[0]! * (root[5]! * root[10]! - root[6]! * root[9]!) - root[4]! * (root[1]! * root[10]! - root[2]! * root[9]!) + root[8]! * (root[1]! * root[6]! - root[2]! * root[5]!) < 0;

    for (let c = 0; c < chain.length; c++) {
      const i = chain[c]!;
      const node = nodes[i];
      if (!node) continue;
      // The animated local pose. For a node that no longer auto-updates, this is also
      // what puts the mixer's pose back before the solver overwrites it.
      node.updateMatrix();
      const p = parent[i]!;
      if (p >= 0 && inChain[p]) mul(anim, i * 16, anim, p * 16, node.matrix.elements);
      else mul(anim, i * 16, p < 0 ? root : (nodes[p]?.matrixWorld.elements ?? root), 0, node.matrix.elements);
    }

    const count = frame.boneCount;
    const world = frame.boneWorld;
    for (let i = 0; i < count; i++) {
      if (inChain[i]) toRetail(anim, i * 16, world, i * 16, flip);
      else {
        const node = nodes[i];
        toRetail(node ? node.matrixWorld.elements : root, 0, world, i * 16, flip);
      }
    }
    toRetail(root, 0, frame.placement, 0, flip);
    frame.dt = dt;
    this.instance.step(frame);
  }

  /** Bones from the solver, once every world of the frame has stepped. */
  write(): void {
    const { chain, nodes, parent, writer, next, inChain, instance, out } = this;
    const root = this.figure.root.matrixWorld;
    for (let c = 0; c < chain.length; c++) {
      const i = chain[c]!;
      const node = nodes[i];
      if (!node) continue;
      const body = writer[i]!;
      if (body >= 0 && instance.output(body, out, 0)) {
        fromRetail(out, _local);
        _world.multiplyMatrices(root, _local);
        writeInto(next, i * 16, _world.elements);
      } else {
        const p = parent[i]!;
        if (p >= 0 && inChain[p]) mul(next, i * 16, next, p * 16, node.matrix.elements);
        else mul(next, i * 16, p < 0 ? root.elements : (nodes[p]?.matrixWorld.elements ?? root.elements), 0, node.matrix.elements);
      }
      for (let k = 0; k < 16; k++) _world.elements[k] = next[i * 16 + k]!;
      // What three.js needs: this node's local matrix against its real scene parent.
      node.matrixWorld.copy(_world);
      if (node.parent) {
        _inv.copy(node.parent.matrixWorld).invert();
        node.matrix.multiplyMatrices(_inv, _world);
      } else {
        node.matrix.copy(_world);
      }
      node.matrixAutoUpdate = false;
      node.matrixWorldNeedsUpdate = false;
    }
    this.written = true;
  }

  /** Physics off: bones go back to their clips. */
  release(): void {
    if (!this.written) return;
    for (let c = 0; c < this.chain.length; c++) {
      const node = this.nodes[this.chain[c]!];
      if (node) node.matrixAutoUpdate = true;
    }
    this.written = false;
  }

  /** The solver starts over from the pose it next sees. */
  restart(): void {
    this.instance.dispose();
    this.instance = new PhysInstance(this.model, this.scene, this.attached);
  }

  dispose(): void {
    this.release();
    this.instance.dispose();
  }
}

/** out[at..] = m[o..] * b, column-major, for affine matrices. */
function mul(out: Float64Array, at: number, m: ArrayLike<number>, o: number, b: ArrayLike<number>): void {
  const m0 = m[o]!;
  const m1 = m[o + 1]!;
  const m2 = m[o + 2]!;
  const m4 = m[o + 4]!;
  const m5 = m[o + 5]!;
  const m6 = m[o + 6]!;
  const m8 = m[o + 8]!;
  const m9 = m[o + 9]!;
  const m10 = m[o + 10]!;
  const m12 = m[o + 12]!;
  const m13 = m[o + 13]!;
  const m14 = m[o + 14]!;
  for (let c = 0; c < 3; c++) {
    const x = b[c * 4]!;
    const y = b[c * 4 + 1]!;
    const z = b[c * 4 + 2]!;
    out[at + c * 4] = m0 * x + m4 * y + m8 * z;
    out[at + c * 4 + 1] = m1 * x + m5 * y + m9 * z;
    out[at + c * 4 + 2] = m2 * x + m6 * y + m10 * z;
    out[at + c * 4 + 3] = 0;
  }
  const x = b[12]!;
  const y = b[13]!;
  const z = b[14]!;
  out[at + 12] = m0 * x + m4 * y + m8 * z + m12;
  out[at + 13] = m1 * x + m5 * y + m9 * z + m13;
  out[at + 14] = m2 * x + m6 * y + m10 * z + m14;
  out[at + 15] = 1;
}

/** Column-major Y-up in, row-major retail axes out, optionally mirrored in retail X. */
function toRetail(from: ArrayLike<number>, at: number, out: Float64Array, to: number, flip: boolean): void {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = from[at + AXIS[c]! * 4 + AXIS[r]!]!;
      out[to + r * 4 + c] = flip && r === 0 ? -v : v;
    }
  }
}

/** Row-major retail axes in, column-major Y-up out. */
function fromRetail(from: Float64Array, out: Matrix4): void {
  const e = out.elements;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) e[AXIS[c]! * 4 + AXIS[r]!] = from[r * 4 + c]!;
  }
}

function writeInto(out: Float64Array, at: number, e: ArrayLike<number>): void {
  for (let k = 0; k < 16; k++) out[at + k] = e[k]!;
}
