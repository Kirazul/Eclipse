// harness.cpp - runs Eclipse's src/eclipse/races/Physics.cpp, UNCHANGED, on a scenario
// and dumps every dynamic body's output matrix every frame. gen.py builds it twice:
//
//   float  (the reference):   cl /O2 /EHsc /std:c++20 /fp:precise harness.cpp Physics.cpp
//     Eclipse's own build: float arithmetic, the hardware's rsqrtss / rcpss.
//   double (the logic oracle): cl ... /DPHYS_GOLD_DOUBLE /I<races> harness.cpp
//     The same source with `float` spelled double and exact estimates, which is what the
//     TypeScript port computes - so the two must agree BIT FOR BIT on every frame. Any
//     difference there is a logic difference, however small; numeric noise cannot hide
//     one and cannot cause one.
//
//   harness <in.bin> <out.bin> [nudge frame]
//   harness --fuzz <hulls.bin> <out.bin> <seed> <cases> <tree ops>     (double build only)
//
// in  (little endian): u32 table size, table (PHY3, as midnight_physics_table writes it;
//     the double build's row floats are f64), u32 items, per item {u16 path length, path,
//     u32 bones, bones x 3 f32 pivots, u8 attached, i32 join frame, i32 leave frame (-1
//     never)}, u32 frames, per frame {f64 dt, f64 camDist2, 16 f64 placement, u8 has
//     bones, when set per item bones x 16 f64 bone world}; without, every bone = placement
// out: u32 total bodies, u32 frames, then per frame per item per body 13 f64: valid
//     (1 / 0), the matrix's 3 rows (12 values, m[r * 4 + c]).
// The nudge is the oracle's (physics_world_oracle.cpp): frame N's placement moves one
// float ULP in x (of 1 m at the least), the yardstick of how far two correct runs drift.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>
#include <xmmintrin.h>

typedef float f32;  // the file's real floats, whatever `float` is below

#ifdef PHYS_GOLD_DOUBLE
// Physics.cpp mixes float literals with its now-double variables in std::min / max; these
// keep the standard's own semantics, min(a, b) = b < a ? b : a, max(a, b) = a < b ? b : a.
namespace std {
inline double min(double a, f32 b) { return double(b) < a ? double(b) : a; }
inline double min(f32 a, double b) { return b < double(a) ? b : double(a); }
inline double max(double a, f32 b) { return a < double(b) ? double(b) : a; }
inline double max(f32 a, double b) { return double(a) < b ? b : double(a); }
}  // namespace std
#define PHYS_EXACT_ESTIMATES
#define float double
#include "Physics_double.cpp"  // gen.py's copy: a `return 0.0f;` respelled, same values
#undef float
#else
#include "Physics.h"
#endif

using namespace wow::ec::physics;

struct Item {
    std::string path;
    std::vector<V3> pivots;
    uint32_t bones = 0;
    bool attached = true;
    int join = 0, leave = -1;
    Model model;
    std::unique_ptr<Instance> inst;
    std::vector<double> boneWorld;
};

#ifdef PHYS_GOLD_DOUBLE
// --- the function-level fuzz: only this build's translation unit can see Physics.cpp's
// internals. Random near-touching hull, capsule and tree cases, every result hashed; the
// TS test draws the same cases from the same generator and must hash the same bits. Rare
// branches of the narrowphase get a real answer here, not just the paths a scenario takes.
static uint32_t g_rs = 1;
static double Rnd() {
    g_rs = g_rs * 1664525u + 1013904223u;
    return double(g_rs >> 8) / 16777216.0;
}
static double Rnd2() { return Rnd() * 2.0 - 1.0; }

struct Hasher {
    uint32_t h = 0x811C9DC5u;
    void I(uint32_t x) { h = (h ^ x) * 16777619u; }
    void D(double x) {
        x = x + 0.0;
        uint64_t b;
        memcpy(&b, &x, 8);
        I(uint32_t(b));
        I(uint32_t(b >> 32));
    }
};
static void HashM(Hasher& H, const Manifold& m, const Contact::Cache& c) {
    H.I(uint32_t(m.n));
    if (m.n > 0) {
        H.D(m.normal.x);
        H.D(m.normal.y);
        H.D(m.normal.z);
        for (int i = 0; i < m.n; ++i) {
            H.D(m.pt[i].p.x);
            H.D(m.pt[i].p.y);
            H.D(m.pt[i].p.z);
            H.D(m.pt[i].sep);
            H.I(uint32_t(m.pt[i].key));
        }
    }
    H.D(c.metric);
    for (int i = 0; i < 4; ++i) {
        H.I(c.a[i]);
        H.I(c.b[i]);
    }
    H.D(c.satSep);
    H.I(c.satA);
    H.I(c.satB);
    H.I(c.satType);
}
static void NormQ(Q& q) {
    const double k = 1.0 / std::sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
    q.x *= k;
    q.y *= k;
    q.z *= k;
    q.w *= k;
}
static void NormV(V3& v) {
    const double k = 1.0 / std::sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    v.x *= k;
    v.y *= k;
    v.z *= k;
}

static int Fuzz(int argc, char** argv) {
    if (argc < 6) return 2;
    FILE* f = fopen(argv[2], "rb");
    if (!f) return 3;
    std::vector<uint8_t> data;
    {
        uint8_t buf[65536];
        size_t k;
        while ((k = fread(buf, 1, sizeof buf, f)) > 0) data.insert(data.end(), buf, buf + k);
    }
    fclose(f);
    size_t at = 0;
    auto get = [&](void* dst, size_t n) {
        memcpy(dst, data.data() + at, n);
        at += n;
    };
    uint32_t nh = 0;
    get(&nh, 4);
    std::vector<Hull> hulls(nh);
    std::vector<double> rad(nh);
    for (uint32_t i = 0; i < nh; ++i) {
        Hull& H = hulls[i];
        uint32_t nv, nf, ne;
        get(&nv, 4);
        get(&nf, 4);
        get(&ne, 4);
        get(&H.centroid, 24);
        get(&H.volume, 8);
        get(&H.area, 8);
        H.v.resize(nv);
        get(H.v.data(), size_t(nv) * 24);
        H.n.resize(nf);
        get(H.n.data(), size_t(nf) * 24);
        H.d.resize(nf);
        get(H.d.data(), size_t(nf) * 8);
        H.face.resize(nf);
        get(H.face.data(), nf);
        H.edge.resize(size_t(ne) * 4);
        get(H.edge.data(), size_t(ne) * 4);
        double r2 = 0;
        for (const V3& p : H.v) {
            const double x = p.x - H.centroid.x, y = p.y - H.centroid.y, z = p.z - H.centroid.z;
            const double d2 = x * x + y * y + z * z;
            if (d2 > r2) r2 = d2;
        }
        rad[i] = std::sqrt(r2);
    }
    g_rs = uint32_t(atol(argv[4]));
    const int cases = atoi(argv[5]);
    const int ops = argc > 6 ? atoi(argv[6]) : 0;
    Hasher H;
    std::vector<uint32_t> chain;
    for (int c = 0; c < cases; ++c) {
        const int ia = int(Rnd() * nh), ib = int(Rnd() * nh);
        const Hull& A = hulls[size_t(ia)];
        const Hull& B = hulls[size_t(ib)];
        const double Ra = rad[size_t(ia)], Rb = rad[size_t(ib)];
        {   // hull against hull: a pose, then the same pair drifting, its cache kept
            Q q{Rnd2(), Rnd2(), Rnd2(), Rnd2()};
            NormQ(q);
            V3 d{Rnd2(), Rnd2(), Rnd2()};
            NormV(d);
            const double dist = (Ra + Rb) * (0.2 + 0.9 * Rnd());
            const V3 rb = Rot(q, B.centroid);
            V3 p{A.centroid.x + d.x * dist - rb.x, A.centroid.y + d.y * dist - rb.y, A.centroid.z + d.z * dist - rb.z};
            Contact::Cache cache;
            Manifold m;
            for (int it = 0; it < 4; ++it) {
                HullHull(A, B, q, p, m, cache);
                HashM(H, m, cache);
                const double e = it == 0 ? 0.0005 : it == 1 ? 0.003 : 0.02;
                const double ex = e * Rnd2(), ey = e * Rnd2(), ez = e * Rnd2(), ew = e * Rnd2();
                q.x += ex;
                q.y += ey;
                q.z += ez;
                q.w += ew;
                NormQ(q);
                p.x += e * Rnd2();
                p.y += e * Rnd2();
                p.z += e * Rnd2();
            }
        }
        {   // hull against capsule
            V3 dir{Rnd2(), Rnd2(), Rnd2()};
            NormV(dir);
            const double s = Ra * (0.1 + 1.2 * Rnd());
            const double r = 0.01 + 0.08 * Rnd();
            V3 c1{A.centroid.x + dir.x * s, A.centroid.y + dir.y * s, A.centroid.z + dir.z * s};
            V3 ax{Rnd2(), Rnd2(), Rnd2()};
            NormV(ax);
            const double len = Ra * 2.0 * Rnd();
            V3 c2{c1.x + ax.x * len, c1.y + ax.y * len, c1.z + ax.z * len};
            Contact::Cache cache;
            Manifold m;
            for (int it = 0; it < 4; ++it) {
                HullCapsule(A, c1, c2, r, m, cache);
                HashM(H, m, cache);
                const double e = it == 0 ? 0.0005 : it == 1 ? 0.003 : 0.02;
                c1.x += e * Rnd2();
                c1.y += e * Rnd2();
                c1.z += e * Rnd2();
                c2.x += e * Rnd2();
                c2.y += e * Rnd2();
                c2.z += e * Rnd2();
            }
        }
        {   // capsule against capsule: skew, near-parallel, end to end, degenerate
            V3 a1{Rnd2() * 0.3, Rnd2() * 0.3, Rnd2() * 0.3};
            V3 a2{a1.x + Rnd2() * 0.3, a1.y + Rnd2() * 0.3, a1.z + Rnd2() * 0.3};
            V3 b1{Rnd2() * 0.3, Rnd2() * 0.3, Rnd2() * 0.3};
            V3 b2{b1.x + Rnd2() * 0.3, b1.y + Rnd2() * 0.3, b1.z + Rnd2() * 0.3};
            const int kind = int(Rnd() * 5.0);
            const double kk = 0.5 + Rnd();
            const double ox = Rnd2() * 0.05, oy = Rnd2() * 0.05, oz = Rnd2() * 0.05;
            const double tx = Rnd2() * 0.002, ty = Rnd2() * 0.002, tz = Rnd2() * 0.002;
            if (kind == 1) {
                b1 = V3{a1.x + ox, a1.y + oy, a1.z + oz};
                b2 = V3{b1.x + (a2.x - a1.x) * kk + tx, b1.y + (a2.y - a1.y) * kk + ty, b1.z + (a2.z - a1.z) * kk + tz};
            } else if (kind == 2) {
                b1 = a2;
            } else if (kind == 3) {
                a2 = a1;
            } else if (kind == 4) {
                b2 = b1;
            }
            const double ra = 0.01 + 0.2 * Rnd(), rb = 0.01 + 0.2 * Rnd();
            Manifold m;
            Contact::Cache none;
            CapsuleCapsule(a1, a2, ra, b1, b2, rb, m);
            HashM(H, m, none);
        }
        if ((c + 1) % 512 == 0 || c + 1 == cases) chain.push_back(H.h);
    }
    // the broadphase tree: creates, destroys, moves and optimise passes at random
    {
        Tree t;
        std::vector<int> live;
        double lo[3], hi[3];
        auto box = [&](double cx, double cy, double cz, double w) {
            lo[0] = cx - w;
            lo[1] = cy - w;
            lo[2] = cz - w;
            hi[0] = cx + w;
            hi[1] = cy + w;
            hi[2] = cz + w;
        };
        for (int op = 0; op < ops; ++op) {
            const double k = Rnd();
            if (k < 0.3 || live.empty()) {
                const double cx = Rnd2(), cy = Rnd2(), cz = Rnd2(), w = 0.01 + 0.2 * Rnd();
                box(cx, cy, cz, w);
                const int id = t.Create(lo, hi, kProxyMargin);
                H.I(uint32_t(id));
                live.push_back(id);
            } else if (k < 0.42) {
                const size_t i = size_t(Rnd() * double(live.size()));
                t.Destroy(live[i]);
                live[i] = live.back();
                live.pop_back();
            } else if (k < 0.85) {
                const size_t i = size_t(Rnd() * double(live.size()));
                const TreeNode& n = t.n[size_t(live[i])];
                const double far = Rnd() < 0.3 ? 1.0 : 0.05;
                const double cx = (n.lo[0] + n.hi[0]) * 0.5 + Rnd2() * far;
                const double cy = (n.lo[1] + n.hi[1]) * 0.5 + Rnd2() * far;
                const double cz = (n.lo[2] + n.hi[2]) * 0.5 + Rnd2() * far;
                const double w = 0.01 + 0.3 * Rnd();
                box(cx, cy, cz, w);
                H.I(t.Move(live[i], lo, hi, kProxyMargin) ? 1u : 0u);
            } else {
                t.Optimize(1 + int(Rnd() * 10.0));
            }
            H.I(uint32_t(t.root));
            H.I(uint32_t(t.count));
            H.I(uint32_t(t.freeHead));
            H.I(uint32_t(t.proxies));
            H.I(uint32_t(t.cursor));
            if (op % 16 == 0) {
                for (int i = 0; i < t.cap; ++i) {
                    const TreeNode& n = t.n[size_t(i)];
                    for (int a = 0; a < 3; ++a) {
                        H.D(n.lo[a]);
                        H.D(n.hi[a]);
                    }
                    H.I(uint32_t(n.parent));
                    H.I(uint32_t(n.c1));
                    H.I(uint32_t(n.c2));
                    H.I(uint32_t(n.height));
                }
            }
            if ((op + 1) % 2048 == 0 || op + 1 == ops) chain.push_back(H.h);
        }
    }
    FILE* out = fopen(argv[3], "wb");
    if (!out) return 4;
    fwrite(chain.data(), 4, chain.size(), out);
    fclose(out);
    return 0;
}
#endif

int main(int argc, char** argv) {
    if (argc < 3) return 2;
#ifdef PHYS_GOLD_DOUBLE
    if (strcmp(argv[1], "--fuzz") == 0) return Fuzz(argc, argv);
#endif
    FILE* f = fopen(argv[1], "rb");
    if (!f) return 3;
    std::vector<uint8_t> data;
    {
        uint8_t buf[65536];
        size_t k;
        while ((k = fread(buf, 1, sizeof buf, f)) > 0) data.insert(data.end(), buf, buf + k);
    }
    fclose(f);
    const long nudge = argc > 3 ? atol(argv[3]) : -1;
    size_t at = 0;
    auto get = [&](void* dst, size_t n) {
        if (at + n > data.size()) {
            fprintf(stderr, "input truncated\n");
            exit(5);
        }
        memcpy(dst, data.data() + at, n);
        at += n;
    };
    uint32_t tn = 0, ni = 0, nf = 0;
    get(&tn, 4);
    const uint8_t* table = data.data() + at;
    at += tn;
    get(&ni, 4);
    std::vector<Item> items(ni);
    uint32_t total = 0;
    for (Item& it : items) {
        uint16_t pl = 0;
        get(&pl, 2);
        it.path.assign(reinterpret_cast<const char*>(data.data() + at), pl);
        at += pl;
        get(&it.bones, 4);
        it.pivots.resize(it.bones);
        for (uint32_t b = 0; b < it.bones; ++b) {
            f32 p[3];
            get(p, 12);
            it.pivots[b].x = p[0];
            it.pivots[b].y = p[1];
            it.pivots[b].z = p[2];
        }
        uint8_t att = 0;
        get(&att, 1);
        it.attached = att != 0;
        get(&it.join, 4);
        get(&it.leave, 4);
        char key[400];
        if (!NormPath(it.path.c_str(), key, sizeof key) || !Find(table, tn, key, it.model)) {
            fprintf(stderr, "no row for %s\n", it.path.c_str());
            return 7;
        }
        total += uint32_t(it.model.bodies.size());
        it.boneWorld.resize(size_t(it.bones) * 16);
    }
    get(&nf, 4);
    FILE* out = fopen(argv[2], "wb");
    if (!out) return 4;
    fwrite(&total, 4, 1, out);
    fwrite(&nf, 4, 1, out);
    Scene scene;
    std::vector<double> row(size_t(total) * 13);
    double stepNs = 0, worstNs = 0;
    for (uint32_t fr = 0; fr < nf; ++fr) {
        double dt = 0, cam = 0, P[16];
        uint8_t hasBones = 0;
        get(&dt, 8);
        get(&cam, 8);
        get(P, 128);
        get(&hasBones, 1);
        const double nudged = long(fr) == nudge ? std::max(std::fabs(P[3]), 1.0) * 1.1920928955078125e-7 : 0.0;
        P[3] += nudged;
        for (Item& it : items) {
            if (hasBones) {
                get(it.boneWorld.data(), size_t(it.bones) * 128);
                for (uint32_t b = 0; b < it.bones; ++b) it.boneWorld[size_t(b) * 16 + 3] += nudged;
            } else {
                for (uint32_t b = 0; b < it.bones; ++b) memcpy(&it.boneWorld[size_t(b) * 16], P, 128);
            }
        }
        // items leave, then join, then every live item is driven in item order; the scene
        // steps once after all of them, as the client's frame does
        for (Item& it : items)
            if (int(fr) == it.leave) it.inst.reset();
        for (Item& it : items)
            if (int(fr) == it.join) it.inst = std::make_unique<Instance>(&it.model, &scene, it.attached);
        const auto t0 = std::chrono::steady_clock::now();
        Frame fm;
        memcpy(fm.placement, P, 128);
        fm.dt = decltype(fm.dt)(dt);
        fm.camDist2 = decltype(fm.camDist2)(cam);
        for (Item& it : items) {
            if (!it.inst) continue;
            fm.boneWorld = reinterpret_cast<const double(*)[16]>(it.boneWorld.data());
            fm.pivots = it.pivots.data();
            fm.boneCount = it.bones;
            it.inst->Step(fm);
        }
        scene.Step(fm.dt);
        const double ns = double(std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - t0).count());
        stepNs += ns;
        worstNs = std::max(worstNs, ns);
        size_t o = 0;
        for (Item& it : items) {
            for (size_t b = 0; b < it.model.bodies.size(); ++b, o += 13) {
                double M[16];
                const bool ok = it.inst && it.inst->Output(b, M);
                row[o] = ok ? 1.0 : 0.0;
                for (int k = 0; k < 12; ++k) row[o + 1 + size_t(k)] = ok ? M[k] : 0.0;
            }
        }
        fwrite(row.data(), sizeof(double), row.size(), out);
    }
    fclose(out);
    if (getenv("PHYS_GOLD_TIME")) puts(("step: mean " + std::to_string(stepNs / nf / 1000.0) + " us, worst " + std::to_string(worstNs / 1000.0) + " us, frames " + std::to_string(nf)).c_str());
    // the items leave before the scene dies, as a client scene's teardown does
    for (Item& it : items) it.inst.reset();
    return 0;
}
