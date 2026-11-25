r"""
gen.py - regenerates engine/test/fixtures/physics-golden-*.json from Eclipse's own solver.

    python engine/test/golden/physics/gen.py --eclipse <Eclipse repo>          # everything
    python engine/test/golden/physics/gen.py --eclipse <repo> --only 2053901   # one scenario

--eclipse or env ECLIPSE_REPO: the Eclipse checkout (its src/eclipse/races/Physics.cpp and
tools/midnight/midnight_physics_table.py are read, never changed; its parse and encode give
the C++ its row and the fixture its model). --raw or env PHYS_RAW_DIR: the raw file cache
(default work/raw/12.1.0.69933 of this repo): a missing file is copied from Eclipse's
re/out/races/art-12.1.0.69933 when that holds it, else fetched from wago.tools once. The
binaries and the double build's dumps (the test names the first differing frame from them)
stay in work/physics-golden/, gitignored; --keep also keeps the inputs and the float dumps.
Nothing is written outside it but the fixtures.

Three runs per scenario, all of Physics.cpp unchanged (harness.cpp says how):
  float      Eclipse's build, the reference
  nudged     the float build with one frame's placement moved 1 ULP: the yardstick
  double     float = double, exact estimates: the logic oracle, bit-equal to the TS port
The TS test recomputes hash chains and sampled errors from the fixture alone, and compares
frame by frame against these dumps when they are present.
"""
from __future__ import annotations
import argparse, hashlib, json, math, os, re, shutil, struct, subprocess, sys, urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
FIXTURES = os.path.join(REPO, "engine", "test", "fixtures")
WORK = os.path.join(REPO, "work", "physics-golden")
BUILD = "12.1.0.69933"
NUDGE_FRAME = 30

DEFAULT_DTS = [1 / 30, 1 / 60, 1 / 60, 1 / 75, 1 / 144]
# a hitch past the clamp and a paused frame, for the lives below
LIFE_DTS = [1 / 30, 1 / 60, 1 / 144, 1 / 20, 0.0, 1 / 75]


def spec(seed=1, scale=1.0, wobble=0.0, seconds=16.0, dts=None, cull=None, rescale=None, spin=None, mirror=False):
    return dict(seed=seed, scale=scale, wobble=wobble, seconds=seconds, dts=dts or DEFAULT_DTS,
                cull=cull, rescale=rescale, spin=spin, mirror=mirror)


def item(fdid, join=0, leave=-1, attached=True, patch=None):
    return dict(fdid=fdid, join=join, leave=leave, attached=attached, patch=patch)


# patches make synthetic rows: real files with a feature switched on, to run every path
# of the port against the C++ even where no shipped file goes. Hash-only: logic, not data.
def shoulder_modes(r):
    """Shoulders: every third one a position motor, every third a velocity motor."""
    for k, j in enumerate(r["joints"]):
        if j["type"] == 7:
            j["mode"] = (1, 2, 0)[k % 3]
            f = list(j["f"])
            f[3] = 0.4
            f[0], f[1] = -20.0, 25.0
            f[2] = 35.0
            j["f"] = tuple(f)


def revolute_modes(r):
    for k, j in enumerate(r["joints"]):
        if j["type"] == 6:
            j["mode"] = (1, 2, 0)[k % 3]
            f = list(j["f"])
            f[0], f[1], f[2] = (-15.0, 15.0, 0.3) if k % 2 == 0 else (0.5, 1.0, 0.3)
            j["f"] = tuple(f)


def locked_limits(r):
    """Twist ranges under the lock threshold, narrow cones, revolute halves under it."""
    for j in r["joints"]:
        f = list(j["f"])
        if j["type"] == 7:
            f[0], f[1], f[2] = -1.0, 1.0, 12.0
        elif j["type"] == 6:
            f[0], f[1] = -1.0, 1.0
        j["f"] = tuple(f)


def prismatic_limits(r):
    for k, j in enumerate(r["joints"]):
        if j["type"] == 5:
            f = list(j["f"])
            f[0], f[1] = ((-0.02, 0.02) if k % 2 == 0 else (0.0, 0.002))
            j["f"] = tuple(f)
            j["mode"] = 0 if k % 3 == 2 else 1


def soft_welds(r):
    for k, j in enumerate(r["joints"]):
        if j["type"] == 9:
            f = list(j["f"])
            f[0], f[1], f[2], f[3] = (6.0, 0.5, 4.0, 0.7) if k % 2 == 0 else (-1.0, 0.0, 0.0, 0.0)
            j["f"] = tuple(f)


def all_static_ends(r):
    """A static body in the chain (the type the table allows but no file uses here)."""
    for b in r["bodies"]:
        if b["type"] == 1:
            b["group"] = 0
            break


def spheres(r):
    """Capsules with a == b: the sphere path of mass, boxes and the narrowphase."""
    for k, s in enumerate(r["shapes"]):
        if s["type"] == 1 and k % 2 == 0:
            s["type"] = 0
            s["b"] = s["a"]


def restitution(r):
    for s in r["shapes"]:
        s["restitution"] = 0.6
        s["friction"] = 0.2


def huge_gravity(r):
    """Fast bodies: the velocity caps and the fat-box refit."""
    for b in r["bodies"]:
        b["g"] = 40.0
        b["ld"] = 0.0
        b["ad"] = 0.0


def shrink_cones_big_scale(r):
    locked_limits(r)
    huge_gravity(r)


def collide_all(r):
    """Every body pair in reach: long capsules and fat radii, joints only on the chain."""
    for s in r["shapes"]:
        s["r"] = s["r"] * 2.0 + 0.04


def no_limits(r):
    """lower >= upper: no twist or hinge limit, no prismatic limit."""
    for j in r["joints"]:
        f = list(j["f"])
        if j["type"] in (6, 7):
            f[0], f[1] = 5.0, -5.0
        elif j["type"] == 5:
            f[0], f[1] = 1.0, -1.0
        j["f"] = tuple(f)


def rigid_welds(r):
    """Hz 0 both ways: the weld's position correction, angular and linear."""
    for j in r["joints"]:
        if j["type"] == 9:
            j["f"] = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0)


def prismatic_dynamic(r):
    """The second prismatic hangs on the first one's body: a dynamic A."""
    pr = [j for j in r["joints"] if j["type"] == 5]
    pr[1]["a"] = pr[0]["b"]


def prismatic_velocity(r):
    for j in r["joints"]:
        if j["type"] == 5:
            j["mode"] = 2
            f = list(j["f"])
            f[2] = 0.5
            j["f"] = tuple(f)


def odd_hull(r):
    """An odd vertex count: the box loop's last, lone vertex."""
    for h in r["hulls"]:
        h["v"] = list(h["v"]) + [h["v"][-1]]


def static_body(r):
    """The first dynamic body with a shape stays where it is made."""
    has = {s["body"] for s in r["shapes"]}
    for i, b in enumerate(r["bodies"]):
        if b["type"] == 0 and i in has:
            b["type"] = 2
            return


def thin(r):
    """Radius 0 on every other capsule: rolling 0, a body of no mass."""
    for k, s in enumerate(r["shapes"]):
        if s["type"] == 1 and k % 2 == 0:
            s["r"] = 0.0


def bigger_hulls(r):
    k = 1.6
    for h in r["hulls"]:
        h["v"] = [tuple(x * k for x in v) for v in h["v"]]
        h["planes"] = [(p[0], p[1], p[2], p[3] * k) for p in h["planes"]]
        h["cen"] = tuple(x * k for x in h["cen"])
        h["vol"] = h["vol"] * k * k * k
        h["area"] = h["area"] * k * k


def swapped(r):
    """Every joint with its ends exchanged: A dynamic, B kinematic - the other half of the
    asymmetric code, which the files (kinematic first) leave out."""
    for j in r["joints"]:
        j["a"], j["b"] = j["b"], j["a"]
        j["pa"], j["pb"] = j["pb"], j["pa"]
        j["fa"], j["fb"] = j["fb"], j["fa"]


def degenerate(r):
    """Capsules of no length, still typed as capsules."""
    for k, s in enumerate(r["shapes"]):
        if s["type"] == 1 and k % 2 == 0:
            s["b"] = s["a"]


def freefall(r):
    """No joint holds anything: the velocity cap, the fat boxes leaving the tree's area."""
    r["joints"] = []
    for b in r["bodies"]:
        b["g"] = 60.0
        b["ld"] = 0.0
        b["ad"] = 0.0


def two_static(r):
    """Two statics with shapes: the pair two non-dynamic bodies never make."""
    has = {s["body"] for s in r["shapes"]}
    n = 0
    for i, b in enumerate(r["bodies"]):
        if b["type"] == 0 and i in has and n < 2:
            b["type"] = 2
            n += 1


def damped(r):
    """Damping past both ends of the clamp 0 .. 1."""
    for k, b in enumerate(r["bodies"]):
        b["ld"] = 120.0 if k % 2 == 0 else -2.0
        b["ad"] = -2.0 if k % 2 == 0 else 120.0


def no_heads(r):
    """No group names a head: the first kinematic body heads, every later body names it."""
    for b in r["bodies"]:
        b["group"] = 0


def root_head(r):
    """A head that is also the root (0x4000): its followers ride the root's delta."""
    for b in r["bodies"]:
        if b["type"] == 1:
            b["group"] = 0xC000
            return


def root_plain(r):
    """The root on a kinematic body that is no head; the other heads carry by its delta."""
    kin = [b for b in r["bodies"] if b["type"] == 1]
    kin[-1]["group"] = 0x4000


def carry_zero(r):
    """No teleport under the limits: the whole move is velocity, s = 0."""
    for b in r["bodies"]:
        b["carry"] = 0.0


def no_bone(r):
    """Bodies with no bone: driven to the placement, the pivot at the origin."""
    seen = set()
    for b in r["bodies"]:
        if b["type"] not in seen:
            seen.add(b["type"])
            b["bone"] = 0xFFFF


def wide_cones(r):
    for k, j in enumerate(r["joints"]):
        f = list(j["f"])
        if j["type"] == 7:
            f[2] = 5.0 if k % 2 == 0 else 179.0
        elif j["type"] == 6:
            f[0], f[1] = (-400.0, 400.0) if k % 2 == 0 else (400.0, 500.0)
        j["f"] = tuple(f)


def both(*patches):
    def run_all(r):
        for p in patches:
            p(r)
    return run_all


SCENARIOS = {
    # real files, the brief's set
    "2053901": dict(items=[item(2053901)], spec=spec(seed=1)),
    "4497847": dict(items=[item(4497847)], spec=spec(seed=2)),
    "5653229": dict(items=[item(5653229)], spec=spec(seed=3)),
    "1267671": dict(items=[item(1267671)], spec=spec(seed=4)),
    "1323353": dict(items=[item(1323353)], spec=spec(seed=5)),
    "1251460": dict(items=[item(1251460)], spec=spec(seed=6)),
    "7547983": dict(items=[item(7547983)], spec=spec(seed=7)),
    "pair": dict(items=[item(5653229), item(1264903)], spec=spec(seed=8)),
    # real files the brief's set misses: a shoulder motor (mode 1), hull against hull in an
    # own world, a placement-driven PHYT 0
    "5653268": dict(items=[item(5653268)], spec=spec(seed=9)),
    "5425295": dict(items=[item(5425295)], spec=spec(seed=10)),
    "6032612": dict(items=[item(6032612)], spec=spec(seed=11)),
    # lives: joining and leaving, culling, a rescale, independent bones, hitches, paused
    # frames (hash only)
    "life-scene": dict(items=[item(5653229), item(1264903, join=120), item(6032612, join=30, leave=400),
                              item(1251460, join=200), item(1267671, join=300, leave=700)],
                       spec=spec(seed=21, scale=1.0, wobble=0.14, dts=LIFE_DTS, cull=[9.0, 9.6],
                                 rescale=[12.0, 1.2]), hash_only=True),
    "life-own": dict(items=[item(2053901)], spec=spec(seed=22, scale=1.35, wobble=0.14, dts=LIFE_DTS,
                                                      cull=[9.0, 9.6], rescale=[12.0, 1.1]), hash_only=True),
    "life-hull": dict(items=[item(5425295)], spec=spec(seed=23, scale=0.8, wobble=0.2, dts=LIFE_DTS,
                                                       cull=[4.0, 4.5], rescale=[9.0, 1.3]), hash_only=True),
    "life-hullcaps": dict(items=[item(1251460), item(6032612, attached=False)],
                          spec=spec(seed=24, wobble=0.2, dts=LIFE_DTS, cull=[7.0, 7.5], rescale=[13.0, 0.9]),
                          hash_only=True),
    # synthetic rows: paths no file of the set reaches (hash only)
    "synth-shoulder": dict(items=[item(2053901, patch=shoulder_modes)], spec=spec(seed=31, wobble=0.2), hash_only=True),
    "synth-revolute": dict(items=[item(2053901, patch=revolute_modes)], spec=spec(seed=32, wobble=0.2), hash_only=True),
    "synth-locked": dict(items=[item(1323353, patch=locked_limits)], spec=spec(seed=33, wobble=0.2), hash_only=True),
    "synth-prismatic": dict(items=[item(5653229, patch=prismatic_limits)], spec=spec(seed=34, wobble=0.3), hash_only=True),
    "synth-weld": dict(items=[item(7547983, patch=soft_welds)], spec=spec(seed=35, wobble=0.2), hash_only=True),
    "synth-spheres": dict(items=[item(1323353, patch=spheres)], spec=spec(seed=36, wobble=0.2), hash_only=True),
    "synth-restitution": dict(items=[item(5425295, patch=restitution), ], spec=spec(seed=37, wobble=0.3), hash_only=True),
    "synth-fast": dict(items=[item(2053901, patch=huge_gravity)], spec=spec(seed=38, wobble=0.3), hash_only=True),
    "synth-fat": dict(items=[item(1323353, patch=collide_all)], spec=spec(seed=39, wobble=0.3), hash_only=True),
    "synth-fat-hull": dict(items=[item(1251460, patch=collide_all)], spec=spec(seed=40, wobble=0.3), hash_only=True),
    "synth-nolimit": dict(items=[item(2053901, patch=no_limits)], spec=spec(seed=41, wobble=0.2), hash_only=True),
    "synth-nolimit-p": dict(items=[item(5653229, patch=no_limits)], spec=spec(seed=42, wobble=0.2), hash_only=True),
    "synth-rigid-weld": dict(items=[item(7547983, patch=rigid_welds)], spec=spec(seed=43, wobble=0.2), hash_only=True),
    "synth-pris-dyn": dict(items=[item(5653229, patch=prismatic_dynamic)], spec=spec(seed=44, wobble=0.3), hash_only=True),
    "synth-pris-vel": dict(items=[item(5653229, patch=prismatic_velocity)], spec=spec(seed=45, wobble=0.3), hash_only=True),
    "synth-pris-hard": dict(items=[item(5653229, patch=both(prismatic_limits, prismatic_dynamic, huge_gravity))],
                            spec=spec(seed=46, wobble=0.6), hash_only=True),
    "synth-odd-hull": dict(items=[item(4497847, patch=odd_hull)], spec=spec(seed=47, wobble=0.2), hash_only=True),
    "synth-static": dict(items=[item(7547983, patch=static_body)], spec=spec(seed=48, wobble=0.3), hash_only=True),
    "synth-static-scene": dict(items=[item(1267671, patch=static_body, leave=500), item(5653229), item(1251460, patch=static_body)],
                               spec=spec(seed=49, wobble=0.3), hash_only=True),
    "synth-thin": dict(items=[item(1323353, patch=thin)], spec=spec(seed=50, wobble=0.3), hash_only=True),
    "synth-sphere-hull": dict(items=[item(1251460, patch=both(spheres, collide_all))], spec=spec(seed=51, wobble=0.4), hash_only=True),
    "synth-big-hull": dict(items=[item(5425295, patch=bigger_hulls)], spec=spec(seed=52, wobble=0.5), hash_only=True),
    "synth-big-hull2": dict(items=[item(4497847, patch=bigger_hulls)], spec=spec(seed=53, wobble=0.5), hash_only=True),
    "synth-big-hull3": dict(items=[item(1251460, patch=both(bigger_hulls, collide_all))], spec=spec(seed=54, wobble=0.5), hash_only=True),
    "synth-violent": dict(items=[item(1323353, patch=shrink_cones_big_scale)], spec=spec(seed=55, wobble=0.6, dts=LIFE_DTS), hash_only=True),
    "synth-violent2": dict(items=[item(2053901, patch=shrink_cones_big_scale)], spec=spec(seed=56, wobble=0.6, dts=LIFE_DTS), hash_only=True),
    "synth-swap": dict(items=[item(2053901, patch=swapped)], spec=spec(seed=57, wobble=0.3), hash_only=True),
    "synth-swap-w": dict(items=[item(7547983, patch=swapped)], spec=spec(seed=58, wobble=0.3), hash_only=True),
    "synth-swap-p": dict(items=[item(5653229, patch=swapped)], spec=spec(seed=59, wobble=0.3), hash_only=True),
    "synth-swap-m": dict(items=[item(2053901, patch=both(swapped, shoulder_modes, revolute_modes))],
                         spec=spec(seed=60, wobble=0.5), hash_only=True),
    "synth-degen": dict(items=[item(1323353, patch=degenerate)], spec=spec(seed=61, wobble=0.4), hash_only=True),
    "synth-freefall": dict(items=[item(2053901, patch=freefall)], spec=spec(seed=62, wobble=0.2), hash_only=True),
    "synth-2static": dict(items=[item(7547983, patch=two_static)], spec=spec(seed=63, wobble=0.3), hash_only=True),
    "synth-damped": dict(items=[item(1323353, patch=damped)], spec=spec(seed=64, wobble=0.3), hash_only=True),
    "synth-motors-hard": dict(items=[item(2053901, patch=both(shoulder_modes, huge_gravity))],
                              spec=spec(seed=65, wobble=0.6, dts=LIFE_DTS), hash_only=True),
    "synth-noheads": dict(items=[item(2053901, patch=no_heads)], spec=spec(seed=66, wobble=0.2), hash_only=True),
    "synth-root-head": dict(items=[item(1323353, patch=root_head)], spec=spec(seed=67, wobble=0.3), hash_only=True),
    "synth-root-plain": dict(items=[item(1323353, patch=root_plain)], spec=spec(seed=68, wobble=0.3), hash_only=True),
    "synth-carry0": dict(items=[item(2053901, patch=carry_zero)], spec=spec(seed=69, wobble=0.2), hash_only=True),
    "synth-carry0-root": dict(items=[item(1323353, patch=both(carry_zero, root_head))], spec=spec(seed=70, wobble=0.2), hash_only=True),
    "synth-carry0-none": dict(items=[item(7547983, patch=both(carry_zero, no_heads))], spec=spec(seed=71, wobble=0.2), hash_only=True),
    "synth-nobone": dict(items=[item(7547983, patch=no_bone)], spec=spec(seed=72, wobble=0.2), hash_only=True),
    "synth-cones": dict(items=[item(2053901, patch=wide_cones)], spec=spec(seed=73, wobble=0.3), hash_only=True),
    "life-tiny": dict(items=[item(2053901)], spec=spec(seed=74, wobble=0.1, rescale=[12.0, 0.01]), hash_only=True),
    "life-mirror": dict(items=[item(1323353)], spec=spec(seed=75, wobble=0.1, mirror=True), hash_only=True),
    "life-spin": dict(items=[item(1323353)], spec=spec(seed=76, spin=[8.0, 2.0]), hash_only=True),
    "life-spin2": dict(items=[item(2053901), item(7547983)], spec=spec(seed=77, wobble=0.1, spin=[7.5, 1.0], mirror=True), hash_only=True),
}


# --- motion: the same arithmetic as motion.ts, operation for operation -----------------
def motion_times(s):
    out, r, t = [], s["seed"] & 0xFFFFFFFF, 0.0
    while t < s["seconds"]:
        r = (((r * 1664525) & 0xFFFFFFFF) + 1013904223) & 0xFFFFFFFF
        dt = s["dts"][(r >> 16) % len(s["dts"])]
        t += dt
        out.append((dt, t))
    return out


def wave(t, hz):
    p = t * hz
    p = p - math.floor(p)
    return 16 * p * (0.5 - p) if p < 0.5 else -16 * (p - 0.5) * (1 - p)


def qmul(a, b):
    return (a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
            a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
            a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2])


def qnorm(q):
    k = 1 / math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
    return (q[0] * k, q[1] * k, q[2] * k, q[3] * k)


def qmat(q):
    x, y, z, w = q
    return (1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
            2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
            2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y))


def placement_at(s, t):
    x = y = z = pitch = roll = 0.0
    if 1 <= t < 3:
        x = 2.5 * (t - 1)
        z = 0.03 * wave(t, 2)
        roll = 0.05 * wave(t, 1)
    elif t >= 3:
        x = 5.0
    if 3 <= t < 5:
        x = 5 + 7 * (t - 3)
        z = 0.06 * wave(t, 3)
        pitch = 0.1 * wave(t, 3)
    elif t >= 5:
        x = 19.0
    if 5 <= t <= 6:
        z = 1.6 * 4 * (t - 5) * (6 - t)
    v = (t - 6.5) / 0.5
    v = 0.0 if v < 0 else 1.0 if v > 1 else v
    if 8 <= t < 10:
        k = (t - 8) / 0.4
        k2 = (10 - t) / 0.4
        if k2 < k:
            k = k2
        if 1 < k:
            k = 1.0
        z = -0.5 * k
        pitch = pitch + -0.17 * k
    if t >= 11:
        z = z + 1
        y = 2.0
    qy = qnorm((0.0, 0.0, v, 1 - v))
    qp = qnorm((0.0, pitch * 0.5, 0.0, 1.0))
    qr = qnorm((roll * 0.5, 0.0, 0.0, 1.0))
    q = qmul(qmul(qy, qp), qr)
    if s["spin"]:
        w = (t - s["spin"][0]) * s["spin"][1]
        w = 0.0 if w < 0 else 1.0 if w > 1 else w
        q = qmul(qnorm((0.0, 0.0, w, 1 - w)), q)
    R = qmat(qnorm(q))
    sc = s["scale"]
    if s["rescale"] and t >= s["rescale"][0]:
        sc = s["rescale"][1]
    m = -1 if s["mirror"] else 1
    return [R[0] * sc, R[1] * sc, R[2] * sc * m, x, R[3] * sc, R[4] * sc, R[5] * sc * m, y,
            R[6] * sc, R[7] * sc, R[8] * sc * m, z + 1, 0.0, 0.0, 0.0, 1.0]


def bones_at(s, t, P, piv):
    """Flat list of len(piv) x 16 doubles; only called when there is a wobble."""
    out = []
    for b, (px, py, pz) in enumerate(piv):
        a = s["wobble"] * wave(t, 0.7 + 0.13 * (b % 5))
        ax = b % 3
        R = qmat(qnorm((a * 0.5 if ax == 0 else 0.0, a * 0.5 if ax == 1 else 0.0, a * 0.5 if ax == 2 else 0.0, 1.0)))
        tx = px - (R[0] * px + R[1] * py + R[2] * pz)
        ty = py - (R[3] * px + R[4] * py + R[5] * pz)
        tz = pz - (R[6] * px + R[7] * py + R[8] * pz)
        for r in range(3):
            p0, p1, p2 = P[r * 4], P[r * 4 + 1], P[r * 4 + 2]
            out += [p0 * R[0] + p1 * R[3] + p2 * R[6], p0 * R[1] + p1 * R[4] + p2 * R[7],
                    p0 * R[2] + p1 * R[5] + p2 * R[8], p0 * tx + p1 * ty + p2 * tz + P[r * 4 + 3]]
        out += [0.0, 0.0, 0.0, 1.0]
    return out


def cam_at(s, t):
    return 20000.0 if s["cull"] and s["cull"][0] <= t < s["cull"][1] else 0.0


# --- the raw files ----------------------------------------------------------------------
class Raw:
    def __init__(self, raw_dir, eclipse):
        self.dir = raw_dir
        self.art = os.path.join(eclipse, "re", "out", "races", "art-" + BUILD)
        os.makedirs(raw_dir, exist_ok=True)

    def read(self, fdid):
        p = os.path.join(self.dir, str(fdid))
        if not os.path.isfile(p) or os.path.getsize(p) == 0:
            a = os.path.join(self.art, str(fdid))
            if os.path.isfile(a):
                shutil.copyfile(a, p)
            else:
                url = "https://wago.tools/api/casc/%d?download&version=%s" % (fdid, BUILD)
                data = urllib.request.urlopen(url, timeout=60).read()
                if not data or not any(data[:256]):
                    raise SystemExit("wago miss for %d" % fdid)
                with open(p + ".tmp", "wb") as fh:
                    fh.write(data)
                os.replace(p + ".tmp", p)
        with open(p, "rb") as fh:
            return fh.read()


def chunks(raw):
    out, o = {}, 0
    while o + 8 <= len(raw):
        tag = raw[o:o + 4].decode("latin-1")
        n = struct.unpack_from("<I", raw, o + 4)[0]
        out[tag] = raw[o + 8:o + 8 + n]
        o += 8 + n
    return out


def model_physics(raw_cache, fdid):
    """(.phys blob, bone pivots) of an M2 at the pinned build: inline PFDC, else the PFID file."""
    raw = raw_cache.read(fdid)
    c = chunks(raw)
    if "PFDC" in c:
        blob = c["PFDC"]
    elif "PFID" in c:
        blob = raw_cache.read(struct.unpack_from("<I", c["PFID"], 0)[0])
    else:
        raise SystemExit("%d has no physics" % fdid)
    md = c["MD21"]
    nb, ob = struct.unpack_from("<II", md, 0x2C)
    return blob, [struct.unpack_from("<3f", md, ob + i * 88 + 76) for i in range(nb)]


# --- rows -------------------------------------------------------------------------------
def encode_row(path, r, fc):
    """midnight_physics_table.encode's layout, floats as `fc` ('f', or 'd' for the double build)."""
    p = path.encode("latin-1")
    out = bytearray(struct.pack("<H", len(p)) + p)
    out += b"\0" * (-len(out) % 4)
    out += struct.pack("<BBBB", len(r["bodies"]), len(r["shapes"]), len(r["joints"]), len(r["hulls"]))
    out += struct.pack("<BBH", r["mode"], 0, 0)
    for b in r["bodies"]:
        out += struct.pack("<BBH3%s5%sHH" % (fc, fc), b["type"], 0, b["bone"], *b["pos"], b["g"], b["inertia"],
                           b["ld"], b["ad"], b["carry"], b["group"], 0)
    for s in r["shapes"]:
        out += struct.pack("<BBH3%s3%s3%s%s" % (fc, fc, fc, fc), s["body"], s["type"], s["hull"], s["friction"],
                           s["restitution"], s["density"], *s["a"], *s["b"], s["r"])
    for j in r["joints"]:
        out += struct.pack("<BBBb3%s3%s9%s9%s6%s" % (fc, fc, fc, fc, fc), j["type"], j["a"], j["b"], j["mode"],
                           *j["pa"], *j["pb"], *j["fa"], *j["fb"], *j["f"])
    for h in r["hulls"]:
        out += struct.pack("<BBBB", len(h["v"]), len(h["planes"]), len(h["edge"]) // 4, 0)
        out += struct.pack("<5%s" % fc, *h["cen"], h["vol"], h["area"])
        for v in h["v"]:
            out += struct.pack("<3%s" % fc, *v)
        for pl in h["planes"]:
            out += struct.pack("<4%s" % fc, *pl)
        out += h["face"] + h["edge"]
        out += b"\0" * (-len(out) % 4)
    return bytes(out)


def table_of(T, rows):
    blocks = {T.norm_path(p): b for p, b in rows}
    keys = sorted(blocks, key=T.fnv1a)
    out = bytearray(b"PHY3" + struct.pack("<I", len(keys)))
    off = 8 + 8 * len(keys)
    for k in keys:
        out += struct.pack("<II", T.fnv1a(k), off)
        off += len(blocks[k])
    for k in keys:
        out += blocks[k]
    return bytes(out)


def f32(x):
    """The shortest decimal that reads back as this float32."""
    s = np.format_float_scientific(np.float32(x), unique=True, trim="-")
    return float(s)


def fl(xs):
    return [f32(x) for x in xs]


def model_json(r):
    return dict(
        mode=r["mode"],
        bodies=[dict(type=b["type"], bone=b["bone"], pos=fl(b["pos"]), gravity=f32(b["g"]), inertia=f32(b["inertia"]),
                     linDamp=f32(b["ld"]), angDamp=f32(b["ad"]), carry=f32(b["carry"]), group=b["group"])
                for b in r["bodies"]],
        shapes=[dict(body=s["body"], type=s["type"], hull=s["hull"], friction=f32(s["friction"]),
                     restitution=f32(s["restitution"]), density=f32(s["density"]), a=fl(s["a"]), b=fl(s["b"]), r=f32(s["r"]))
                for s in r["shapes"]],
        joints=[dict(type=j["type"], a=j["a"], b=j["b"], mode=j["mode"], pa=fl(j["pa"]), pb=fl(j["pb"]),
                     fa=fl(j["fa"]), fb=fl(j["fb"]), f=fl(j["f"])) for j in r["joints"]],
        hulls=[dict(centroid=fl(h["cen"]), volume=f32(h["vol"]), area=f32(h["area"]), v=[fl(v) for v in h["v"]],
                    n=[fl(p[:3]) for p in h["planes"]], d=[f32(p[3]) for p in h["planes"]],
                    face=list(h["face"]), edge=list(h["edge"])) for h in r["hulls"]],
    )


# --- the harness ------------------------------------------------------------------------
def build_exes(eclipse, msvc):
    races = os.path.join(eclipse, "src", "eclipse", "races")
    cpp = os.path.join(races, "Physics.cpp")
    h = hashlib.sha256()
    for p in (os.path.join(HERE, "harness.cpp"), cpp, os.path.join(races, "Physics.h")):
        with open(p, "rb") as fh:
            h.update(fh.read())
    tag = h.hexdigest()[:12]
    vc = next((p for p in msvc.candidates() if os.path.isfile(p)), None)
    if not vc:
        raise SystemExit("no 32-bit MSVC (vcvars32.bat) found")
    exes = {}
    for kind, flags, srcs in (("float", "", [os.path.join(HERE, "harness.cpp"), cpp]),
                              ("double", "/DPHYS_GOLD_DOUBLE", [os.path.join(HERE, "harness.cpp")])):
        d = os.path.join(WORK, "build-" + kind)
        os.makedirs(d, exist_ok=True)
        exe = os.path.join(d, "harness_%s.exe" % tag)
        if kind == "double":
            # The float build compiles the original. The oracle needs one spelling change
            # the preprocessor cannot make: a lambda that deduces its return type from
            # `return 0.0f;` beside a double. Same values, in a generated copy.
            with open(cpp, encoding="utf-8", newline="") as fh:
                src = fh.read()
            src = re.sub(r"return (\d+\.\d+f);", r"return double(\1);", src)
            with open(os.path.join(d, "Physics_double.cpp"), "w", encoding="utf-8", newline="") as fh:
                fh.write(src)
            flags += ' /I"%s"' % d
        if not os.path.isfile(exe):
            bat = os.path.join(d, "build.bat")
            with open(bat, "w") as fh:
                fh.write('@call "%s" >nul\r\ncl /nologo /O2 /EHsc /std:c++20 /fp:precise %s /I"%s" /Fe"%s" %s >"%s\\cl.log" 2>&1\r\n'
                         % (vc, flags, races, exe, " ".join('"%s"' % s for s in srcs), d))
            subprocess.run(["cmd", "/c", bat], cwd=d, check=False)
            if not os.path.isfile(exe):
                raise SystemExit("harness (%s) did not compile:\n%s"
                                 % (kind, open(os.path.join(d, "cl.log"), errors="replace").read()[-3000:]))
        exes[kind] = exe
    return exes


def write_input(path, table, items, frames):
    """items: [(row path, pivots, attached, join, leave)]; frames: [(dt, cam, P, bones or None)]."""
    with open(path, "wb") as fh:
        fh.write(struct.pack("<I", len(table)) + table)
        fh.write(struct.pack("<I", len(items)))
        for rp, piv, att, join, leave in items:
            pb = rp.encode("latin-1")
            fh.write(struct.pack("<H", len(pb)) + pb + struct.pack("<I", len(piv)))
            for v in piv:
                fh.write(struct.pack("<3f", *v))
            fh.write(struct.pack("<Bii", 1 if att else 0, join, leave))
        fh.write(struct.pack("<I", len(frames)))
        for dt, cam, P, bones in frames:
            fh.write(struct.pack("<dd16dB", dt, cam, *P, 1 if bones is not None else 0))
            if bones is not None:
                for b in bones:
                    fh.write(struct.pack("<%dd" % len(b), *b))


def run(exe, inp, out, nudge=None):
    args = [exe, inp, out] + ([str(nudge)] if nudge is not None else [])
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("harness exit %d: %s" % (r.returncode, r.stderr[-500:]))
    with open(out, "rb") as fh:
        raw = fh.read()
    total, nf = struct.unpack_from("<II", raw, 0)
    return np.frombuffer(raw, np.float64, offset=8).reshape(nf, total, 13)  # from bytes: no file held


def hash_chain(A, every):
    """Rolling FNV over each frame's valid bodies: index, then the 12 values' IEEE bits."""
    h = 0x811C9DC5
    chain = []
    words = (A[:, :, 1:] + 0.0).tobytes()
    W = np.frombuffer(words, np.uint32).reshape(A.shape[0], A.shape[1], 24)
    V = A[:, :, 0]
    nf, nb = A.shape[0], A.shape[1]
    P = 16777619
    for f in range(nf):
        for b in range(nb):
            if V[f, b] == 0:
                continue
            h = ((h ^ b) * P) & 0xFFFFFFFF
            for w in W[f, b].tolist():
                h = ((h ^ w) * P) & 0xFFFFFFFF
        if (f + 1) % every == 0 or f + 1 == nf:
            chain.append(h)
    return chain


def motion_hash(items, frames):
    """Rolling FNV over dt, camDist2, the placement and each item's bones of every frame."""
    h = 0x811C9DC5
    P = 16777619

    def mix(xs):
        nonlocal h
        arr = np.array(xs, dtype=np.float64) + 0.0
        for w in np.frombuffer(arr.tobytes(), np.uint32).tolist():
            h = ((h ^ w) * P) & 0xFFFFFFFF
    for dt, cam, Pl, bones in frames:
        mix([dt, cam] + list(Pl))
        if bones is not None:
            for b in bones:
                mix(b)
    return h


def pivot_table(models_piv):
    """Per recorded body: its pivot (its bone's, or the origin), as Output's M x pivot reads it."""
    out = []
    for r, piv in models_piv:
        for b in r["bodies"]:
            out.append(piv[b["bone"]] if b["bone"] < len(piv) else (0.0, 0.0, 0.0))
    return np.array(out, dtype=np.float64)


def errors(A, B, piv):
    """Per frame: worst body's pivot distance (m), rotation angle (rad), and the oracle's
    two measures (max |pos component|, max |matrix element|)."""
    both = (A[:, :, 0] != 0) & (B[:, :, 0] != 0)
    Ma = A[:, :, 1:].reshape(A.shape[0], A.shape[1], 3, 4)
    Mb = B[:, :, 1:].reshape(B.shape[0], B.shape[1], 3, 4)
    pa = (Ma[:, :, :, :3] * piv[None, :, None, :]).sum(3) + Ma[:, :, :, 3]
    pb = (Mb[:, :, :, :3] * piv[None, :, None, :]).sum(3) + Mb[:, :, :, 3]
    d = pa - pb
    pos = np.sqrt((d * d).sum(2))
    dpos = np.abs(d).max(2)
    Ra, Rb = Ma[:, :, :, :3], Mb[:, :, :, :3]
    drot = np.abs(Ra - Rb).max((2, 3))
    # angle of Ra^T Rb, from its skew part (well conditioned for small angles)
    Rr = np.einsum("fbji,fbjk->fbik", Ra, Rb)
    sx = Rr[:, :, 2, 1] - Rr[:, :, 1, 2]
    sy = Rr[:, :, 0, 2] - Rr[:, :, 2, 0]
    sz = Rr[:, :, 1, 0] - Rr[:, :, 0, 1]
    tr = Rr[:, :, 0, 0] + Rr[:, :, 1, 1] + Rr[:, :, 2, 2]
    ang = np.arctan2(0.5 * np.sqrt(sx * sx + sy * sy + sz * sz), 0.5 * (tr - 1.0))
    z = np.where(both, 1.0, 0.0)
    return (pos * z).max(1), (ang * z).max(1), (dpos * z).max(1), (drot * z).max(1)


def jumps(dpos, drot, floor=1e-5, ratio=30.0):
    """physics_world_oracle.py's rule: growth by `ratio` or more in ONE frame from a level
    that was still float noise (below `floor`)."""
    out = []
    for i in range(1, len(dpos)):
        prev = max(dpos[i - 1], drot[i - 1] * 0.1, 1e-9)
        cur = max(dpos[i], drot[i] * 0.1)
        if cur > floor and prev < floor and cur / prev >= ratio:
            out.append([i, float("%.3g" % prev), float("%.3g" % cur)])
    return out


def worst_upto(times, pos, ang, seconds=(1.0, 4.0, 16.0)):
    out = {}
    for s in seconds:
        mask = times <= s
        out[str(int(s))] = [float("%.3g" % pos[mask].max()), float("%.3g" % ang[mask].max())] if mask.any() else [0.0, 0.0]
    return out


def log_series(x):
    """log10 x 100 as ints (a floor of 1e-12): 3 significant digits in 4 characters."""
    return [int(round(100 * math.log10(max(float(v), 1e-12)))) for v in x]


def rot_to_q(R):
    """Row major 3x3 -> quaternion with w >= 0, the largest-diagonal rule (a stored golden)."""
    m = R
    t = m[0] + m[4] + m[8]
    if t > 0:
        s = math.sqrt(t + 1) * 2
        q = ((m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, 0.25 * s)
    elif m[0] > m[4] and m[0] > m[8]:
        s = math.sqrt(1 + m[0] - m[4] - m[8]) * 2
        q = (0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s)
    elif m[4] > m[8]:
        s = math.sqrt(1 + m[4] - m[0] - m[8]) * 2
        q = ((m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s, (m[2] - m[6]) / s)
    else:
        s = math.sqrt(1 + m[8] - m[0] - m[4]) * 2
        q = ((m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s, (m[3] - m[1]) / s)
    return q if q[3] >= 0 else tuple(-v for v in q)


def scenario(name, S, T, raw, exes, keep=False):
    sp = S["spec"]
    rows_f, rows_d, items_in, items_json, models_piv = [], [], [], [], []
    for k, it in enumerate(S["items"]):
        blob, piv = model_physics(raw, it["fdid"])
        rp = T.norm_path("item\\golden\\%d_%d.m2" % (k, it["fdid"]))
        enc = T.encode(rp, blob, (0.0, 0.0, 0.0), 1.0)
        r = T.row(b"PHY3" + b"\0" * 4 + enc, 8)
        # the re-encoder is the C++ double build's: pin it to Eclipse's bytes
        if encode_row(rp, r, "f") != enc:
            raise SystemExit("encode_row differs from midnight_physics_table.encode on %d" % it["fdid"])
        if it["patch"]:
            it["patch"](r)
            # a patched value is float32 like everything else in a row
            r = T.row(b"PHY3" + b"\0" * 4 + encode_row(rp, r, "f"), 8)
        rows_f.append((rp, encode_row(rp, r, "f")))
        rows_d.append((rp, encode_row(rp, r, "d")))
        items_in.append((rp, piv, it["attached"], it["join"], it["leave"]))
        models_piv.append((r, piv))
        items_json.append(dict(fdid=it["fdid"], join=it["join"], leave=it["leave"], attached=it["attached"],
                               pivots=[f32(x) for v in piv for x in v], model=model_json(r)))
    times = motion_times(sp)
    frames = []
    for dt, t in times:
        P = placement_at(sp, t)
        bones = [bones_at(sp, t, P, piv) for _r, piv in models_piv] if sp["wobble"] else None
        frames.append((dt, cam_at(sp, t), P, bones))
    os.makedirs(WORK, exist_ok=True)
    in_f = os.path.join(WORK, name + ".in-float.bin")
    in_d = os.path.join(WORK, name + ".in-double.bin")
    write_input(in_f, table_of(T, rows_f), items_in, frames)
    write_input(in_d, table_of(T, rows_d), items_in, frames)
    F = run(exes["float"], in_f, os.path.join(WORK, name + ".float.bin"))
    D = run(exes["double"], in_d, os.path.join(WORK, name + ".double.bin"))
    every = 32
    out = dict(name=name, spec=dict(seed=sp["seed"], scale=sp["scale"], wobble=sp["wobble"], seconds=sp["seconds"],
                                    dts=sp["dts"], cull=sp["cull"], rescale=sp["rescale"], spin=sp["spin"],
                                    mirror=sp["mirror"]),
               items=items_json, frames=len(frames), motionHash=motion_hash(items_in, frames),
               hash=dict(every=every, chain=hash_chain(D, every)))
    tarr = np.array([t for _dt, t in times])
    piv_t = pivot_table(models_piv)
    bodies = [[i, b] for i, (r, _p) in enumerate(models_piv) for b in range(len(r["bodies"]))]
    live = [k for k in range(D.shape[1]) if D[:, k, 0].any()]
    out["bodies"] = [bodies[k] for k in live]
    pos_ts, ang_ts, dp_ts, dr_ts = errors(F, D, piv_t)
    summary = dict(name=name, bodies=len(live), frames=len(frames), ts=worst_upto(tarr, pos_ts, ang_ts),
                   tsJumps=jumps(dp_ts, dr_ts))
    if not S.get("hash_only"):
        N = run(exes["float"], in_f, os.path.join(WORK, name + ".nudged.bin"), NUDGE_FRAME)
        pos_y, ang_y, dp_y, dr_y = errors(F, N, piv_t)
        out["nudgeFrame"] = NUDGE_FRAME
        out["table"] = dict(ts=summary["ts"], yard=worst_upto(tarr, pos_y, ang_y))
        out["jumps"] = dict(ts=summary["tsJumps"], yard=jumps(dp_y, dr_y))
        out["series"] = dict(pos=log_series(dp_ts), rot=log_series(dr_ts))
        summary["yard"] = out["table"]["yard"]
        summary["yardJumps"] = out["jumps"]["yard"]
        # the float reference, sampled: M x pivot and the rotation
        stride = 10
        sampled, P = [], []
        M = F[:, :, 1:]
        for f in range(stride - 1, len(frames), stride):
            sampled.append(f)
            fr = []
            for k in live:
                if F[f, k, 0] == 0:
                    fr.append(None)
                    continue
                m = M[f, k]
                R = (m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10])
                pv = piv_t[k]
                px = m[0] * pv[0] + m[1] * pv[1] + m[2] * pv[2] + m[3]
                py = m[4] * pv[0] + m[5] * pv[1] + m[6] * pv[2] + m[7]
                pz = m[8] * pv[0] + m[9] * pv[1] + m[10] * pv[2] + m[11]
                q = rot_to_q(R)
                fr.append([round(float(px), 6), round(float(py), 6), round(float(pz), 6),
                           round(float(q[0]), 6), round(float(q[1]), 6), round(float(q[2]), 6)])
            P.append(fr)
        out["golden"] = dict(frames=sampled, samples=P)
    path = os.path.join(FIXTURES, "physics-golden-%s.json" % name)
    with open(path, "w", newline="\n") as fh:
        json.dump(out, fh, separators=(",", ":"))
    if not keep:
        del F
        for p in (in_f, in_d, os.path.join(WORK, name + ".float.bin"), os.path.join(WORK, name + ".nudged.bin")):
            if os.path.isfile(p):
                os.remove(p)
    return summary, os.path.getsize(path)


def fuzz(T, raw, exes, seed=12345, cases=6000, ops=20000):
    """The double build's function-level fuzz (harness.cpp): every hull of the real files."""
    hulls = []
    for fdid in (4497847, 5425295, 1251460, 6032612):
        blob, _piv = model_physics(raw, fdid)
        rp = T.norm_path("item\\golden\\fuzz_%d.m2" % fdid)
        hulls += model_json(T.row(b"PHY3" + b"\0" * 4 + T.encode(rp, blob, (0.0, 0.0, 0.0), 1.0), 8))["hulls"]
    os.makedirs(WORK, exist_ok=True)
    inp, outp = os.path.join(WORK, "fuzz.in.bin"), os.path.join(WORK, "fuzz.out.bin")
    with open(inp, "wb") as fh:
        fh.write(struct.pack("<I", len(hulls)))
        for h in hulls:
            nv, nf, ne = len(h["v"]), len(h["n"]), len(h["edge"]) // 4
            fh.write(struct.pack("<III", nv, nf, ne))
            fh.write(struct.pack("<5d", *[float(np.float32(x)) for x in h["centroid"]],
                                 float(np.float32(h["volume"])), float(np.float32(h["area"]))))
            # floats through f32: the JSON's shortest decimals read back exact
            for v in h["v"]:
                fh.write(struct.pack("<3d", *[float(np.float32(x)) for x in v]))
            for v in h["n"]:
                fh.write(struct.pack("<3d", *[float(np.float32(x)) for x in v]))
            for d in h["d"]:
                fh.write(struct.pack("<d", float(np.float32(d))))
            fh.write(bytes(h["face"]) + bytes(h["edge"]))
    r = subprocess.run([exes["double"], "--fuzz", inp, outp, str(seed), str(cases), str(ops)], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("fuzz exit %d: %s" % (r.returncode, r.stderr[-500:]))
    with open(outp, "rb") as fh:
        raw_out = fh.read()
    chain = list(struct.unpack("<%dI" % (len(raw_out) // 4), raw_out))
    path = os.path.join(FIXTURES, "physics-fuzz.json")
    with open(path, "w", newline="\n") as fh:
        json.dump(dict(seed=seed, cases=cases, ops=ops, hulls=hulls, chain=chain), fh, separators=(",", ":"))
    print("fuzz: %d cases, %d tree ops, %d checkpoints, %.1f KB" % (cases, ops, len(chain), os.path.getsize(path) / 1024))


def fmt(t):
    return " ".join("%ss %.2g/%.2g" % (k, v[0], v[1]) for k, v in t.items())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eclipse", default=os.environ.get("ECLIPSE_REPO"))
    ap.add_argument("--raw", default=os.environ.get("PHYS_RAW_DIR", os.path.join(REPO, "work", "raw", BUILD)))
    ap.add_argument("--only", help="comma separated scenario names (fuzz for the function-level fuzz)")
    ap.add_argument("--keep", action="store_true", help="keep the inputs and the float dumps")
    a = ap.parse_args()
    if not a.eclipse:
        raise SystemExit("--eclipse <Eclipse repo> or env ECLIPSE_REPO")
    sys.path[:0] = [os.path.join(a.eclipse, "tools", "midnight"), os.path.join(a.eclipse, "tools", "lib")]
    import midnight_physics_table as T
    import msvc
    os.makedirs(FIXTURES, exist_ok=True)
    exes = build_exes(a.eclipse, msvc)
    raw = Raw(a.raw, a.eclipse)
    names = a.only.split(",") if a.only else list(SCENARIOS)
    total = 0
    if not a.only or "fuzz" in names:
        fuzz(T, raw, exes)
    names = [n for n in names if n != "fuzz"]
    for name in names:
        s, size = scenario(name, SCENARIOS[name], T, raw, exes, a.keep)
        total += size
        line = "%-16s %4d frames %2d bodies %6.1f KB  float vs double %s" % (name, s["frames"], s["bodies"], size / 1024, fmt(s["ts"]))
        if "yard" in s:
            line += "  | yard %s" % fmt(s["yard"])
        if s["tsJumps"]:
            line += "  JUMPS ts %s" % s["tsJumps"][:3]
        if s.get("yardJumps"):
            line += "  JUMPS yard %s" % s["yardJumps"][:3]
        print(line)
    print("fixtures: %.1f KB" % (total / 1024))


if __name__ == "__main__":
    main()
