import * as THREE from "three";
import { Simulation, createRng } from "@tilt/engine";
import { LANE_END_X, LANE_START_X, SRC_X, laneYFrac, srcYFrac } from "../lib/layout";

export interface HeroStats {
  visitors: number;
  /** Expected conversions lost versus always showing the best variant. [fixed, tilt] */
  lost: [number, number];
  conversions: [number, number];
  share: [number[], number[]];
  seed: number;
  finished: boolean;
}

const BASE_RATES = [0.03, 0.045, 0.075];
export const TARGET_VISITORS = 4000;
/** First run is a typical one (regret cut 83.5%, the median of 200 seeds). Later runs are plain draws. */
export const FIRST_SEED = 37;
const POOL = 560; // particle slots per strip
const SPAWN_PER_SEC = 240;
const FLIGHT = 1.05; // seconds from source to lane end
const LAND = 0.7; // seconds of landing flash
const LOOP_PAUSE = 4.5;

const INK = new THREE.Color("#16130f");
const GRAPHITE = new THREE.Color("#8a8679");
const VERMILION = new THREE.Color("#e5421a");

const VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aSize;
  uniform float uPx;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    gl_PointSize = aSize * uPx;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.36, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Pool {
  born: Float32Array;
  lane: Uint8Array;
  conv: Uint8Array;
  jit: Float32Array;
  alive: Uint8Array;
  head: number;
}

const makePool = (): Pool => ({
  born: new Float32Array(POOL),
  lane: new Uint8Array(POOL),
  conv: new Uint8Array(POOL),
  jit: new Float32Array(POOL),
  alive: new Uint8Array(POOL),
  head: 0,
});

export class HeroScene {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
  private scene = new THREE.Scene();
  private points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private alpha: Float32Array;
  private size: Float32Array;
  private uniforms = { uPx: { value: 1 } };
  private bands: THREE.Mesh[][] = [[], []];
  private rails: THREE.Mesh[][] = [[], []];
  private thick: number[][] = [
    [6, 6, 6],
    [6, 6, 6],
  ];
  private pools: [Pool, Pool] = [makePool(), makePool()];
  private sims!: [Simulation, Simulation];
  private rng = createRng(1);
  private seed: number;
  private W = 1;
  private H = 1;
  private raf = 0;
  private last = 0;
  private now = 0;
  private spawnAcc = 0;
  private emitAt = 0;
  private doneAt = -1;
  private active = false;
  private disposed = false;
  private ro: ResizeObserver;

  constructor(
    private canvas: HTMLCanvasElement,
    private container: HTMLElement,
    private onStats: (s: HeroStats) => void,
    private reduced: boolean,
    seed = FIRST_SEED,
  ) {
    this.seed = seed;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);

    const total = POOL * 2;
    this.pos = new Float32Array(total * 3);
    this.col = new Float32Array(total * 3);
    this.alpha = new Float32Array(total);
    this.size = new Float32Array(total);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      premultipliedAlpha: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;

    const unit = new THREE.PlaneGeometry(1, 1);
    for (let s = 0; s < 2; s++) {
      for (let l = 0; l < 3; l++) {
        const band = new THREE.Mesh(
          unit,
          new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.075, depthTest: false }),
        );
        const rail = new THREE.Mesh(
          unit,
          new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.32, depthTest: false }),
        );
        band.renderOrder = 1;
        rail.renderOrder = 2;
        this.bands[s]![l] = band;
        this.rails[s]![l] = rail;
        this.scene.add(band, rail);
      }
      const node = new THREE.Mesh(
        new THREE.CircleGeometry(5, 28),
        new THREE.MeshBasicMaterial({ color: INK, depthTest: false }),
      );
      node.userData.strip = s;
      node.renderOrder = 3;
      this.scene.add(node);
    }
    this.scene.add(this.points);

    this.reset(seed);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();

    if (reduced) this.renderStatic();
  }

  /** Start a fresh world. The seed also decides which variant is secretly best. */
  reset(seed: number) {
    this.seed = seed;
    const r = createRng(seed * 7919 + 13);
    const rates = [...BASE_RATES];
    for (let i = rates.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [rates[i], rates[j]] = [rates[j]!, rates[i]!];
    }
    this.sims = [
      new Simulation({ trueRates: rates, policy: "uniform", seed }),
      new Simulation({ trueRates: rates, policy: "thompson", seed }),
    ];
    this.rng = createRng(seed + 101);
    this.pools = [makePool(), makePool()];
    this.alpha.fill(0);
    this.thick = [
      [6, 6, 6],
      [6, 6, 6],
    ];
    this.spawnAcc = 0;
    this.doneAt = -1;
    this.now = 0;
    this.last = 0;
    this.emitAt = 0;
    this.emit(false);
    if (this.reduced) this.renderStatic();
  }

  replay() {
    this.reset(this.seed + 1);
  }

  setActive(on: boolean) {
    if (this.disposed || this.reduced) return;
    if (on && !this.active) {
      this.active = true;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } else if (!on && this.active) {
      this.active = false;
      cancelAnimationFrame(this.raf);
    }
  }

  dispose() {
    this.disposed = true;
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.renderer.dispose();
    this.points.geometry.dispose();
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    this.W = Math.max(1, rect.width);
    this.H = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.W, this.H, false);
    this.uniforms.uPx.value = dpr;
    this.camera.left = 0;
    this.camera.right = this.W;
    this.camera.top = this.H;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
    this.layoutStatic();
    if (this.reduced) this.draw();
    else this.renderer.render(this.scene, this.camera);
  }

  private yPx(fracFromTop: number) {
    return this.H * (1 - fracFromTop);
  }

  /** Rails, source nodes: things that depend only on size. */
  private layoutStatic() {
    const x0 = this.W * LANE_START_X;
    const x1 = this.W * LANE_END_X;
    for (let s = 0; s < 2; s++) {
      for (let l = 0; l < 3; l++) {
        const rail = this.rails[s]![l]!;
        rail.scale.set(x1 - x0, 1, 1);
        rail.position.set((x0 + x1) / 2, this.yPx(laneYFrac(s, l)), 0);
      }
    }
    for (const child of this.scene.children) {
      if (child.userData.strip !== undefined) {
        child.position.set(this.W * SRC_X, this.yPx(srcYFrac(child.userData.strip as number)), 0);
      }
    }
  }

  private frame = (t: number) => {
    if (!this.active || this.disposed) return;
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.now += dt;
    this.step(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private spawn(strip: number, arm: number, converted: boolean) {
    const p = this.pools[strip]!;
    const i = p.head++ % POOL;
    p.born[i] = this.now;
    p.lane[i] = arm;
    p.conv[i] = converted ? 1 : 0;
    p.jit[i] = this.rng() * 2 - 1;
    p.alive[i] = 1;
  }

  private step(dt: number) {
    const [fixed, tilt] = this.sims;
    if (fixed.n < TARGET_VISITORS) {
      this.spawnAcc += dt * SPAWN_PER_SEC;
      while (this.spawnAcc >= 1 && fixed.n < TARGET_VISITORS) {
        this.spawnAcc -= 1;
        const a = fixed.step();
        const b = tilt.step();
        this.spawn(0, a.arm, a.converted);
        this.spawn(1, b.arm, b.converted);
      }
    } else if (this.doneAt < 0) {
      this.doneAt = this.now;
    } else if (this.now - this.doneAt > LOOP_PAUSE) {
      this.reset(this.seed + 1);
    }
    if (this.now >= this.emitAt) {
      this.emitAt = this.now + 0.12;
      this.emit(this.doneAt >= 0);
    }
  }

  private draw() {
    const x0 = this.W * LANE_START_X;
    const x1 = this.W * LANE_END_X;
    const xs = this.W * SRC_X;

    // Lanes widen with the traffic they carry.
    for (let s = 0; s < 2; s++) {
      const share = this.sims[s]!.share();
      for (let l = 0; l < 3; l++) {
        const target = 5 + share[l]! * 66;
        const cur = this.thick[s]![l]!;
        const next = cur + (target - cur) * 0.07;
        this.thick[s]![l] = next;
        const band = this.bands[s]![l]!;
        band.scale.set(x1 - x0, next, 1);
        band.position.set((x0 + x1) / 2, this.yPx(laneYFrac(s, l)), 0);
      }
    }

    // Particles.
    for (let s = 0; s < 2; s++) {
      const p = this.pools[s]!;
      const ys = this.yPx(srcYFrac(s));
      for (let i = 0; i < POOL; i++) {
        const k = s * POOL + i;
        if (!p.alive[i]) {
          this.alpha[k] = 0;
          continue;
        }
        const age = this.now - p.born[i]!;
        const lane = p.lane[i]!;
        const band = this.thick[s]![lane]!;
        const yl = this.yPx(laneYFrac(s, lane)) + p.jit[i]! * band * 0.42;
        let x: number, y: number, a: number, sz: number;
        let c = INK;
        if (age < FLIGHT) {
          const t = age / FLIGHT;
          x = xs + (x1 - xs) * t;
          y = ys + (yl - ys) * smooth(0, 0.42, t);
          a = Math.min(1, t * 7) * 0.9;
          sz = 3.8;
        } else {
          const u = (age - FLIGHT) / LAND;
          if (u >= 1) {
            p.alive[i] = 0;
            this.alpha[k] = 0;
            continue;
          }
          x = x1 + (p.conv[i] ? u * 14 : 0);
          y = yl;
          if (p.conv[i]) {
            c = VERMILION;
            a = 1 - u * u;
            sz = 8.5 - u * 3;
          } else {
            c = GRAPHITE;
            a = 0.55 * (1 - u);
            sz = 3.8 * (1 - u * 0.5);
          }
        }
        this.pos[k * 3] = x;
        this.pos[k * 3 + 1] = y;
        this.pos[k * 3 + 2] = 0;
        this.col[k * 3] = c.r;
        this.col[k * 3 + 1] = c.g;
        this.col[k * 3 + 2] = c.b;
        this.alpha[k] = a;
        this.size[k] = sz;
      }
    }
    const g = this.points.geometry;
    for (const name of ["position", "aColor", "aAlpha", "aSize"]) {
      (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Reduced-motion: jump to the end state and draw it once. */
  private renderStatic() {
    const [fixed, tilt] = this.sims;
    while (fixed.n < 3000) {
      fixed.step();
      tilt.step();
    }
    for (let s = 0; s < 2; s++) {
      const share = this.sims[s]!.share();
      for (let l = 0; l < 3; l++) this.thick[s]![l] = 5 + share[l]! * 66;
    }
    this.alpha.fill(0);
    this.draw();
    this.emit(true);
  }

  private emit(finished: boolean) {
    const [fixed, tilt] = this.sims;
    this.onStats({
      visitors: fixed.n,
      lost: [fixed.regret, tilt.regret],
      conversions: [fixed.reward, tilt.reward],
      share: [fixed.share(), tilt.share()],
      seed: this.seed,
      finished,
    });
  }
}
