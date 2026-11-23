import * as THREE from "three";

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const RX = {
    glass: /glass|window|windshield|windscreen|vidro|cristal/i,
    tyre: /tyre|tire|rubber/i,
    rim: /rim|wheel|hub|alloy/i,
    light_rear: /tail|rear_?light|red_?light|brake_?light|stop_?lamp/i,
    light_front: /head|front_?light|headlamp|wight_light|white_light/i,
    body: /body|paint|carpaint|shell/i
};

function classify(mesh, mat, lists) {
    const nm = mat?.name || "";
    if (lists) for (const k of [ "body", "glass", "tyre", "rim", "light_front", "light_rear", "other" ]) if ((lists[k] || []).includes(nm)) return k;
    const s = `${nm} ${mesh.name}`;
    for (const k of [ "glass", "light_rear", "light_front", "tyre", "rim", "body" ]) if (RX[k].test(s)) return k;
    return "other";
}

export class ClaySet {
    constructor(th, ped = false) {
        const std = (c, r, env) => new THREE.MeshStandardMaterial({
            color: c,
            roughness: r,
            metalness: 0,
            envMapIntensity: env
        });
        this.ped = ped;
        this.m = {
            body: std(ped ? th.ped : th.clay, ped ? .7 : .58, th.clayEnv),
            glass: std(th.glass, .3, .2),
            tyre: std(th.tyre, .9, .1),
            rim: std(th.wheel, .42, th.clayEnv),
            other: std(th.trim, .6, th.clayEnv),
            light_front: std(th.headLens, .55, .12),
            light_rear: new THREE.MeshStandardMaterial({
                color: th.tailLens,
                roughness: .3,
                metalness: 0,
                emissive: 16719390,
                emissiveIntensity: 0
            })
        };
        this.extra = [];
        this.fade = 0;
        this.hl = 0;
        this.brake = 0;
        this.restyle(th);
    }
    addBody(m) {
        this.extra.push(m);
        this.apply();
    }
    restyle(th) {
        this.th = th;
        this.base = {
            body: new THREE.Color(this.ped ? th.ped : th.clay),
            glass: new THREE.Color(th.glass),
            tyre: new THREE.Color(th.tyre),
            rim: new THREE.Color(th.wheel),
            other: new THREE.Color(th.trim),
            light_front: new THREE.Color(th.headLens),
            light_rear: new THREE.Color(th.tailLens)
        };
        this.hlCol = new THREE.Color(th.highlight);
        this._hlHex = th.highlight;
        this.bg = new THREE.Color(th.bg);
        for (const k of [ "body", "rim", "other" ]) this.m[k].envMapIntensity = th.clayEnv;
        this.apply();
    }
    setHlColor(hex) {
        if (this._hlHex !== hex) {
            this._hlHex = hex;
            this.hlCol.set(hex);
            if (this.hl > 0) this.apply();
        }
    }
    set(fade, hl) {
        if (Math.abs(fade - this.fade) > .001 || Math.abs(hl - this.hl) > .001) {
            this.fade = fade;
            this.hl = hl;
            this.apply();
        }
    }
    apply() {
        const t = this.fade;
        for (const [k, mat] of Object.entries(this.m)) {
            const c = this.base[k].clone();
            if (k === "body" && this.hl > 0) c.lerp(this.hlCol, .7 * this.hl);
            mat.color.copy(c).multiplyScalar(1 - t);
            if (k !== "light_rear") mat.emissive.copy(this.bg).multiplyScalar(t);
        }
        for (const mat of this.extra) {
            mat.color.copy(this.m.body.color);
            mat.emissive.copy(this.m.body.emissive);
            mat.envMapIntensity = this.m.body.envMapIntensity;
        }
    }
    setBrake(v) {
        this.brake = v;
        this.m.light_rear.emissiveIntensity = (.12 + 3.6 * v) * (1 - this.fade);
    }
}

export class EgoSet {
    constructor() {
        this.m = {
            body: new THREE.MeshPhysicalMaterial({
                color: 15921904,
                roughness: .3,
                metalness: 0,
                clearcoat: 1,
                clearcoatRoughness: .035,
                envMapIntensity: 1
            }),
            glass: new THREE.MeshPhysicalMaterial({
                color: 329223,
                roughness: .04,
                metalness: 0,
                clearcoat: 1,
                clearcoatRoughness: .02,
                envMapIntensity: 1.25
            }),
            tyre: new THREE.MeshStandardMaterial({
                color: 855310,
                roughness: .88,
                metalness: 0
            }),
            rim: new THREE.MeshStandardMaterial({
                color: 12567496,
                roughness: .22,
                metalness: 1,
                envMapIntensity: 1.1
            }),
            light_front: new THREE.MeshStandardMaterial({
                color: 14673390,
                roughness: .08,
                metalness: .2,
                emissive: 15266047,
                emissiveIntensity: 0
            }),
            light_rear: new THREE.MeshStandardMaterial({
                color: 4851206,
                roughness: .15,
                metalness: .1,
                emissive: 16718354,
                emissiveIntensity: .3
            })
        };
    }
    paint(hex, metallic) {
        const b = this.m.body;
        b.color.set(hex);
        b.metalness = metallic ? .55 : 0;
        b.roughness = metallic ? .34 : .26;
    }
    env(v) {
        this.m.body.envMapIntensity = v;
        this.m.glass.envMapIntensity = 1.25 * v;
        this.m.rim.envMapIntensity = 1.1 * v;
    }
    setLights(night, brake) {
        this.m.light_front.emissiveIntensity = night ? 1.6 : .05;
        this.m.light_rear.emissiveIntensity = .35 + 3.8 * brake;
    }
}

export class Registry {
    constructor() {
        this.models = {};
        this.manifest = null;
    }
    async load(base = "assets/models/", cats = null) {
        try {
            this.manifest = await (await fetch(`${base}manifest.json`, {
                cache: "no-cache"
            })).json();
        } catch {
            this.manifest = null;
            return this;
        }
        const entries = (Array.isArray(this.manifest) ? this.manifest : this.manifest.models || []).filter((e => !cats || cats.has(e.category) || /^ego_/.test(e.id)));
        const loader = new GLTFLoader;
        const draco = new DRACOLoader;
        draco.setDecoderPath("vendor/jsm/libs/draco/gltf/");
        loader.setDRACOLoader(draco);
        loader.setMeshoptDecoder(MeshoptDecoder);
        await Promise.all(entries.map((async e => {
            try {
                const g = await loader.loadAsync(e.file);
                const root = this.normalise(g.scene, e);
                (this.models[e.category] ||= []).push({
                    e: e,
                    root: root,
                    anims: g.animations || []
                });
            } catch (err) {
                console.warn("model failed", e.file, err);
            }
        })));
        for (const L of Object.values(this.models)) L.sort(((a, b) => a.e.id.localeCompare(b.e.id)));
        return this;
    }
    async loadFrom(manifest, cats, prog, egoId = null) {
        this.manifest = manifest;
        const entries = (manifest.models || []).filter((e => !Registry.skip(e) && ((/^ego_/.test(e.id) ? e.id === egoId : !cats || cats.has(e.category)) || e.id === egoId)));
        await Promise.all(entries.map((e => this.loadEntry(e, prog))));
        return this;
    }
    loader() {
        if (!this._loader) {
            const l = new GLTFLoader;
            const d = new DRACOLoader;
            d.setDecoderPath("vendor/jsm/libs/draco/gltf/");
            l.setDRACOLoader(d);
            l.setMeshoptDecoder(MeshoptDecoder);
            this._loader = l;
        }
        return this._loader;
    }
    isLoaded(id) {
        return Object.values(this.models).some((L => L.some((m => m.e.id === id))));
    }
    async loadEntry(e, prog = null) {
        if (this.isLoaded(e.id)) return;
        try {
            const buf = prog ? await prog.fetch(e.file, "3D models", e.id) : await (await fetch(e.file, {
                cache: "no-cache"
            })).arrayBuffer();
            const g = await this.loader().parseAsync(buf, e.file.replace(/[^/]*$/, ""));
            const L = this.models[e.category] ||= [];
            L.push({
                e: e,
                root: this.normalise(g.scene, e),
                anims: g.animations || []
            });
            L.sort(((a, b) => a.e.id.localeCompare(b.e.id)));
        } catch (err) {
            console.warn("model failed", e.file, err);
            prog?.finish(e.id);
        }
    }
    normalise(scene, e) {
        const holder = new THREE.Group;
        holder.add(scene);
        const axis = s => ({
            "+x": [ 1, 0, 0 ],
            "-x": [ -1, 0, 0 ],
            "+y": [ 0, 1, 0 ],
            "-y": [ 0, -1, 0 ],
            "+z": [ 0, 0, 1 ],
            "-z": [ 0, 0, -1 ]
        }[(s || "").toLowerCase()]);
        const F = new THREE.Vector3(...axis(e.forward_axis) || [ 1, 0, 0 ]), U = new THREE.Vector3(...axis(e.up_axis) || [ 0, 1, 0 ]), Rt = (new THREE.Vector3).crossVectors(F, U);
        scene.applyMatrix4((new THREE.Matrix4).makeBasis(F, U, Rt).invert());
        scene.scale.multiplyScalar(e.scale_to_m || 1);
        scene.updateMatrixWorld(true);
        const bb = (new THREE.Box3).setFromObject(scene, true);
        const c = bb.getCenter(new THREE.Vector3);
        scene.position.x -= c.x;
        scene.position.z -= c.z;
        scene.position.y -= bb.min.y;
        scene.updateMatrixWorld(true);
        const dims = (new THREE.Box3).setFromObject(scene, true).getSize(new THREE.Vector3);
        if (e.bbox_m) {
            const [l, w, h] = e.bbox_m;
            if (Math.abs(dims.x / l - 1) > .1 || Math.abs(dims.z / w - 1) > .1 || Math.abs(dims.y / h - 1) > .1) console.warn("bbox mismatch", e.id, dims.toArray(), e.bbox_m);
        }
        holder.userData.dims = dims;
        holder.userData.lists = e.materials || null;
        scene.traverse((o => {
            if (o.isMesh) {
                o.castShadow = false;
                o.receiveShadow = false;
            }
        }));
        return holder;
    }
    has(cat) {
        return this.clayList(cat).length > 0;
    }
    variants(cat) {
        return (this.models[cat] || []).map((m => m.e.id));
    }
    _clone(M) {
        let sk = false;
        M.root.traverse((o => {
            if (o.isSkinnedMesh) sk = true;
        }));
        return sk ? SkeletonUtils.clone(M.root) : M.root.clone(true);
    }
    clayList(cat) {
        return (this.models[cat] || []).filter((m => (cat === "pedestrian" || (m.e.materials?.body || []).length || !m.e.materials) && !/trailer_reefer$|tractor|^ego_/i.test(m.e.id) && !Registry.skip(m.e)));
    }
    static skip(e) {
        return e.category === "pedestrian" && /female/i.test(e.id);
    }
    pick(cat, lwh, h = 0) {
        const L = this.clayList(cat);
        if (!L.length) return -1;
        if (!lwh) return h % L.length;
        const sc = L.map(((m, i) => {
            const d = m.root.userData.dims;
            return [ Math.abs(Math.log(lwh[0] / d.x)) + Math.abs(Math.log(lwh[2] / d.y)) + .5 * Math.abs(Math.log(lwh[1] / d.z)), i ];
        })).sort(((a, b) => a[0] - b[0]));
        const near = sc.filter((x => x[0] < sc[0][0] + .22));
        return near[h % near.length][1];
    }
    clay(cat, th, variant = 0, lwh = null) {
        const L = this.clayList(cat);
        if (!L.length) return null;
        const vi = lwh ? this.pick(cat, lwh, variant) : variant % L.length;
        const M = L[vi];
        const obj = this._clone(M);
        const ped = cat === "pedestrian";
        const set = new ClaySet(th, ped);
        const cache = new Map;
        obj.traverse((o => {
            if (!o.isMesh) return;
            const swap = mat => {
                if (ped) {
                    if (/opacity/i.test(mat?.name || "")) {
                        o.visible = false;
                        return mat;
                    }
                    if (!cache.has(mat)) {
                        const m = set.m.body.clone();
                        if (mat?.normalMap) {
                            m.normalMap = mat.normalMap;
                            m.normalScale = new THREE.Vector2(.55, .55);
                        }
                        set.addBody(m);
                        cache.set(mat, m);
                    }
                    return cache.get(mat);
                }
                return set.m[classify(o, mat, M.root.userData.lists)] || set.m.other;
            };
            o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
        }));
        let mixer = null, actions = null;
        if (M.anims.length) {
            mixer = new THREE.AnimationMixer(obj);
            const get = re => M.anims.find((a => re.test(a.name)));
            actions = {
                walk: get(/walk/i) && mixer.clipAction(get(/walk/i)),
                idle: get(/idle/i) && mixer.clipAction(get(/idle/i)),
                run: get(/run/i) && mixer.clipAction(get(/run/i))
            };
            for (const a of Object.values(actions)) if (a) {
                a.play();
                a.setEffectiveWeight(0);
            }
            mixer.setTime(Math.random() * 3);
        }
        return {
            obj: obj,
            set: set,
            mixer: mixer,
            actions: actions,
            dims: M.root.userData.dims.clone(),
            entry: M.e
        };
    }
    ego(cat, egoSet, id = null) {
        const L = this.models[cat];
        if (!L || !L.length) return null;
        const M = id && L.find((m => m.e.id === id)) || L[0];
        const obj = this._clone(M);
        obj.traverse((o => {
            if (!o.isMesh) return;
            const swap = mat => {
                const k = classify(o, mat, M.root.userData.lists);
                if (k === "other") {
                    const m = mat.clone();
                    if (m.envMapIntensity !== undefined) m.envMapIntensity = .9;
                    return m;
                }
                return egoSet.m[k];
            };
            o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
        }));
        return {
            obj: obj,
            dims: M.root.userData.dims.clone(),
            entry: M.e
        };
    }
}
