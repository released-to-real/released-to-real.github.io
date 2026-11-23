import * as THREE from "three";

const V = () => new THREE.Vector3, Q = () => new THREE.Quaternion;

const FINGERS = [ "L", "R" ].flatMap((s => [ 0, 1, 2, 3, 4 ].flatMap((f => [ `Bip01_${s}_Finger${f}`, `Bip01_${s}_Finger${f}1`, `Bip01_${s}_Finger${f}2` ]))));

const BONES = [ "Bip01_Pelvis", "Bip01_Spine", "Bip01_Spine1", "Bip01_Spine2", "Bip01_Neck", "Bip01_Head", "Bip01_REye", ...[ "L", "R" ].flatMap((s => [ "Clavicle", "UpperArm", "Forearm", "Hand", "Thigh", "Calf", "Foot", "Toe0" ].map((b => `Bip01_${s}_${b}`)))), ...FINGERS ];

const NEED = [ "Bip01_Pelvis", "Bip01_Spine", "Bip01_Spine1", "Bip01_Spine2", "Bip01_Neck", "Bip01_Head", ...[ "L", "R" ].flatMap((s => [ "UpperArm", "Forearm", "Hand", "Thigh", "Calf", "Foot", "Toe0" ].map((b => `Bip01_${s}_${b}`)))) ];

function verts(node, inv) {
    const out = [], v = V();
    node.updateMatrixWorld(true);
    node.traverse((o => {
        if (!o.isMesh) return;
        const P = o.geometry.attributes.position, M = (new THREE.Matrix4).multiplyMatrices(inv, o.matrixWorld);
        for (let i = 0; i < P.count; i += 2) {
            v.fromBufferAttribute(P, i).applyMatrix4(M);
            out.push([ v.x, v.y, v.z ]);
        }
    }));
    return out;
}

const avg = (A, f) => A.reduce(((s, p) => s + f(p)), 0) / Math.max(A.length, 1);

export function bikeLandmarks(root, entry) {
    root.updateMatrixWorld(true);
    const inv = (new THREE.Matrix4).copy(root.matrixWorld).invert();
    const pts = verts(root, inv);
    const rear = pts.filter((p => p[0] < -.05 && Math.abs(p[2]) < .08));
    const sy = Math.max(...rear.map((p => p[1])));
    const sad = rear.filter((p => p[1] > sy - .02));
    const front = pts.filter((p => p[0] > .15 && p[1] > .7));
    const gz = Math.max(...front.map((p => Math.abs(p[2]))));
    const gr = front.filter((p => Math.abs(p[2]) > gz - .03));
    const ax = entry?.axles || {};
    const rx = ax.rear_axle_x_m ?? -.5, fx = ax.front_axle_x_m ?? .5, wr = ax.wheel_radius_m ?? .34;
    const lm = {
        saddle: new THREE.Vector3(avg(sad, (p => p[0])), sy, 0),
        grip: new THREE.Vector3(avg(gr, (p => p[0])), avg(gr, (p => p[1])), avg(gr, (p => Math.abs(p[2])))),
        bb: new THREE.Vector3(rx + .41 * (fx - rx) / 1.04, wr - .07, 0),
        crank: .17,
        pedalZ: .115,
        crank0: 0,
        wheel: wr,
        nodes: null
    };
    const crank = root.getObjectByName("Pedal_system"), wheels = [ "Back_Wheel", "Front_Wheel" ].map((n => root.getObjectByName(n))).filter(Boolean);
    if (crank) {
        const C = verts(crank, inv);
        let cx = (Math.min(...C.map((p => p[0]))) + Math.max(...C.map((p => p[0])))) / 2, cy = (Math.min(...C.map((p => p[1]))) + Math.max(...C.map((p => p[1])))) / 2;
        for (let k = 0; k < 12; k++) {
            const N = C.filter((p => Math.hypot(p[0] - cx, p[1] - cy) < .11));
            if (!N.length) break;
            cx = avg(N, (p => p[0]));
            cy = avg(N, (p => p[1]));
        }
        const zr = Math.max(...C.map((p => p[2]))), zl = Math.min(...C.map((p => p[2])));
        const R = C.filter((p => p[2] > zr - .05)), L = C.filter((p => p[2] < zl + .05));
        const pr = [ avg(R, (p => p[0])), avg(R, (p => p[1])) ], pl = [ avg(L, (p => p[0])), avg(L, (p => p[1])) ];
        const len = (Math.hypot(pr[0] - cx, pr[1] - cy) + Math.hypot(pl[0] - cx, pl[1] - cy)) / 2;
        if (len > .12 && len < .2) {
            lm.bb.set(cx, cy, 0);
            lm.crank = len;
            lm.pedalZ = (avg(R, (p => p[2])) - avg(L, (p => p[2]))) / 2;
            lm.crank0 = Math.atan2(pr[1] - cy, pr[0] - cx);
        }
        lm.nodes = {
            crank: crank.name,
            bb: lm.bb.clone(),
            wheels: wheels.map((w => {
                const W = verts(w, inv);
                const c = i => (Math.min(...W.map((p => p[i]))) + Math.max(...W.map((p => p[i])))) / 2;
                return {
                    name: w.name,
                    c: new THREE.Vector3(c(0), c(1), c(2))
                };
            }))
        };
    }
    return lm;
}

export class BikeSpin {
    constructor(obj, lm) {
        this.parts = [];
        if (!lm.nodes) return;
        obj.updateMatrixWorld(true);
        const H = obj.matrixWorld;
        const add = (name, c, kind) => {
            const n = obj.getObjectByName(name);
            if (!n) return;
            const M = (new THREE.Matrix4).copy(n.parent.matrixWorld).invert().multiply(H);
            n.updateMatrix();
            n.matrixAutoUpdate = false;
            this.parts.push({
                n: n,
                p: c.clone().applyMatrix4(M),
                ax: new THREE.Vector3(0, 0, 1).transformDirection(M),
                rest: n.matrix.clone(),
                kind: kind
            });
        };
        add(lm.nodes.crank, lm.nodes.bb, "crank");
        for (const w of lm.nodes.wheels) add(w.name, w.c, "wheel");
        this.T = new THREE.Matrix4;
        this.R = new THREE.Matrix4;
        this.Ti = new THREE.Matrix4;
    }
    set(crank, wheel) {
        for (const q of this.parts) {
            const a = q.kind === "crank" ? crank : wheel;
            this.T.makeTranslation(q.p.x, q.p.y, q.p.z);
            this.Ti.makeTranslation(-q.p.x, -q.p.y, -q.p.z);
            this.R.makeRotationAxis(q.ax, a);
            q.n.matrix.copy(this.T).multiply(this.R).multiply(this.Ti).multiply(q.rest);
            q.n.matrixWorldNeedsUpdate = true;
        }
    }
}

function twoBone(A, T, l1, l2, pole) {
    const AT = T.clone().sub(A);
    let d = AT.length();
    const ax = AT.clone().normalize();
    d = Math.min(d, (l1 + l2) * .999);
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(l1 * l1 - along * along, 0));
    const pd = pole.clone().sub(ax.clone().multiplyScalar(pole.dot(ax))).normalize();
    return A.clone().add(ax.multiplyScalar(along)).add(pd.multiplyScalar(h));
}

export class Rider {
    constructor(inst, lm, bikeScale) {
        this.inst = inst;
        this.obj = inst.obj;
        this.set = inst.set;
        this.lm = lm;
        this.s = bikeScale;
        this.B = {};
        this.lean = null;
        this.obj.traverse((o => {
            if (o.isBone && BONES.includes(o.name)) this.B[o.name] = o;
        }));
        if (inst.mixer) {
            inst.mixer.stopAllAction();
            inst.mixer = null;
        }
        this.rest = Object.fromEntries(Object.entries(this.B).map((([k, b]) => [ k, b.quaternion.clone() ])));
        this.ok = NEED.every((k => this.B[k]));
        if (!this.ok) return;
        this.obj.updateMatrixWorld(true);
        const lp = k => this.obj.worldToLocal(this.B[k].getWorldPosition(V())), len = (a, b) => lp(a).distanceTo(lp(b));
        this.L = {
            thigh: len("Bip01_L_Thigh", "Bip01_L_Calf"),
            shank: len("Bip01_L_Calf", "Bip01_L_Foot"),
            upper: len("Bip01_L_UpperArm", "Bip01_L_Forearm"),
            fore: len("Bip01_L_Forearm", "Bip01_L_Hand")
        };
        this.pelvisRest = lp("Bip01_Pelvis");
        const f = lp("Bip01_L_Toe0").sub(lp("Bip01_L_Foot"));
        this.foot = {
            len: Math.hypot(f.x, f.y),
            ang: Math.atan2(f.y, f.x)
        };
        if (this.B.Bip01_REye) {
            const e = lp("Bip01_REye").sub(lp("Bip01_Head"));
            this.eye = {
                f: e.x,
                u: e.y,
                r: e.z
            };
        }
    }
    aim(name, child, target) {
        const b = this.B[name], c = this.B[child];
        if (!b || !c) return;
        const p = b.getWorldPosition(V()), d0 = c.getWorldPosition(V()).sub(p).normalize(), d1 = target.clone().sub(p).normalize();
        const q = Q().setFromUnitVectors(d0, d1).multiply(b.getWorldQuaternion(Q()));
        b.quaternion.copy(b.parent.getWorldQuaternion(Q()).invert().multiply(q));
        b.updateMatrixWorld(true);
    }
    restPose() {
        for (const [k, q] of Object.entries(this.rest)) this.B[k].quaternion.copy(q);
        this.obj.updateMatrixWorld(true);
    }
    frame(root) {
        root.updateMatrixWorld(true);
        const M = root.matrixWorld;
        return {
            W: (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M),
            fwd: new THREE.Vector3(1, 0, 0).transformDirection(M),
            up: new THREE.Vector3(0, 1, 0).transformDirection(M),
            right: new THREE.Vector3(0, 0, 1).transformDirection(M)
        };
    }
    dir(F, a) {
        return F.fwd.clone().multiplyScalar(Math.sin(a)).add(F.up.clone().multiplyScalar(Math.cos(a)));
    }
    torso(lean, F) {
        const at = (k, a) => this.B[k].getWorldPosition(V()).add(this.dir(F, a));
        this.aim("Bip01_Pelvis", "Bip01_Spine", at("Bip01_Pelvis", lean * .75));
        this.aim("Bip01_Spine1", "Bip01_Spine2", at("Bip01_Spine1", lean));
        this.aim("Bip01_Spine2", "Bip01_Neck", at("Bip01_Spine2", lean * 1.1));
        this.aim("Bip01_Neck", "Bip01_Head", at("Bip01_Neck", lean * .45));
    }
    fitLean(F) {
        const r = this.obj.scale.x, reach = .9 * (this.L.upper + this.L.fore) * r;
        let best = .75, be = 1e9;
        const G = [ "L", "R" ].map(((sd, i) => this.wrist(F, i ? 1 : -1)));
        for (let a = .15; a <= 1.35; a += .03) {
            this.restPose();
            this.torso(a, F);
            const e = Math.abs([ "L", "R" ].reduce(((acc, sd, i) => acc + this.B[`Bip01_${sd}_UpperArm`].getWorldPosition(V()).distanceTo(G[i])), 0) / 2 - reach);
            if (e < be) {
                be = e;
                best = a;
            }
        }
        this.restPose();
        return best;
    }
    grip(F, sg) {
        const lm = this.lm, s = this.s;
        return F.W(lm.grip.x * s, lm.grip.y * s, sg * lm.grip.z * s);
    }
    wrist(F, sg) {
        const r = this.obj.scale.x;
        return this.grip(F, sg).add(F.fwd.clone().multiplyScalar(-.055 * r)).add(F.up.clone().multiplyScalar(.03 * r));
    }
    pose(root, phase, r = 1) {
        if (!this.ok) return;
        const lm = this.lm, s = this.s;
        this.obj.scale.setScalar(r);
        this.obj.position.set(lm.saddle.x * s - .02 - this.pelvisRest.x * r, lm.saddle.y * s + .07 - this.pelvisRest.y * r, -this.pelvisRest.z * r);
        this.restPose();
        const F = this.frame(root);
        if (this.lean == null) this.lean = this.fitLean(F);
        this.torso(this.lean, F);
        if (this.eye) {
            const e = this.eye, a = Math.atan2(e.u, e.f) - .26, L = Math.hypot(e.f, e.u);
            this.aim("Bip01_Head", "Bip01_REye", this.B.Bip01_Head.getWorldPosition(V()).add(F.fwd.clone().multiplyScalar(L * Math.cos(a) * r)).add(F.up.clone().multiplyScalar(L * Math.sin(a) * r)).add(F.right.clone().multiplyScalar(e.r * r)));
        }
        for (const [sd, sg] of [ [ "L", -1 ], [ "R", 1 ] ]) {
            const G = this.grip(F, sg), wr = this.wrist(F, sg), sh = this.B[`Bip01_${sd}_UpperArm`].getWorldPosition(V());
            const pole = F.right.clone().multiplyScalar(sg * .8).add(F.up.clone().multiplyScalar(-.5)).add(F.fwd.clone().multiplyScalar(-.2));
            const el = twoBone(sh, wr, this.L.upper * r, this.L.fore * r, pole);
            this.aim(`Bip01_${sd}_UpperArm`, `Bip01_${sd}_Forearm`, el);
            this.aim(`Bip01_${sd}_Forearm`, `Bip01_${sd}_Hand`, wr);
            this.aim(`Bip01_${sd}_Hand`, `Bip01_${sd}_Finger2`, G.clone().add(F.fwd.clone().multiplyScalar(.012 * r)).add(F.up.clone().multiplyScalar(.03 * r)));
            const rb = .028 * r;
            for (const f of [ 1, 2, 3, 4 ]) {
                const b0 = `Bip01_${sd}_Finger${f}`, b1 = `${b0}1`, b2 = `${b0}2`;
                if (!this.B[b0] || !this.B[b1]) continue;
                const Gc = G.clone().add(F.right.clone().multiplyScalar(this.B[b0].getWorldPosition(V()).sub(G).dot(F.right)));
                this.aim(b0, b1, Gc.clone().add(F.fwd.clone().multiplyScalar(rb * .95)).add(F.up.clone().multiplyScalar(rb * .3)));
                if (this.B[b2]) this.aim(b1, b2, Gc.clone().add(F.fwd.clone().multiplyScalar(rb * .35)).add(F.up.clone().multiplyScalar(-rb * .95)));
            }
            const t0 = `Bip01_${sd}_Finger0`;
            if (this.B[t0] && this.B[`${t0}1`]) this.aim(t0, `${t0}1`, G.clone().add(F.up.clone().multiplyScalar(-rb)).add(F.fwd.clone().multiplyScalar(.01 * r)));
        }
        for (const [sd, sg, ph] of [ [ "L", -1, phase + Math.PI ], [ "R", 1, phase ] ]) {
            const hip = this.B[`Bip01_${sd}_Thigh`].getWorldPosition(V());
            const toe = F.W((lm.bb.x + lm.crank * Math.cos(ph)) * s, (lm.bb.y - lm.crank * Math.sin(ph)) * s, sg * lm.pedalZ * s).add(F.up.clone().multiplyScalar(.015 * r));
            const a = this.foot.ang - (.2 + .12 * Math.sin(ph)), L = this.foot.len * r;
            const ankle = toe.clone().sub(F.fwd.clone().multiplyScalar(L * Math.cos(a))).sub(F.up.clone().multiplyScalar(L * Math.sin(a)));
            const pole = F.fwd.clone().add(F.right.clone().multiplyScalar(sg * .12)).add(F.up.clone().multiplyScalar(.3));
            const knee = twoBone(hip, ankle, this.L.thigh * r, this.L.shank * r, pole);
            this.aim(`Bip01_${sd}_Thigh`, `Bip01_${sd}_Calf`, knee);
            this.aim(`Bip01_${sd}_Calf`, `Bip01_${sd}_Foot`, ankle);
            this.aim(`Bip01_${sd}_Foot`, `Bip01_${sd}_Toe0`, toe);
        }
    }
}
