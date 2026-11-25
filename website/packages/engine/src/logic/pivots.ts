/**
 * Clips arrive with each bone's translation baked: T = pivot + t - R(S * pivot). That
 * plays back exactly, but blending two clips blends T and R separately, and the
 * average of two baked translations is not the translation of the averaged rotation:
 * a limb rotating 90 degrees across a crossfade loses about 30% of its reach at the
 * midpoint. Retail blends t and R about the pivot. With the manifest's pivots this
 * turns each translation track back into t, and the bone composes the pivot itself.
 */
export interface TrackLike {
  name: string;
  times: ArrayLike<number>;
  values: ArrayLike<number> & { [i: number]: number };
}

function keyIndex(times: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const _q = [0, 0, 0, 1];
const _s = [1, 1, 1];

function sampleQuat(track: TrackLike, t: number): number[] {
  const n = track.times.length;
  const i = keyIndex(track.times, t);
  const j = Math.min(i + 1, n - 1);
  const span = track.times[j]! - track.times[i]!;
  const f = span > 0 ? Math.max(0, Math.min(1, (t - track.times[i]!) / span)) : 0;
  const a = i * 4;
  const b = j * 4;
  const v = track.values;
  const sign = v[a]! * v[b]! + v[a + 1]! * v[b + 1]! + v[a + 2]! * v[b + 2]! + v[a + 3]! * v[b + 3]! < 0 ? -1 : 1;
  let x = v[a]! + (v[b]! * sign - v[a]!) * f;
  let y = v[a + 1]! + (v[b + 1]! * sign - v[a + 1]!) * f;
  let z = v[a + 2]! + (v[b + 2]! * sign - v[a + 2]!) * f;
  let w = v[a + 3]! + (v[b + 3]! * sign - v[a + 3]!) * f;
  const l = Math.hypot(x, y, z, w) || 1;
  x /= l;
  y /= l;
  z /= l;
  w /= l;
  _q[0] = x;
  _q[1] = y;
  _q[2] = z;
  _q[3] = w;
  return _q;
}

function sampleVec(track: TrackLike, t: number): number[] {
  const n = track.times.length;
  const i = keyIndex(track.times, t);
  const j = Math.min(i + 1, n - 1);
  const span = track.times[j]! - track.times[i]!;
  const f = span > 0 ? Math.max(0, Math.min(1, (t - track.times[i]!) / span)) : 0;
  const v = track.values;
  for (let k = 0; k < 3; k++) _s[k] = v[i * 3 + k]! + (v[j * 3 + k]! - v[i * 3 + k]!) * f;
  return _s;
}

/** R * (S * p). */
function rotateScaled(q: readonly number[], s: readonly number[], p: readonly [number, number, number], out: number[]): void {
  const px = p[0] * s[0]!;
  const py = p[1] * s[1]!;
  const pz = p[2] * s[2]!;
  const [x, y, z, w] = q as [number, number, number, number];
  const ix = w * px + y * pz - z * py;
  const iy = w * py + z * px - x * pz;
  const iz = w * pz + x * py - y * px;
  const iw = -x * px - y * py - z * pz;
  out[0] = ix * w + iw * -x + iy * -z - iz * -y;
  out[1] = iy * w + iw * -y + iz * -x - ix * -z;
  out[2] = iz * w + iw * -z + ix * -y - iy * -x;
}

const NAME = /^(.*\b)?b(\d+)\.(position|quaternion|scale)$/;

/** Rewrites every bone's position track in place from baked T to retail's t. */
export function unbakeTranslations(tracks: readonly TrackLike[], pivots: readonly number[]): number {
  const byBone = new Map<number, { position?: TrackLike; quaternion?: TrackLike; scale?: TrackLike }>();
  for (const track of tracks) {
    const m = NAME.exec(track.name);
    if (!m) continue;
    const bone = Number(m[2]);
    let entry = byBone.get(bone);
    if (!entry) byBone.set(bone, (entry = {}));
    entry[m[3] as "position" | "quaternion" | "scale"] = track;
  }
  let changed = 0;
  const r = [0, 0, 0];
  for (const [bone, t] of byBone) {
    const position = t.position;
    if (!position) continue;
    const p: [number, number, number] = [pivots[bone * 3] ?? 0, pivots[bone * 3 + 1] ?? 0, pivots[bone * 3 + 2] ?? 0];
    if (p[0] === 0 && p[1] === 0 && p[2] === 0) continue;
    const values = position.values;
    for (let k = 0; k < position.times.length; k++) {
      const time = position.times[k]!;
      const q = t.quaternion ? sampleQuat(t.quaternion, time) : [0, 0, 0, 1];
      const s = t.scale ? sampleVec(t.scale, time) : [1, 1, 1];
      rotateScaled(q, s, p, r);
      values[k * 3] = values[k * 3]! - p[0] + r[0]!;
      values[k * 3 + 1] = values[k * 3 + 1]! - p[1] + r[1]!;
      values[k * 3 + 2] = values[k * 3 + 2]! - p[2] + r[2]!;
    }
    changed++;
  }
  return changed;
}

/** Bone index from a node name, prefix or not. */
export function boneIndex(name: string): number {
  const m = /(?:^|_)b(\d+)$/.exec(name);
  return m ? Number(m[1]) : -1;
}
