import * as THREE from "three";

import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";

import { RenderPass } from "three/addons/postprocessing/RenderPass.js";

import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

import { Line2 } from "three/addons/lines/Line2.js";

import { LineMaterial } from "three/addons/lines/LineMaterial.js";

import { LineGeometry } from "three/addons/lines/LineGeometry.js";

import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { Rider, BikeSpin, bikeLandmarks } from "./rider.js";

import { Registry, EgoSet } from "./assets.js";

const BASE = "media/p2p/", T_END = 16, FPS_DATA = 10;

const DETS = {
    spn: "StreamPETR",
    s4d: "Sparse4D",
    t4: "Vehicle-stack StreamPETR"
};

const C = {
    dt: 16281969,
    r2r: 3003583,
    gt: 14870768,
    human: 9741240,
    hit: 16726843
};

const CSS = {
    dt: "#f87171",
    r2r: "#2dd4bf",
    gt: "#e2e8f0",
    human: "#94a3b8"
};

const HGT = [ 1.55, 3, 3.2, 1.75, 1.6 ];

const $ = id => document.getElementById(id);

const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), sstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};

const lerpA = (a, b, f) => {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * f;
};

const app = $("p2p-app");

if (!app) throw new Error("no #p2p-app");

const canvas = $("p2p-canvas"), stage = app.querySelector(".p2p-stage"), labels = $("p2p-labels");

const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    powerPreference: "high-performance"
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

renderer.setClearColor(329482, 1);

const scene = new THREE.Scene;

scene.fog = new THREE.Fog(329482, 70, 190);

const camera = new THREE.PerspectiveCamera(40, 16 / 9, .3, 900);

camera.up.set(0, 0, 1);

const controls = new OrbitControls(camera, canvas);

controls.enabled = false;

controls.enableDamping = true;

controls.maxPolarAngle = Math.PI * .47;

scene.add(new THREE.HemisphereLight(12571903, 658448, .9));

const sun = new THREE.DirectionalLight(16777215, 1.4);

sun.position.set(-30, 40, 80);

scene.add(sun);

scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment, .04).texture;

const TH = {
    bg: 329482,
    clay: 9213345,
    ped: 12831185,
    glass: 1448480,
    tyre: 1118740,
    wheel: 8422796,
    trim: 3488322,
    headLens: 10528429,
    tailLens: 5903894,
    highlight: 16726843,
    clayEnv: .45
};

const REG = new Registry;

let REG_P = null;

const regReady = () => REG_P ||= REG.load("media/p2p/models/", null).then((r => {
    for (const L of Object.values(r.models)) for (const M of L) M.root.traverse((o => {
        if (o.geometry) o.geometry.userData.shared = true;
    }));
    return r;
})).catch((e => {
    console.warn("models", e);
    return null;
}));

const hashId = s => {
    let h = 7;
    for (const c of String(s)) h = h * 31 + c.charCodeAt(0) >>> 0;
    return h;
};

const composer = new EffectComposer(renderer);

composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .5, .5, .82);

composer.addPass(bloom);

composer.addPass(new OutputPass);

const lineMats = [];

let INDEX = [], S = null, world = null, det = "spn", view = "follow", t = 0, playing = true, speed = 1, visible = false, dirty = true, lastNow = 0, holdUntil = 0;

const cache = {};

function fatLine(pts, color, width, opacity = 1, dashed = false) {
    const g = new LineGeometry;
    g.setPositions(pts.flat());
    const m = new LineMaterial({
        color: color,
        linewidth: width,
        transparent: opacity < 1,
        opacity: opacity,
        dashed: dashed,
        dashSize: 1.2,
        gapSize: 1,
        depthWrite: opacity >= 1
    });
    m.resolution.set(stage.clientWidth, stage.clientHeight);
    lineMats.push(m);
    const l = new Line2(g, m);
    if (dashed) l.computeLineDistances();
    return l;
}

function segLines(polys, color, opacity, z) {
    const P = [];
    for (const p of polys) for (let i = 0; i + 1 < p.length; i++) P.push(p[i][0], p[i][1], z, p[i + 1][0], p[i + 1][1], z);
    const g = new THREE.BufferGeometry;
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        depthWrite: false
    }));
}

const UNIT_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

function glowTex() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    r.addColorStop(0, "rgba(255,255,255,.9)");
    r.addColorStop(.4, "rgba(255,255,255,.28)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    return t;
}

const GLOW = glowTex();

function egoCar(color, kind) {
    const grp = new THREE.Group;
    const [F, R, HW] = S.ego;
    const L = F + R, cx = (F - R) / 2;
    const inst = kind === "solid" && REG.models.suv ? (() => {
        const es = new EgoSet;
        es.paint(color, true);
        es.m.body.emissive = new THREE.Color(color);
        es.m.body.emissiveIntensity = .06;
        es.env(.9);
        es.m.glass.envMapIntensity = .45;
        es.m.body.clearcoatRoughness = .08;
        es.setLights(false, 0);
        const m = REG.ego("suv", es, "ego_nx_proxy_vw_tiguan");
        if (m) m.es = es;
        return m;
    })() : null;
    if (inst) {
        const wrap = new THREE.Group;
        wrap.rotation.x = Math.PI / 2;
        wrap.position.set(cx, 0, 0);
        const sc = L / inst.dims.x;
        inst.obj.scale.setScalar(sc);
        wrap.add(inst.obj);
        grp.add(wrap);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.9, HW * 4.4), new THREE.MeshBasicMaterial({
            map: GLOW,
            color: color,
            transparent: true,
            opacity: .6,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        const mats = new Set;
        inst.obj.traverse((o => {
            if (o.isMesh) (Array.isArray(o.material) ? o.material : [ o.material ]).forEach((m => mats.add(m)));
        }));
        grp.userData.mats = [ ...mats ];
        grp.userData.op = 1;
        glow.position.set(cx, 0, .03);
        grp.add(glow);
        grp.userData.mat = inst.es.m.body;
        grp.userData.es = inst.es;
        grp.userData.glow = glow;
        grp.userData.base = .06;
    } else if (kind === "solid") {
        const mat = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: .55,
            metalness: .2,
            roughness: .45
        });
        const body = new THREE.Mesh(UNIT_BOX, mat);
        body.scale.set(L, 2 * HW, .78);
        body.position.set(cx, 0, .32 + .39);
        grp.add(body);
        const cab = new THREE.Mesh(UNIT_BOX, new THREE.MeshStandardMaterial({
            color: 725272,
            emissive: color,
            emissiveIntensity: .12,
            metalness: .6,
            roughness: .2
        }));
        cab.scale.set(L * .5, 2 * HW * .84, .5);
        cab.position.set(cx - .25, 0, 1.1 + .25);
        grp.add(cab);
        const e = new THREE.LineSegments(UNIT_EDGES, new THREE.LineBasicMaterial({
            color: 16777215,
            transparent: true,
            opacity: .65
        }));
        e.scale.copy(body.scale);
        e.position.copy(body.position);
        grp.add(e);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(L * 2.1, HW * 5.2), new THREE.MeshBasicMaterial({
            map: GLOW,
            color: color,
            transparent: true,
            opacity: .55,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        glow.position.set(cx, 0, .04);
        grp.add(glow);
        grp.userData.mat = mat;
        grp.userData.glow = glow;
        grp.userData.base = .55;
    } else {
        const e = new THREE.LineSegments(UNIT_EDGES, new THREE.LineDashedMaterial({
            color: color,
            transparent: true,
            opacity: kind === "dash" ? .75 : .5,
            dashSize: .35,
            gapSize: kind === "dash" ? .25 : .001
        }));
        e.scale.set(L, 2 * HW, 1.5);
        e.position.set(cx, 0, .75);
        e.computeLineDistances();
        grp.add(e);
    }
    return grp;
}

function disposeWorld() {
    if (!world) return;
    scene.remove(world.root);
    world.root.traverse((o => {
        if (o.geometry && o.geometry !== UNIT_BOX && o.geometry !== UNIT_EDGES && !o.geometry.userData.shared) o.geometry.dispose();
        if (o.material) o.material.dispose?.();
    }));
    lineMats.length = 0;
    labels.innerHTML = "";
    world = null;
}

function prep(S) {
    S.byId = S.frames.map((f => {
        const m = new Map;
        for (const g of f.gt) m.set(g[0], g);
        return m;
    }));
    for (const r of Object.values(S.runs)) {
        let prev = r.p[0][2];
        for (const q of r.p) {
            while (q[2] - prev > Math.PI) q[2] -= 2 * Math.PI;
            while (q[2] - prev < -Math.PI) q[2] += 2 * Math.PI;
            prev = q[2];
        }
    }
    let prev = S.frames[0].h[2];
    for (const f of S.frames) {
        while (f.h[2] - prev > Math.PI) f.h[2] -= 2 * Math.PI;
        while (f.h[2] - prev < -Math.PI) f.h[2] += 2 * Math.PI;
        prev = f.h[2];
    }
}

function build() {
    disposeWorld();
    const root = new THREE.Group;
    scene.add(root);
    world = {
        root: root,
        gt: new Map,
        dets: {},
        egos: {},
        trails: {},
        labels: {}
    };
    const M = S.map;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2e3, 2e3), new THREE.MeshBasicMaterial({
        color: 461069
    }));
    ground.position.z = -.03;
    root.add(ground);
    const shapes = M.drivable.map((d => {
        const s = new THREE.Shape(d.shell.map((p => new THREE.Vector2(p[0], p[1]))));
        for (const h of d.holes) s.holes.push(new THREE.Path(h.map((p => new THREE.Vector2(p[0], p[1])))));
        return s;
    }));
    const roadMat = new THREE.ShaderMaterial({
        uniforms: {
            uFogC: {
                value: new THREE.Color(329482)
            }
        },
        transparent: false,
        vertexShader: "varying vec3 vW; varying float vD; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW=w.xyz; vec4 mv=viewMatrix*w; vD=-mv.z; gl_Position=projectionMatrix*mv; }",
        fragmentShader: `varying vec3 vW; varying float vD; uniform vec3 uFogC;\n      void main(){ vec2 g = abs(fract(vW.xy/5.0 - 0.5) - 0.5)/fwidth(vW.xy/5.0); float l = 1.0 - min(min(g.x,g.y),1.0);\n        vec3 c = vec3(0.0062,0.0080,0.0110) + vec3(0.010,0.016,0.020)*l; float f = smoothstep(70.0,190.0,vD); gl_FragColor = vec4(mix(c,uFogC,f),1.0); }`,
        extensions: {
            derivatives: true
        }
    });
    for (const s of shapes) {
        const m = new THREE.Mesh(new THREE.ShapeGeometry(s), roadMat);
        m.position.z = -.01;
        root.add(m);
    }
    const halves = [];
    for (const p of M.lanes) {
        const n = p.length;
        if (n % 2 === 0 && n >= 4) {
            halves.push(p.slice(0, n / 2), p.slice(n / 2));
        } else halves.push([ ...p, p[0] ]);
    }
    root.add(segLines(halves, 11122892, .5, .02));
    const ch = [];
    for (const p of M.conn) {
        const n = p.length;
        if (n % 2 === 0 && n >= 4) ch.push(p.slice(0, n / 2), p.slice(n / 2));
    }
    root.add(segLines(ch, 6583435, .12, .015));
    for (const s of M.stops) root.add(segLines([ s.line ], s.released ? 13358561 : 16281969, .8, .03));
    const R = S.runs, d = det;
    world.egos.human = egoCar(C.human, "dash");
    root.add(world.egos.human);
    world.egos.gt = egoCar(C.gt, "ghost");
    root.add(world.egos.gt);
    world.egos.dt = egoCar(C.dt, "solid");
    root.add(world.egos.dt);
    world.egos.r2r = egoCar(C.r2r, "solid");
    world.egos.r2r.scale.set(.985, .96, 1.02);
    root.add(world.egos.r2r);
    const runOf = {
        dt: R[`det_${d}_dt`],
        r2r: R[`det_${d}_r2r`],
        gt: R.gt_vis
    };
    world.run = runOf;
    for (const k of [ "dt", "r2r", "gt" ]) {
        const r = runOf[k], n = r.tc != null ? Math.round(r.tc * FPS_DATA) + 1 : r.p.length, pts = r.p.slice(0, n).map((q => [ q[0], q[1], .06 + (k === "gt" ? 0 : .02) ]));
        const w = k === "gt" ? 1.6 : 3.2, full = fatLine(pts, C[k], w * .7, k === "gt" ? .12 : .16), done = fatLine(pts, C[k], w, k === "gt" ? .45 : 1);
        root.add(full);
        root.add(done);
        world.trails[k] = {
            full: full,
            done: done,
            n: n
        };
    }
    const hp = S.frames.map((f => [ f.h[0], f.h[1], .05 ]));
    world.humanLine = fatLine(hp, C.human, 1.4, .55, true);
    root.add(world.humanLine);
    for (const k of [ "dt", "r2r" ]) {
        const pool = [];
        for (let i = 0; i < 48; i++) {
            const e = new THREE.LineSegments(UNIT_EDGES, new THREE.LineBasicMaterial({
                color: C[k],
                transparent: true,
                opacity: .95
            }));
            e.visible = false;
            root.add(e);
            pool.push(e);
        }
        world.dets[k] = pool;
    }
    world.fx = {};
    for (const k of [ "dt", "r2r", "gt" ]) {
        const r = runOf[k];
        if (r.tc == null) continue;
        const ring = new THREE.Mesh(new THREE.RingGeometry(.85, 1, 64), new THREE.MeshBasicMaterial({
            color: C.hit,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        }));
        const flash = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({
            map: GLOW,
            color: C.hit,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        root.add(ring);
        root.add(flash);
        const lab = document.createElement("div");
        lab.className = "p2p-lab hit";
        lab.innerHTML = `<b>Collision</b><span>${r.tc.toFixed(1)} s</span>`;
        labels.appendChild(lab);
        world.fx[k] = {
            ring: ring,
            flash: flash,
            lab: lab,
            tc: r.tc
        };
    }
    for (const k of [ "dt", "r2r" ]) {
        const lab = document.createElement("div");
        lab.className = "p2p-lab " + k;
        labels.appendChild(lab);
        world.labels[k] = lab;
    }
    world.track = followTrack();
    resize();
}

function poseAt(r, t) {
    const tt = r.tc != null ? Math.min(t, r.tc) : t, f = clamp(tt * FPS_DATA, 0, r.p.length - 1), i = Math.floor(f), j = Math.min(i + 1, r.p.length - 1), a = f - i;
    const p = r.p[i], q = r.p[j];
    return [ p[0] + (q[0] - p[0]) * a, p[1] + (q[1] - p[1]) * a, p[2] + (q[2] - p[2]) * a, r.v[i] + (r.v[j] - r.v[i]) * a ];
}

function humanAt(t) {
    const f = clamp(t * FPS_DATA, 0, S.frames.length - 1), i = Math.floor(f), j = Math.min(i + 1, S.frames.length - 1), a = f - i, p = S.frames[i].h, q = S.frames[j].h;
    return [ p[0] + (q[0] - p[0]) * a, p[1] + (q[1] - p[1]) * a, p[2] + (q[2] - p[2]) * a, p[3] ];
}

function followTrack() {
    const n = S.frames.length, raw = [];
    for (let j = 0; j < n; j++) {
        const a = poseAt(world.run.dt, j / FPS_DATA), b = poseAt(world.run.r2r, j / FPS_DATA), sp = Math.hypot(a[0] - b[0], a[1] - b[1]);
        raw.push([ (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.cos(b[2]), Math.sin(b[2]), sp ]);
    }
    const out = [], W = 14;
    for (let j = 0; j < n; j++) {
        let s = [ 0, 0, 0, 0, 0 ], ws = 0;
        for (let k = -W; k <= W; k++) {
            const q = raw[clamp(j + k, 0, n - 1)], w = Math.exp(-(k * k) / (2 * 7 * 7));
            for (let c = 0; c < 5; c++) s[c] += q[c] * w;
            ws += w;
        }
        out.push(s.map((v => v / ws)));
    }
    let lo = [ 1e9, 1e9 ], hi = [ -1e9, -1e9 ];
    for (const r of [ world.run.dt, world.run.r2r, world.run.gt ]) for (const q of r.p) {
        lo = [ Math.min(lo[0], q[0]), Math.min(lo[1], q[1]) ];
        hi = [ Math.max(hi[0], q[0]), Math.max(hi[1], q[1]) ];
    }
    return {
        f: out,
        ov: {
            c: [ (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2 ],
            r: Math.max(hi[0] - lo[0], hi[1] - lo[1]) / 2 + 12
        }
    };
}

const tmpV = new THREE.Vector3;

function place(o, p) {
    o.position.set(p[0], p[1], 0);
    o.rotation.set(0, 0, p[2]);
}

function boxSet(e, x, y, z, l, w, h, yaw) {
    e.position.set(x, y, z);
    e.scale.set(l, w, h);
    e.rotation.set(0, 0, yaw);
    e.visible = true;
}

const LM = new Map;

function roadUser(g) {
    const cls = g[1], l = g[5], w = g[6], hs = hashId(g[0]), grp = new THREE.Group;
    let cat, h;
    if (cls === 3) {
        cat = "pedestrian";
        h = 1.75;
    } else if (cls === 4) {
        cat = "bicycle";
        h = 1.2;
    } else if (cls === 2 || l > 9) {
        cat = "bus";
        h = 3.3;
    } else if (cls === 1 || l > 6.3) {
        cat = "truck";
        h = 3.2;
    } else if (l > 5.25) {
        cat = "van";
        h = 2.5;
    } else {
        cat = [ "sedan", "suv", "sedan", "suv", "van" ][hs % 5];
        h = cat === "van" ? 1.8 : 1.55;
    }
    const edges = new THREE.LineSegments(UNIT_EDGES, new THREE.LineBasicMaterial({
        color: C.hit,
        transparent: true,
        opacity: 1
    }));
    edges.visible = false;
    grp.add(edges);
    const inst = REG.models[cat] ? REG.clay(cat, TH, hs, cat === "pedestrian" ? null : [ l, w, h ]) : null;
    const o = {
        grp: grp,
        edges: edges,
        cat: cat,
        _hl: -1,
        _br: -1
    };
    if (inst && cat === "bicycle") {
        const wrap = new THREE.Group;
        wrap.rotation.x = Math.PI / 2;
        wrap.add(inst.obj);
        grp.add(wrap);
        const d = inst.dims;
        const s = clamp(l / d.x, .85, 1.15);
        inst.obj.scale.setScalar(s);
        const key = inst.entry.id;
        if (!LM.has(key)) LM.set(key, bikeLandmarks(REG.models.bicycle.find((m => m.e.id === key)).root, inst.entry));
        const lm = LM.get(key), spin = new BikeSpin(inst.obj, lm), pi = REG.models.pedestrian ? REG.clay("pedestrian", TH, hs + 1, null) : null;
        const rider = pi ? new Rider(pi, lm, s) : null;
        if (rider) wrap.add(rider.obj);
        o.fit = () => {
            edges.scale.set(d.x * s + .15, d.z * s + .15, 1.8);
            edges.position.z = .9;
        };
        o.highlight = k => {
            if (k !== o._hl) {
                o._hl = k;
                inst.set.set(0, k);
                rider?.set.set(0, k);
            }
        };
        o.brake = () => {};
        o.anim = (t, v) => {
            const roll = t * Math.max(v, 0), crank = roll / (lm.wheel * 2.2 * s);
            spin.set(-crank - lm.crank0, -roll / (lm.wheel * s));
            if (rider) {
                grp.updateMatrixWorld(true);
                rider.pose(wrap, crank, 1);
            }
        };
    } else if (inst) {
        const wrap = new THREE.Group;
        wrap.rotation.x = Math.PI / 2;
        wrap.add(inst.obj);
        grp.add(wrap);
        const d = inst.dims;
        if (inst.set.m.light_rear) inst.set.setBrake(0);
        o.fit = (L, W) => {
            if (cat === "pedestrian") {
                inst.obj.scale.setScalar(1);
                edges.scale.set(.7, .7, 1.8);
                edges.position.z = .9;
                return;
            }
            const sx = L / d.x, sz = W / d.z, sy = clamp(Math.sqrt(sx * sz), .85, 1.15);
            inst.obj.scale.set(sx, sy, sz);
            edges.scale.set(L + .15, W + .15, d.y * sy + .1);
            edges.position.z = (d.y * sy + .1) / 2;
        };
        o.highlight = k => {
            if (k !== o._hl) {
                o._hl = k;
                inst.set.set(0, k);
            }
        };
        o.brake = k => {
            if (k !== o._br && cat !== "pedestrian") {
                o._br = k;
                inst.set.setBrake(k ? 1 : 0);
            }
        };
        o.anim = (t, v) => {
            if (!inst.mixer) return;
            const A = inst.actions, wk = clamp(v / 1, 0, 1);
            if (A.walk) A.walk.setEffectiveWeight(wk);
            if (A.idle) A.idle.setEffectiveWeight(1 - wk); else if (A.walk) A.walk.setEffectiveWeight(1);
            inst.mixer.setTime(hs % 100 / 37 + t * clamp(v / 1.3, .6, 1.6));
        };
    } else {
        const body = new THREE.Mesh(UNIT_BOX, new THREE.MeshStandardMaterial({
            color: cls === 3 ? 16498468 : 2765891,
            roughness: .7
        }));
        grp.add(body);
        o.fit = (L, W) => {
            body.scale.set(cls === 3 ? .5 : L, cls === 3 ? .5 : W, h);
            body.position.z = h / 2;
            edges.scale.copy(body.scale);
            edges.position.z = h / 2;
        };
        o.highlight = k => body.material.emissive.setHex(k ? 8327184 : 0);
        o.brake = () => {};
        o.anim = () => {};
    }
    return o;
}

function update(t) {
    const W = world, R = W.run, fi = clamp(Math.round(t * FPS_DATA), 0, S.frames.length - 1), fr = S.frames[fi];
    for (const k of [ "dt", "r2r", "gt" ]) place(W.egos[k], poseAt(R[k], t));
    {
        const a = poseAt(R.dt, t), b = poseAt(R.r2r, t), op = .3 + .7 * sstep(1.2, 3.5, Math.hypot(a[0] - b[0], a[1] - b[1])), u = W.egos.dt.userData;
        if (u.mats && Math.abs(op - u.op) > .01) {
            u.op = op;
            for (const m of u.mats) {
                m.transparent = op < .999;
                m.opacity = op;
                m.depthWrite = op >= .999;
                m.needsUpdate = true;
            }
        }
    }
    for (const k of [ "dt", "r2r" ]) {
        const es = W.egos[k].userData.es;
        if (!es) continue;
        const a0 = poseAt(R[k], Math.max(0, t - .3))[3], a1 = poseAt(R[k], t)[3];
        es.setLights(false, a1 < a0 - .12 || a1 < .3 && t > .5 ? 1 : 0);
    }
    place(W.egos.human, humanAt(t));
    W.egos.human.visible = $("p2p-show-human").checked;
    W.humanLine.visible = W.egos.human.visible;
    W.egos.gt.visible = $("p2p-show-gt").checked;
    W.trails.gt.full.visible = W.trails.gt.done.visible = W.egos.gt.visible;
    for (const k of [ "dt", "r2r", "gt" ]) {
        const tr = W.trails[k], n = clamp(Math.floor(t * FPS_DATA), 0, tr.n - 1);
        tr.done.geometry.instanceCount = Math.max(1, n);
    }
    const f = clamp(t * FPS_DATA, 0, S.frames.length - 1), i0 = Math.floor(f), i1 = Math.min(i0 + 1, S.frames.length - 1), a = f - i0, seen = new Set;
    const hitId = R.dt.tc != null ? R.dt.hit : null, hitOn = hitId != null && t >= R.dt.tc - .05;
    for (const g of S.frames[i0].gt) {
        let o = W.gt.get(g[0]);
        if (!o) {
            o = roadUser(g);
            W.root.add(o.grp);
            W.gt.set(g[0], o);
        }
        const q = S.byId[i1].get(g[0]) || g, x = g[2] + (q[2] - g[2]) * a, y = g[3] + (q[3] - g[3]) * a, yaw = lerpA(g[4], q[4], a), v = g[7] + (q[7] - g[7]) * a;
        o.grp.position.set(x, y, 0);
        o.grp.rotation.set(0, 0, yaw);
        o.fit(g[5], g[6]);
        const isHit = hitOn && g[0] === hitId;
        o.edges.visible = isHit;
        o.highlight(isHit ? 1 : 0);
        o.brake(q[7] < g[7] - .04 ? 1 : 0);
        o.anim(t, v);
        o.grp.visible = true;
        seen.add(g[0]);
    }
    for (const [id, o] of W.gt) if (!seen.has(id)) o.grp.visible = false;
    const showDet = $("p2p-show-det").checked;
    for (const k of [ "dt", "r2r" ]) {
        const pool = W.dets[k], L = showDet && fr.det && fr.ref ? fr.det[`${det}_${k}`] || [] : [];
        let n = 0;
        if (L.length) {
            const [rx, ry, ryaw] = fr.ref, c = Math.cos(ryaw), s = Math.sin(ryaw);
            for (const d of L) {
                if (n >= pool.length) break;
                const X = rx + c * d[1] - s * d[2], Y = ry + s * d[1] + c * d[2];
                boxSet(pool[n++], X, Y, Math.max(d[3], d[6] / 2), d[4] + (k === "dt" ? .18 : 0), d[5] + (k === "dt" ? .18 : 0), d[6], d[7] + ryaw);
            }
        }
        for (;n < pool.length; n++) pool[n].visible = false;
    }
    for (const [k, fx] of Object.entries(W.fx)) {
        const dtc = t - fx.tc, on = dtc >= 0;
        const p = poseAt(R[k], fx.tc), cx = p[0] + Math.cos(p[2]) * 3.4, cy = p[1] + Math.sin(p[2]) * 3.4;
        fx.ring.position.set(cx, cy, .1);
        fx.flash.position.set(cx, cy, .12);
        const pulse = on ? dtc % 1.6 / 1.6 : 0;
        fx.ring.scale.setScalar(1 + pulse * 9);
        fx.ring.material.opacity = on ? (1 - pulse) * .9 : 0;
        fx.flash.material.opacity = on ? .35 + .65 * Math.exp(-dtc * 2.5) : 0;
        fx.cx = cx;
        fx.cy = cy;
        fx.on = on && (k !== "gt" || W.egos.gt.visible);
        if (W.egos[k].userData.mat) {
            const blink = on ? .5 + .5 * Math.sign(Math.sin(dtc * 9)) : 0;
            W.egos[k].userData.mat.emissiveIntensity = on ? .1 + .7 * blink : W.egos[k].userData.base;
        }
    }
    setCamera(t);
    camera.updateMatrixWorld();
    const w = stage.clientWidth, h = stage.clientHeight;
    const proj = (x, y, z) => {
        tmpV.set(x, y, z).project(camera);
        return [ (tmpV.x * .5 + .5) * w, (-tmpV.y * .5 + .5) * h, tmpV.z < 1 ];
    };
    for (const k of [ "dt", "r2r" ]) {
        const p = poseAt(R[k], t), [u, v, ok] = proj(p[0] + 1.3 * Math.cos(p[2]), p[1] + 1.3 * Math.sin(p[2]), 2.2), lab = W.labels[k];
        const crashed = R[k].tc != null && t >= R[k].tc;
        lab.innerHTML = `<b>${k === "dt" ? "Direct transfer" : "R2R"}</b><span>${crashed ? "collided" : (p[3] * 3.6).toFixed(0) + " km/h"}</span>`;
        lab.style.transform = `translate(${u.toFixed(1)}px,${v.toFixed(1)}px) ` + (k === "dt" ? "translate(calc(-100% - 14px),-130%)" : "translate(14px,-130%)");
        lab.style.display = ok ? "" : "none";
    }
    for (const fx of Object.values(W.fx)) {
        const [u, v, ok] = proj(fx.cx, fx.cy, 1);
        fx.lab.style.transform = `translate(${u.toFixed(1)}px,${v.toFixed(1)}px) translate(-50%,55%)`;
        fx.lab.style.display = fx.on && ok ? "" : "none";
    }
    drawCams(fi);
    drawHud(t);
}

function setCamera(t) {
    if (view === "free") {
        controls.update();
        return;
    }
    const T = world.track, f = clamp(t * FPS_DATA, 0, T.f.length - 1), i = Math.floor(f), j = Math.min(i + 1, T.f.length - 1), a = f - i;
    const q = T.f[i].map(((v, c) => v + (T.f[j][c] - v) * a)), hd = Math.atan2(q[3], q[2]);
    let pos, tgt;
    if (view === "top") {
        const r = clamp(22 + q[4] * .8, 22, 70);
        tgt = new THREE.Vector3(q[0] + Math.cos(hd) * 6, q[1] + Math.sin(hd) * 6, 0);
        pos = new THREE.Vector3(tgt.x - Math.cos(hd) * r * .08, tgt.y - Math.sin(hd) * r * .08, r * 1.6);
    } else {
        const dist = clamp(17 + q[4] * .9, 17, 62);
        tgt = new THREE.Vector3(q[0] + Math.cos(hd) * 5, q[1] + Math.sin(hd) * 5, .8);
        const side = .32;
        pos = new THREE.Vector3(tgt.x - Math.cos(hd + side) * dist, tgt.y - Math.sin(hd + side) * dist, dist * .62);
        const ov = T.ov, e = 1 - sstep(0, 1.8, t);
        if (e > 0) {
            const P0 = new THREE.Vector3(ov.c[0] - Math.cos(hd + .5) * ov.r * 1.3, ov.c[1] - Math.sin(hd + .5) * ov.r * 1.3, ov.r * 1.5), T0 = new THREE.Vector3(ov.c[0], ov.c[1], 0);
            pos.lerp(P0, e);
            tgt.lerp(T0, e);
        }
    }
    camera.position.copy(pos);
    camera.lookAt(tgt);
    controls.target.copy(tgt);
}

const camC = {
    dt: $("p2p-cam-dt"),
    r2r: $("p2p-cam-r2r")
};

function drawCams(fi) {
    const imgs = cache[S.id].imgs;
    let im = null;
    for (let f = fi; f >= 0 && !im; f--) if (imgs[f] && imgs[f].complete && imgs[f].naturalWidth) im = imgs[f];
    const fr = S.frames[fi], K = S.K, M = fr.cam;
    for (const k of [ "dt", "r2r" ]) {
        const cv = camC[k], g = cv.getContext("2d"), W = cv.width, H = cv.height, sx = W / S.img[1], sy = H / S.img[0];
        g.fillStyle = "#05070a";
        g.fillRect(0, 0, W, H);
        if (im) g.drawImage(im, 0, 0, W, H);
        g.fillStyle = "rgba(5,7,10,.18)";
        g.fillRect(0, 0, W, H);
        if (!M || !fr.det) continue;
        const box = (x, y, z, l, w, h, yaw, col, lw, dash) => {
            const c = Math.cos(yaw), s = Math.sin(yaw), P = [];
            for (const dz of [ -h / 2, h / 2 ]) for (const [u, v] of [ [ l / 2, w / 2 ], [ l / 2, -w / 2 ], [ -l / 2, -w / 2 ], [ -l / 2, w / 2 ] ]) {
                const X = x + c * u - s * v, Y = y + s * u + c * v, Z = z + dz;
                P.push([ M[0] * X + M[1] * Y + M[2] * Z + M[3], M[4] * X + M[5] * Y + M[6] * Z + M[7], M[8] * X + M[9] * Y + M[10] * Z + M[11] ]);
            }
            if (P.every((p => p[2] < .3))) return;
            g.strokeStyle = col;
            g.lineWidth = lw;
            g.setLineDash(dash || []);
            g.beginPath();
            for (const [i, j] of [ [ 0, 1 ], [ 1, 2 ], [ 2, 3 ], [ 3, 0 ], [ 4, 5 ], [ 5, 6 ], [ 6, 7 ], [ 7, 4 ], [ 0, 4 ], [ 1, 5 ], [ 2, 6 ], [ 3, 7 ] ]) {
                let A = P[i], B = P[j];
                if (A[2] < .3 && B[2] < .3) continue;
                if (A[2] < .3 || B[2] < .3) {
                    const f = (.3 - A[2]) / (B[2] - A[2]), m = [ A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, .3 ];
                    if (A[2] < .3) A = m; else B = m;
                }
                g.moveTo((K[0] * A[0] / A[2] + K[1]) * sx, (K[0] * A[1] / A[2] + K[2]) * sy);
                g.lineTo((K[0] * B[0] / B[2] + K[1]) * sx, (K[0] * B[1] / B[2] + K[2]) * sy);
            }
            g.stroke();
            g.setLineDash([]);
        };
        const hit = world.run.dt.tc != null ? S.byId[fi].get(world.run.dt.hit) : null;
        if (hit && fr.ref) {
            const [rx, ry, ryaw] = fr.ref, c = Math.cos(ryaw), s = Math.sin(ryaw), dx = hit[2] - rx, dy = hit[3] - ry, h = HGT[hit[1]] || 1.6;
            box(c * dx + s * dy, -s * dx + c * dy, h / 2, hit[5], hit[6], h, hit[4] - ryaw, "rgba(255,255,255,.9)", 1.6, [ 5, 4 ]);
        }
        for (const d of fr.det[`${det}_${k}`] || []) box(d[1], d[2], d[3], d[4], d[5], d[6], d[7], CSS[k], 2.2);
    }
}

function drawHud(t) {
    $("p2p-clock").textContent = `t = ${t.toFixed(1)} s`;
    $("p2p-prog").style.width = `${t / T_END * 100}%`;
    $("p2p-head").style.left = `${t / T_END * 100}%`;
    for (const k of [ "dt", "r2r", "gt" ]) {
        const r = world.run[k], el = $(`p2p-st-${k}`);
        if (!el) continue;
        const p = poseAt(r, t), crashed = r.tc != null && t >= r.tc, done = t >= T_END - .05;
        el.querySelector(".v").textContent = crashed ? `collision at ${r.tc.toFixed(1)} s` : done ? `16 s without failure` : `${(p[3] * 3.6).toFixed(0)} km/h`;
        el.classList.toggle("bad", crashed);
        el.classList.toggle("good", !crashed && done && r.code === "s");
    }
}

function cardHTML(s) {
    const c = s.codes, dt = c[`det_${det}_dt`], r2 = c[`det_${det}_r2r`];
    const tag = (code, tc) => code === "c" ? `<i class="bad">&#10005; ${tc != null ? tc.toFixed(1) + " s" : ""}</i>` : code === "s" ? '<i class="good">&#10003;</i>' : `<i class="warn">${{
        o: "off road",
        r: "rule",
        t: "stall"
    }[code] || code}</i>`;
    return `<img src="${BASE}${s.id}/cam_000.webp" alt="" loading="lazy"><div class="t">${s.title}</div>\n    <div class="o"><span>Direct ${tag(dt, s.tc[`det_${det}_dt`])}</span><span>R2R ${tag(r2, s.tc[`det_${det}_r2r`])}</span></div>`;
}

function renderCards() {
    const box = $("p2p-scenes");
    box.innerHTML = "";
    for (const s of INDEX) {
        const b = document.createElement("button");
        b.className = "p2p-card" + (S && S.id === s.id ? " on" : "");
        b.innerHTML = cardHTML(s);
        b.onclick = () => loadScene(s.id);
        box.appendChild(b);
    }
}

function seenStats() {
    const r = world.run.dt;
    if (r.tc == null) return null;
    const j1 = Math.round(r.tc * FPS_DATA), out = {};
    for (const k of [ "dt", "r2r" ]) {
        let n = 0, m = 0;
        for (let j = 0; j <= j1; j++) {
            const f = S.frames[j], g = S.byId[j].get(r.hit);
            if (!g || !f.ref) continue;
            m++;
            const [rx, ry, ry0] = f.ref, c = Math.cos(ry0), s = Math.sin(ry0);
            if ((f.det[`${det}_${k}`] || []).some((d => Math.hypot(rx + c * d[1] - s * d[2] - g[2], ry + s * d[1] + c * d[2] - g[3]) < 2))) n++;
        }
        out[k] = [ n, m ];
    }
    return out;
}

function describe() {
    const s = INDEX.find((x => x.id === S.id));
    $("p2p-title").textContent = s.title;
    $("p2p-desc").textContent = s.desc;
    const el = $("p2p-seen");
    el.innerHTML = world.run.dt.tc == null && world.run.r2r.tc == null ? `With ${DETS[det]} boxes neither input collides in this scene.` : "";
    const tl = $("p2p-marks");
    tl.innerHTML = "";
    for (const k of [ "dt", "r2r", "gt" ]) {
        const r = world.run[k];
        if (r.tc == null) continue;
        const m = document.createElement("i");
        m.className = "mk " + k;
        m.style.left = `${r.tc / T_END * 100}%`;
        m.title = `${k} collision ${r.tc.toFixed(1)} s`;
        tl.appendChild(m);
    }
}

async function loadScene(id) {
    $("p2p-loading").style.opacity = 1;
    if (!regReady().done) {
        $("p2p-loading").textContent = "loading 3D models…";
        await regReady();
        REG_P.done = true;
        $("p2p-loading").textContent = "loading scene…";
    }
    if (!cache[id]) {
        const Sx = await (await fetch(`${BASE}${id}/scene.json`)).json();
        prep(Sx);
        const imgs = [];
        for (let j = 0; j < Sx.frames.length; j++) {
            const im = new Image;
            im.decoding = "async";
            imgs.push(im);
        }
        cache[id] = {
            S: Sx,
            imgs: imgs
        };
        const order = [];
        for (let s = 8; s >= 1; s = s >> 1) for (let j = 0; j < Sx.frames.length; j += s) if (!order.includes(j)) order.push(j);
        let q = 0;
        const next = () => {
            if (q >= order.length) return;
            const j = order[q++];
            imgs[j].onload = imgs[j].onerror = () => {
                dirty = true;
                next();
            };
            imgs[j].src = `${BASE}${id}/cam_${String(j).padStart(3, "0")}.webp`;
        };
        for (let c = 0; c < 6; c++) next();
    }
    S = cache[id].S;
    const s = INDEX.find((x => x.id === id));
    det = det || s.det;
    build();
    describe();
    renderCards();
    t = 0;
    holdUntil = 0;
    playing = true;
    setPlayIcon();
    dirty = true;
    $("p2p-loading").style.opacity = 0;
}

function setPlayIcon() {
    $("p2p-play").innerHTML = playing ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>';
}

$("p2p-play").onclick = () => {
    if (!playing && t >= T_END - .01) t = 0;
    playing = !playing;
    setPlayIcon();
};

$("p2p-speed").onclick = e => {
    speed = speed === 1 ? 2 : speed === 2 ? .5 : 1;
    e.currentTarget.textContent = `${speed}×`;
};

for (const b of app.querySelectorAll("[data-view]")) b.onclick = () => {
    view = b.dataset.view;
    for (const x of app.querySelectorAll("[data-view]")) x.classList.toggle("on", x === b);
    controls.enabled = view === "free";
    dirty = true;
};

for (const b of app.querySelectorAll("[data-det]")) b.onclick = () => {
    det = b.dataset.det;
    for (const x of app.querySelectorAll("[data-det]")) x.classList.toggle("on", x === b);
    if (S) {
        const keep = t;
        build();
        describe();
        renderCards();
        t = keep;
        dirty = true;
    }
};

for (const id of [ "p2p-show-det", "p2p-show-gt", "p2p-show-human" ]) $(id).onchange = () => {
    dirty = true;
};

const tlEl = $("p2p-tl");

const scrub = e => {
    const r = tlEl.getBoundingClientRect();
    t = clamp((e.clientX - r.left) / r.width, 0, 1) * T_END;
    dirty = true;
};

tlEl.addEventListener("pointerdown", (e => {
    tlEl.setPointerCapture(e.pointerId);
    playing = false;
    setPlayIcon();
    scrub(e);
    tlEl.onpointermove = scrub;
}));

tlEl.addEventListener("pointerup", (() => {
    tlEl.onpointermove = null;
}));

controls.addEventListener("change", (() => {
    dirty = true;
}));

function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const m of lineMats) m.resolution.set(w, h);
    dirty = true;
}

new ResizeObserver(resize).observe(stage);

new IntersectionObserver((es => {
    visible = es[0].isIntersecting;
    if (visible && !S && INDEX.length) loadScene(INDEX[0].id);
}), {
    rootMargin: "300px"
}).observe(app);

new IntersectionObserver(((es, ob) => {
    if (es[0].isIntersecting) {
        regReady();
        ob.disconnect();
    }
}), {
    rootMargin: "2000px"
}).observe(app);

function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(.1, (now - (lastNow || now)) / 1e3);
    lastNow = now;
    if (!visible || !world) return;
    if (playing && !document.hidden) {
        if (t >= T_END) {
            if (!holdUntil) holdUntil = now + 2200;
            if (now > holdUntil) {
                t = 0;
                holdUntil = 0;
            }
        } else {
            const tc = world.run.dt.tc, slow = tc != null ? 1 - .6 * Math.exp(-((t - tc + .4) ** 2) / (2 * .6 * .6)) : 1;
            t = Math.min(T_END, t + dt * speed * slow);
        }
        dirty = true;
    }
    if (view === "free") {
        controls.update();
    }
    if (dirty || view === "free") {
        update(t);
        composer.render();
        dirty = false;
    }
}

window.__p2p = {
    set: (id, tt, v, d) => {
        if (d) det = d;
        if (v) view = v;
        return loadScene(id).then((() => {
            t = tt;
            playing = false;
            setPlayIcon();
            visible = true;
            update(t);
            composer.render();
        }));
    },
    state: () => ({
        t: t,
        id: S && S.id
    })
};

(async () => {
    INDEX = await (await fetch(`${BASE}scenes.json`)).json();
    det = INDEX[0].det;
    renderCards();
    if (visible) loadScene(INDEX[0].id);
    requestAnimationFrame(frame);
})();

const RATES = {
    pdm: {
        gt: 6.9,
        spn: [ 25.8, 15.2 ],
        s4d: [ 17, 15.2 ],
        t4: [ 19.9, 12.7 ]
    },
    dp: {
        gt: 29.5,
        spn: [ 38.3, 25.8 ],
        s4d: [ 31, 27.3 ],
        t4: [ 26.9, 27.2 ]
    }
};

let PLAN = "pdm";

function bars() {
    const D = RATES[PLAN], mx = 40, el = $("p2p-bars");
    const row = (name, v, col) => `<div class="row"><span>${name}</span><div class="b"><div style="width:${v / mx * 100}%;background:${col}"></div></div><span class="n">${v.toFixed(1)}%</span></div>`;
    el.innerHTML = Object.entries(DETS).map((([k, n]) => `<div class="grp"><h5>${n}</h5>${row("Direct", D[k][0], "var(--red)")}${row("R2R", D[k][1], "var(--teal)")}${row("GT boxes", D.gt, "#e2e8f0")}</div>`)).join("");
}

for (const b of document.querySelectorAll("#p2p-plan [data-p]")) b.onclick = () => {
    PLAN = b.dataset.p;
    for (const x of document.querySelectorAll("#p2p-plan [data-p]")) x.classList.toggle("on", x === b);
    bars();
};

bars();
