// THE BROADPHASE TREE, as the client keeps it: a 3D b2DynamicTree (ctor
// 0x1005D2880, alloc 0x1005D2930, create 0x1005D2A80, insert 0x1005D2B50, remove
// leaf 0x1005D30F0, destroy 0x1005D3060, move 0x1005D3280, rotate 0x1005D33B0,
// grandchild swap 0x1005D3BD0, optimise 0x1005D3EB0). Only its node ids leave it
// - a proxy's key - but which parent a removal frees, and so the id a later proxy
// takes, depends on the tree's shape, so every structural step is the client's:
// its operations in its order, its operand order in every min / max (minps keeps
// the second operand on a tie). Port of Physics.cpp `Tree`.
import { D, V3, fround } from './math';

export const kProxyMargin = fround(0.1);
const kFreeChild = 0x069f6bc7;

/** A node, and the box scratch of this file (same class, so every site stays monomorphic). */
export class TreeNode {
  lx = D;
  ly = D;
  lz = D;
  hx = D;
  hy = D;
  hz = D;
  area = D; // the last boxArea() of it
  parent = -1; // the free list's next while free
  c1 = -1;
  c2 = -1;
  height = 0; // -1 free, 0 leaf
  constructor() {
    this.lx = 0;
    this.ly = 0;
    this.lz = 0;
    this.hx = 0;
    this.hy = 0;
    this.hz = 0;
    this.area = 0;
  }
}

// Union(a.lo, a.hi, b.lo, b.hi): minps(a, b), maxps(a, b)
function boxUnion(o: TreeNode, a: TreeNode, b: TreeNode): void {
  const alx = a.lx;
  const aly = a.ly;
  const alz = a.lz;
  const ahx = a.hx;
  const ahy = a.hy;
  const ahz = a.hz;
  const blx = b.lx;
  const bly = b.ly;
  const blz = b.lz;
  const bhx = b.hx;
  const bhy = b.hy;
  const bhz = b.hz;
  o.lx = alx < blx ? alx : blx;
  o.ly = aly < bly ? aly : bly;
  o.lz = alz < blz ? alz : blz;
  o.hx = ahx > bhx ? ahx : bhx;
  o.hy = ahy > bhy ? ahy : bhy;
  o.hz = ahz > bhz ? ahz : bhz;
}
// half the surface area, as the client sums it: (z + y) x + z y
function boxArea(o: TreeNode): void {
  const x = o.hx - o.lx;
  const y = o.hy - o.ly;
  const z = o.hz - o.lz;
  o.area = (z + y) * x + z * y;
}
function boxCopy(o: TreeNode, a: TreeNode): void {
  o.lx = a.lx;
  o.ly = a.ly;
  o.lz = a.lz;
  o.hx = a.hx;
  o.hy = a.hy;
  o.hz = a.hz;
}
// the leaf box inside node c, every axis (cmpleps x 2, mask & 7)
function boxContains(c: TreeNode, L: TreeNode): boolean {
  return (
    L.hx <= c.hx && c.lx <= L.lx && L.hy <= c.hy && c.ly <= L.ly && L.hz <= c.hz && c.lz <= L.lz
  );
}

const uT = new TreeNode();
const uA = new TreeNode();
const uB = new TreeNode();
const bx0 = new TreeNode();
const bx1 = new TreeNode();
const bx2 = new TreeNode();
const bx3 = new TreeNode();

export class Tree {
  n: TreeNode[] = [];
  cap = 0;
  count = 0;
  freeHead = -1;
  root = -1;
  proxies = 0;
  cursor = 0;

  private alloc(): number {
    const n = this.n;
    if (this.freeHead === -1) {
      const grown = this.cap + ((this.cap / 2) | 0);
      const nc = grown >= 9 ? grown : 8;
      while (n.length < nc) n.push(new TreeNode());
      for (let i = this.count; i < nc; i++) {
        const t = n[i]!;
        t.parent = i + 1;
        t.c1 = kFreeChild;
        t.c2 = kFreeChild;
        t.height = -1;
      }
      n[nc - 1]!.parent = -1;
      this.cap = nc;
      this.freeHead = this.count;
    }
    const id = this.freeHead;
    const t = n[id]!;
    this.freeHead = t.parent;
    t.parent = -1;
    t.c1 = -1;
    t.c2 = -1;
    t.height = 0;
    this.count++;
    return id;
  }

  private free(i: number): void {
    if (i < 0 || i >= this.cap || this.count === 0) return;
    const t = this.n[i]!;
    t.parent = this.freeHead;
    t.c1 = kFreeChild;
    t.c2 = kFreeChild;
    t.height = -1;
    this.freeHead = i;
    this.count--;
  }

  private refit(i: number): void {
    const n = this.n;
    const t = n[i]!;
    const a = n[t.c1]!;
    const b = n[t.c2]!;
    boxUnion(t, a, b);
    const h1 = a.height;
    const h2 = b.height;
    t.height = (h1 > h2 ? h1 : h2) + 1;
  }

  /** The new leaf's node id, -1 for a box that is not valid. Margin: kProxyMargin. */
  create(lo: V3, hi: V3): number {
    // !(lo <= hi) also refuses NaN; x - x === 0 is isfinite
    if (!(lo.x <= hi.x) || lo.x - lo.x !== 0 || hi.x - hi.x !== 0) return -1;
    if (!(lo.y <= hi.y) || lo.y - lo.y !== 0 || hi.y - hi.y !== 0) return -1;
    if (!(lo.z <= hi.z) || lo.z - lo.z !== 0 || hi.z - hi.z !== 0) return -1;
    const id = this.alloc();
    const t = this.n[id]!;
    t.lx = lo.x - kProxyMargin;
    t.ly = lo.y - kProxyMargin;
    t.lz = lo.z - kProxyMargin;
    t.hx = kProxyMargin + hi.x;
    t.hy = kProxyMargin + hi.y;
    t.hz = kProxyMargin + hi.z;
    t.height = 0;
    this.insert(id);
    this.proxies++;
    return id;
  }

  destroy(id: number): void {
    if (id < 0 || id >= this.cap || this.n[id]!.height !== 0) return;
    this.removeLeaf(id);
    this.free(id);
    this.proxies--;
  }

  // reinserted when the tight box left the fat one, or the fat one is wider than
  // the tight one grown by 4 margins
  move(id: number, lo: V3, hi: V3): boolean {
    if (!(lo.x <= hi.x) || lo.x - lo.x !== 0) return false;
    if (!(lo.y <= hi.y) || lo.y - lo.y !== 0) return false;
    if (!(lo.z <= hi.z) || lo.z - lo.z !== 0) return false;
    if (id < 0) return false;
    if (hi.x - hi.x !== 0 || hi.y - hi.y !== 0 || hi.z - hi.z !== 0) return false;
    if (id >= this.cap || this.n[id]!.height !== 0) return false;
    const t = this.n[id]!;
    if (
      hi.x <= t.hx &&
      t.lx <= lo.x &&
      hi.y <= t.hy &&
      t.ly <= lo.y &&
      hi.z <= t.hz &&
      t.lz <= lo.z
    ) {
      const m4 = 4 * kProxyMargin;
      if (
        t.hx <= hi.x + m4 &&
        lo.x - m4 <= t.lx &&
        t.hy <= hi.y + m4 &&
        lo.y - m4 <= t.ly &&
        t.hz <= hi.z + m4 &&
        lo.z - m4 <= t.lz
      ) {
        return false;
      }
    }
    this.removeLeaf(id);
    t.lx = lo.x - kProxyMargin;
    t.ly = lo.y - kProxyMargin;
    t.lz = lo.z - kProxyMargin;
    t.hx = kProxyMargin + hi.x;
    t.hy = kProxyMargin + hi.y;
    t.hz = kProxyMargin + hi.z;
    this.insert(id);
    return true;
  }

  private insert(leaf: number): void {
    const n = this.n;
    if (leaf < 0 || leaf >= this.cap || n[leaf]!.height !== 0) return;
    if (this.root === -1) {
      this.root = leaf;
      n[leaf]!.parent = -1;
      return;
    }
    const L = n[leaf]!;
    let index = this.root;
    if (n[this.root]!.height > 0) {
      const lxx = L.hx - L.lx;
      const lyy = L.hy - L.ly;
      const lzz = L.hz - L.lz;
      const leafArea = lzz * lyy + (lzz + lyy) * lxx;
      const Cx = (L.hx + L.lx) * 0.5;
      const Cy = (L.hy + L.ly) * 0.5;
      const Cz = (L.hz + L.lz) * 0.5;
      for (;;) {
        const t = n[index]!;
        boxUnion(uT, t, L);
        boxArea(uT);
        const ca = uT.area;
        const combined2 = ca + ca;
        boxArea(t);
        const na = t.area;
        const inherit = combined2 - (na + na);
        // child 1
        const i1 = t.c1;
        const i2 = t.c2;
        let cost1 = 0;
        let in1 = false;
        {
          const a = n[i1]!;
          boxUnion(uA, a, L);
          if (a.height !== 0) {
            if (boxContains(a, L)) {
              in1 = true;
            } else {
              boxArea(uA);
              boxArea(a);
              const v = uA.area - a.area + leafArea;
              cost1 = v + v + inherit;
            }
          } else {
            boxArea(uA);
            const v = uA.area;
            cost1 = v + v + inherit;
          }
        }
        // child 2
        let next = i1;
        let decide = true;
        let cost2 = 0;
        {
          const b = n[i2]!;
          boxUnion(uB, b, L);
          if (b.height === 0) {
            boxArea(uB);
            const v = uB.area;
            cost2 = v + v + inherit;
          } else if (!boxContains(b, L)) {
            boxArea(uB);
            boxArea(b);
            const v = uB.area - b.area + leafArea;
            cost2 = v + v + inherit;
          } else if (in1) {
            // both hold the leaf: the nearer centre (z^2 + (x^2 + y^2))
            const a = n[i1]!;
            const e1x = (a.hx + a.lx) * 0.5 - Cx;
            const e1y = (a.hy + a.ly) * 0.5 - Cy;
            const e1z = (a.hz + a.lz) * 0.5 - Cz;
            const e2x = (b.hx + b.lx) * 0.5 - Cx;
            const e2y = (b.hy + b.ly) * 0.5 - Cy;
            const e2z = (b.hz + b.lz) * 0.5 - Cz;
            const d1 = e1z * e1z + (e1x * e1x + e1y * e1y);
            const d2 = e2z * e2z + (e2x * e2x + e2y * e2y);
            next = d1 >= d2 ? i2 : i1;
            decide = false;
          }
        }
        if (decide) {
          if (combined2 < (cost2 < cost1 ? cost2 : cost1)) break; // here: the sibling
          next = cost1 >= cost2 ? i2 : i1;
        }
        index = next;
        if (n[index]!.height <= 0) break;
      }
    }
    const sibling = index;
    const S = n[sibling]!;
    const oldParent = S.parent;
    const np = this.alloc();
    const p = n[np]!;
    p.parent = oldParent;
    boxUnion(p, L, S);
    p.height = S.height + 1;
    p.c1 = sibling;
    p.c2 = leaf;
    if (oldParent !== -1) {
      const O = n[oldParent]!;
      if (O.c1 === sibling) O.c1 = np;
      else O.c2 = np;
    } else {
      this.root = np;
    }
    S.parent = np;
    L.parent = np;
    for (let i = np; i !== -1; i = n[i]!.parent) {
      this.refit(i);
      this.rotate(i);
    }
  }

  private removeLeaf(leaf: number): void {
    const n = this.n;
    if (leaf < 0 || leaf >= this.cap || n[leaf]!.height !== 0) return;
    if (this.root === leaf) {
      this.root = -1;
      return;
    }
    const p = n[leaf]!.parent;
    const P = n[p]!;
    const g = P.parent;
    const s = P.c1 === leaf ? P.c2 : P.c1;
    if (g === -1) {
      this.root = s;
      n[s]!.parent = -1;
      this.free(p);
      return;
    }
    const G = n[g]!;
    if (G.c1 === p) G.c1 = s;
    else G.c2 = s;
    n[s]!.parent = g;
    this.free(p);
    for (let i = g; i !== -1; i = n[i]!.parent) this.refit(i);
  }

  // b2RotateNodes: swap a child of A with a grandchild under the other child when
  // that lowers the surface area (both children inner nodes: only within 3 levels
  // of height)
  private rotate(iA: number): void {
    const n = this.n;
    const A = n[iA]!;
    if (A.height < 2) return;
    const iB = A.c1;
    const iC = A.c2;
    const B = n[iB]!;
    const C = n[iC]!;
    if (B.height === 0) {
      const iF = C.c1;
      const iG = C.c2;
      const F = n[iF]!;
      const G = n[iG]!;
      boxArea(C);
      const base = C.area;
      boxUnion(bx0, G, B); // bg
      boxUnion(bx1, B, F); // bf
      boxArea(bx0);
      boxArea(bx1);
      const aBG = bx0.area;
      const aBF = bx1.area;
      const costBase = base + base;
      const costBF = aBG + aBG;
      const costBG = aBF + aBF;
      if (costBase < (costBG < costBF ? costBG : costBF)) return;
      if (costBF >= costBG) {
        // B <-> G: C keeps F and B
        A.c1 = iG;
        C.c2 = iB;
        B.parent = iC;
        G.parent = iA;
        boxCopy(C, bx1);
        C.height = (F.height > 0 ? F.height : B.height) + 1;
        A.height = (G.height <= C.height ? C.height : G.height) + 1;
      } else {
        // B <-> F: C keeps B and G
        A.c1 = iF;
        C.c1 = iB;
        B.parent = iC;
        F.parent = iA;
        boxCopy(C, bx0);
        C.height = (G.height < 0 ? B.height : G.height) + 1;
        A.height = (F.height <= C.height ? C.height : F.height) + 1;
      }
      return;
    }
    if (C.height === 0) {
      const iD = B.c1;
      const iE = B.c2;
      const D_ = n[iD]!;
      const E = n[iE]!;
      boxArea(B);
      const base = B.area;
      boxUnion(bx0, E, C); // ce
      boxUnion(bx1, C, D_); // cd
      boxArea(bx0);
      boxArea(bx1);
      const aCE = bx0.area;
      const aCD = bx1.area;
      const costBase = base + base;
      const costCD = aCE + aCE;
      const costCE = aCD + aCD;
      if (!(costBase >= (costCE < costCD ? costCE : costCD))) return;
      let up: number;
      if (costCD >= costCE) {
        // C <-> E: B keeps D and C
        A.c2 = iE;
        B.c2 = iC;
        C.parent = iB;
        E.parent = iA;
        boxCopy(B, bx1);
        B.height = (D_.height > 0 ? D_.height : C.height) + 1;
        up = iE;
      } else {
        // C <-> D: B keeps C and E
        A.c2 = iD;
        B.c1 = iC;
        C.parent = iB;
        D_.parent = iA;
        boxCopy(B, bx0);
        B.height = (E.height < 0 ? C.height : E.height) + 1;
        up = iD;
      }
      const hu = n[up]!.height;
      A.height = (B.height <= hu ? hu : B.height) + 1;
      return;
    }
    const iD = B.c1;
    const iE = B.c2;
    const iF = C.c1;
    const iG = C.c2;
    const D_ = n[iD]!;
    const E = n[iE]!;
    const F = n[iF]!;
    const G = n[iG]!;
    const hB = B.height;
    const hC = C.height;
    boxArea(B);
    boxArea(C);
    const areaB = B.area;
    const areaC = C.area;
    boxUnion(bx0, F, B); // fb
    boxUnion(bx1, B, G); // bg
    boxUnion(bx2, D_, C); // dc
    boxUnion(bx3, C, E); // ce
    boxArea(bx0);
    boxArea(bx1);
    boxArea(bx2);
    boxArea(bx3);
    const aFB = bx0.area;
    const aBG = bx1.area;
    const aDC = bx2.area;
    const aCE = bx3.area;
    const b2 = areaB + areaB;
    const c2 = areaC + areaC;
    const costBF = aBG + aBG + b2;
    const costBG = aFB + aFB + b2;
    const costCD = aCE + aCE + c2;
    const costCE = aDC + aDC + c2;
    let type = 0;
    let best = c2 + b2;
    if (costBF < best && hB < F.height + 3) {
      type = 1;
      best = costBF;
    }
    if (hB < G.height + 3 && costBG < best) {
      type = 2;
      best = costBG;
    }
    if (hC < D_.height + 3 && costCD < best) {
      type = 3;
      best = costCD;
    }
    if (hC < E.height + 3 && costCE < best) type = 4;
    if (type === 1) {
      // B <-> F: C keeps B and G
      A.c1 = iF;
      C.c1 = iB;
      B.parent = iC;
      F.parent = iA;
      boxCopy(C, bx1);
      C.height = (hB > G.height ? hB : G.height) + 1;
      A.height = (F.height > C.height ? F.height : C.height) + 1;
    } else if (type === 2) {
      // B <-> G: C keeps F and B
      A.c1 = iG;
      C.c2 = iB;
      B.parent = iC;
      G.parent = iA;
      boxCopy(C, bx0);
      C.height = (F.height > hB ? F.height : hB) + 1;
      A.height = (G.height > C.height ? G.height : C.height) + 1;
    } else if (type === 3) {
      // C <-> D: B keeps C and E
      A.c2 = iD;
      B.c1 = iC;
      C.parent = iB;
      D_.parent = iA;
      boxCopy(B, bx3);
      B.height = (hC > E.height ? hC : E.height) + 1;
      A.height = (B.height <= D_.height ? D_.height : B.height) + 1;
    } else if (type === 4) {
      // C <-> E: B keeps D and C
      A.c2 = iE;
      B.c2 = iC;
      C.parent = iB;
      E.parent = iA;
      boxCopy(B, bx2);
      B.height = (D_.height > hC ? D_.height : hC) + 1;
      A.height = (B.height <= E.height ? E.height : B.height) + 1;
    }
  }

  // both children inner nodes: swap a grandchild across them (D with F or G) when
  // the two children's surface falls
  private swapGrand(iA: number): void {
    const n = this.n;
    const A = n[iA]!;
    if (A.height < 2) return;
    const iB = A.c1;
    const iC = A.c2;
    const B = n[iB]!;
    const C = n[iC]!;
    if (B.height === 0 || C.height === 0) return;
    const iD = B.c1;
    const iE = B.c2;
    const iF = C.c1;
    const iG = C.c2;
    const D_ = n[iD]!;
    const E = n[iE]!;
    const F = n[iF]!;
    const G = n[iG]!;
    boxArea(B);
    boxArea(C);
    const aB = B.area;
    const sum = C.area + aB;
    const base = sum + sum;
    boxUnion(bx0, E, F); // ef
    boxUnion(bx1, D_, G); // dg
    boxUnion(bx2, E, G); // eg
    boxUnion(bx3, D_, F); // df
    boxArea(bx0);
    boxArea(bx1);
    boxArea(bx2);
    boxArea(bx3);
    const sDF = bx1.area + bx0.area;
    const costDF = sDF + sDF;
    const sDG = bx3.area + bx2.area;
    const costDG = sDG + sDG;
    let type = 6;
    if (costDG >= (costDF < base ? costDF : base)) type = costDF < base ? 5 : 0;
    if (type === 0) return;
    let up: number;
    let other: number;
    if (type === 6) {
      // D <-> G: B {G, E}, C {F, D}
      B.c1 = iG;
      C.c2 = iD;
      up = iG;
      other = iF;
      boxCopy(B, bx2);
      boxCopy(C, bx3);
    } else {
      // D <-> F: B {F, E}, C {D, G}
      B.c1 = iF;
      C.c1 = iD;
      up = iF;
      other = iG;
      boxCopy(B, bx0);
      boxCopy(C, bx1);
    }
    D_.parent = iC;
    n[up]!.parent = iB;
    const hu = n[up]!.height;
    const hE = E.height;
    B.height = (hE > hu ? hE : hu) + 1;
    const hD = D_.height;
    const ho = n[other]!.height;
    C.height = (hD > ho ? hD : ho) + 1;
  }

  // a few nodes a step, from a cursor that walks the whole array
  optimize(iters: number): void {
    const n = this.n;
    if (this.root === -1 || iters <= 0) return;
    let cur = this.cursor;
    for (let i = 0; i !== iters; i++) {
      if (n[cur]!.height === -1) {
        do cur = (cur + 1) % this.cap;
        while (n[cur]!.height === -1);
        this.cursor = cur;
      }
      this.rotate(cur);
      this.swapGrand(this.cursor);
      const c = this.cursor;
      for (let j = n[c]!.parent; j !== -1; j = n[j]!.parent) {
        const J = n[j]!;
        const h1 = n[J.c1]!.height;
        const h2 = n[J.c2]!.height;
        J.height = (h1 > h2 ? h1 : h2) + 1;
      }
      this.cursor = (c + 1) % this.cap;
      cur = this.cursor;
    }
  }
}
