import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { useBuddy } from '../store/buddy';
import { CHAR_H, CHAR_W } from './config';

/** how long each gesture / emotion lasts (seconds) */
const DUR: Record<string, number> = {
  wave: 2.2, nod: 1.0, shake_head: 1.1, jump: 0.9, punch: 0.8, flinch: 0.7, duck: 1.4, die_dramatically: 2.4,
  happy: 3, angry: 3, sad: 3.5, surprised: 2.2, laugh: 2.6,
};
/** face expression used by each emotion (three-vrm names; VRM0 Joy=happy, Sorrow=sad, Fun=relaxed) */
const FACE: Record<string, Record<string, number>> = {
  happy: { happy: 1 }, laugh: { happy: 1, aa: 0.45 }, angry: { angry: 1 }, sad: { sad: 1 },
  surprised: { relaxed: 0.2, oh: 0.7 }, flinch: { sad: 0.6 }, punch: { angry: 0.8 }, duck: { sad: 0.5 },
  die_dramatically: { sad: 1 }, jump: { happy: 0.8 }, wave: { happy: 0.6 },
};
const FACE_KEYS = ['happy', 'angry', 'sad', 'relaxed', 'oh'];
const ease = (x: number) => x * x * (3 - 2 * x);
/** 0 -> 1 -> 0 over the gesture */
const bell = (p: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, p)));

/** the 3D character: a VRM model (blendshapes for blink, lips and emotions; arms posed by code) */
export default function Character({ getLevel }: { getLevel: () => number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const play = useRef<(n: string) => void>(() => undefined);
  const gesture = useBuddy((s) => s.gesture);
  const lvl = useRef(getLevel);
  lvl.current = getLevel;

  useEffect(() => { if (gesture.name) play.current(gesture.name); }, [gesture]);

  useEffect(() => {
    const el = canvas.current!;
    const renderer = new THREE.WebGLRenderer({ canvas: el, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(CHAR_W, CHAR_H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9999bb, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.8, 1.6, 2.5);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0xb9a7ff, 1.4);
    rim.position.set(-1.5, 1.8, -2);
    scene.add(rim);
    // bust shot: head and shoulders fill the little window
    const camera = new THREE.PerspectiveCamera(28, CHAR_W / CHAR_H, 0.1, 20);
    camera.position.set(0, 1.28, 2.0);
    camera.lookAt(0, 1.26, 0);
    const root = new THREE.Group();
    scene.add(root);

    let vrm: VRM | undefined;
    let flip = 1;
    let raf = 0, last = 0, t = 0, alive = true;
    let nextBlink = 2, blinkT = -1;
    let g = { name: '', t0: 0 };
    let mouth = 0, oh = 0;
    const face: Record<string, number> = {};

    play.current = (name) => { if (DUR[name]) g = { name, t0: t }; };

    const loader = new GLTFLoader();
    loader.register((p) => new VRMLoaderPlugin(p));
    loader.load(`${import.meta.env.BASE_URL}models/buddy.vrm`, (gltf) => {
      const v = gltf.userData.vrm as VRM | undefined;
      if (!v) return;
      if (!alive) { VRMUtils.deepDispose(v.scene); return; }
      VRMUtils.rotateVRM0(v);               // VRM 0.x models face -Z; turn the buddy towards the camera
      v.scene.traverse((o) => { o.frustumCulled = false; });
      root.add(v.scene);
      vrm = v;
      flip = v.meta?.metaVersion === '0' ? -1 : 1;
      root.rotation.y = -0.15;
    });

    const bone = (n: string) => vrm?.humanoid.getNormalizedBoneNode(n as never) ?? null;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || now - last < 33) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now; t += dt;
      if (!vrm) return;
      const em = vrm.expressionManager;
      const l = lvl.current();

      // ---- gesture progress
      const dur = DUR[g.name] ?? 0;
      const p = g.name ? (t - g.t0) / dur : 2;
      const on = p >= 0 && p < 1;
      const gn = on ? g.name : '';
      const b = bell(p);

      // ---- body pose (arms down, breathing, small sway)
      // VRM 0.x bones live in a mirrored space (x and z flipped), so rotations around x and z change sign
      const breathe = Math.sin(t * 2) * 0.012;
      const hips = bone('hips'), spine = bone('spine'), chest = bone('chest');
      const head = bone('head'), neck = bone('neck');
      const lUA = bone('leftUpperArm'), rUA = bone('rightUpperArm');
      const lLA = bone('leftLowerArm'), rLA = bone('rightLowerArm');
      const set = (n: THREE.Object3D | null, x: number, y: number, z: number) => { if (n) n.rotation.set(x * flip, y, z * flip); };
      const add = (n: THREE.Object3D | null, x: number, y: number, z: number) => { if (n) { n.rotation.x += x * flip; n.rotation.y += y; n.rotation.z += z * flip; } };
      set(lUA, 0, 0, -1.2 + breathe * 2);
      set(rUA, 0, 0, 1.2 - breathe * 2);
      set(lLA, 0, 0, -0.08);
      set(rLA, 0, 0, 0.08);
      set(chest, breathe, Math.sin(t * 0.7) * 0.03, 0);
      set(spine, 0, 0, 0);
      set(neck, 0, 0, 0);
      set(head, 0, Math.sin(t * 0.5) * 0.04, 0);
      if (hips) hips.position.y = 0;
      root.position.y = 0;
      root.rotation.z = 0;

      // speaking: little head nods with the voice
      add(head, Math.sin(t * 14) * l * 0.08, 0, 0);

      // ---- gestures
      if (gn === 'wave') {
        set(rUA, 0, 0, 1.2 - (1.2 + 1.25) * ease(Math.min(1, b * 2)));
        set(rLA, 0, 0, 0.5 + Math.sin(t * 14) * 0.4 * b);
      } else if (gn === 'nod') {
        add(head, Math.sin(p * Math.PI * 4) * 0.28 * (1 - p), 0, 0);
      } else if (gn === 'shake_head') {
        add(head, 0, Math.sin(p * Math.PI * 4) * 0.4 * (1 - p), 0);
      } else if (gn === 'jump') {
        root.position.y = Math.sin(p * Math.PI) * 0.12;
        set(lUA, 0, 0, -1.2 + b * 0.5);
        set(rUA, 0, 0, 1.2 - b * 0.5);
      } else if (gn === 'punch') {
        const k = Math.sin(p * Math.PI);
        set(rUA, -1.0 * k, 0.6 * k, 1.2 - 0.9 * k);
        set(rLA, 0, 0, 0.1);
        add(spine, 0, -0.3 * k, 0);
      } else if (gn === 'flinch') {
        add(head, -0.25 * b, 0, 0);
        add(spine, -0.15 * b, 0, 0);
        root.position.y = -0.02 * b;
      } else if (gn === 'duck') {
        root.position.y = -0.14 * bell(Math.min(1, p * 1.4));
        add(spine, 0.25 * b, 0, 0);
        add(head, 0.2 * b, 0, 0);
      } else if (gn === 'die_dramatically') {
        const k = ease(Math.min(1, p * 1.6)) * (p < 0.85 ? 1 : 1 - (p - 0.85) / 0.15);
        root.rotation.z = 1.1 * k;
        root.position.y = -0.18 * k;
        add(head, 0, 0, 0.3 * k);
      } else if (gn === 'happy' || gn === 'laugh') {
        root.position.y = Math.abs(Math.sin(t * (gn === 'laugh' ? 12 : 6))) * 0.012 * b;
        add(head, 0, 0, Math.sin(t * 5) * 0.05 * b);
      } else if (gn === 'angry') {
        add(head, 0.08 * b, 0, 0);
      } else if (gn === 'sad') {
        add(head, 0.3 * b, 0, 0);
        add(spine, 0.08 * b, 0, 0);
      } else if (gn === 'surprised') {
        add(spine, -0.1 * b, 0, 0);
        root.position.y = 0.02 * b;
      }

      // ---- face
      if (em) {
        const want: Record<string, number> = {};
        const f = FACE[gn];
        if (f) for (const k in f) want[k] = f[k] * Math.min(1, b * 3);
        for (const k of FACE_KEYS) {
          const cur = face[k] ?? 0, target = want[k] ?? 0;
          face[k] = cur + (target - cur) * Math.min(1, dt * 10);
          em.setValue(k, face[k]);
        }
        // blink
        if (blinkT < 0 && t > nextBlink) { blinkT = 0; }
        let blink = 0;
        if (blinkT >= 0) {
          blinkT += dt;
          blink = Math.sin(Math.min(1, blinkT / 0.16) * Math.PI);
          if (blinkT > 0.16) { blinkT = -1; nextBlink = t + 2 + Math.random() * 3.5; }
        }
        em.setValue('blink', blink);
        // lips follow the loudness of the voice
        const tgtA = Math.min(1, l * 2.6), tgtO = l > 0.05 ? (Math.sin(t * 9) * 0.5 + 0.5) * Math.min(1, l * 2) * 0.6 : 0;
        mouth += (tgtA - mouth) * Math.min(1, dt * 18);
        oh += (tgtO - oh) * Math.min(1, dt * 12);
        em.setValue('aa', mouth * (1 - oh * 0.5));
        em.setValue('oh', Math.max(oh, face.oh ?? 0));
      }

      vrm.update(dt);       // applies the pose, expressions and hair/spring bones
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      if (vrm) VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
      play.current = () => undefined;
    };
  }, []);

  return <canvas ref={canvas} className="block h-full w-full" style={{ width: CHAR_W, height: CHAR_H, background: 'radial-gradient(ellipse at 50% 55%, rgba(167,139,250,.38) 0%, rgba(167,139,250,.14) 55%, rgba(167,139,250,0) 75%)' }} />;
}
