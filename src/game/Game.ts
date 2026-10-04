import * as THREE from 'three';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { createSeededRandom } from '../utils/random';
import { GameAudio } from './audio';
import {
  activeWorm,
  aimToward,
  createMatch,
  drainEvents,
  exitTank,
  muzzle,
  nudgeAim,
  openBattle,
  playerEndTurn,
  previewPoints,
  selectWeapon,
  setTargetX,
  stepMatch,
  togglePause,
  tryFire,
  walkOrDrive,
} from './match';
import { Backdrop } from './backdrop';
import { Effects } from './effects';
import { createToonGradient, loadModels, outlineMaterial, spawnModel, tintAsBackdrop, type ModelLibrary } from './models';
import { createRockTexture, TerrainView } from './scenery';
import { CELL, COLS, findStand, ROWS, WATER_Y, WORLD_W } from './terrain';
import type { Match, WeaponId } from './types';

interface ShotView {
  kind: string;
  group: THREE.Group;
}

interface WormView {
  id: number;
  group: THREE.Group;
  label: HTMLDivElement;
  labelW: number;
  labelH: number;
}

interface LabelSlot {
  view: WormView;
  x: number;
  y: number;
}

const WORM_SCALE = 1.55;
const LABEL_LIFT = 2.05;
const LABEL_GAP = 3;
// Phones are fill-rate bound by the painted terrain shader, so render a bit softer there.
const MAX_DPR = window.matchMedia('(pointer: coarse)').matches ? 1.35 : 1.6;

interface PropView {
  x: number;
  baseY: number;
  group: THREE.Group;
}

interface PropSpec {
  model: 'spear' | 'stalk' | 'drum' | 'crate';
  nx: number;
  scale: number;
  z: number;
  tilt?: number;
  flip?: boolean;
  sink?: number;
}

const PROP_LAYOUTS: PropSpec[][] = [
  [
    { model: 'spear', nx: 0.035, scale: 0.85, z: 0.15, tilt: 0.12 },
    { model: 'stalk', nx: 0.31, scale: 0.8, z: 0.1, flip: true, sink: 0.4 },
    { model: 'spear', nx: 0.36, scale: 0.75, z: 0.2, tilt: -0.18 },
    { model: 'spear', nx: 0.64, scale: 0.8, z: 0.2, tilt: 0.2 },
    { model: 'stalk', nx: 0.67, scale: 0.75, z: 0.1, sink: 0.4 },
    { model: 'spear', nx: 0.97, scale: 0.9, z: 0.15, tilt: -0.1 },
    { model: 'drum', nx: 0.055, scale: 0.85, z: 0.95 },
    { model: 'drum', nx: 0.955, scale: 0.85, z: 0.95 },
    { model: 'crate', nx: 0.7, scale: 0.7, z: 0.95 },
  ],
  [
    { model: 'spear', nx: 0.03, scale: 0.8, z: 0.15, tilt: 0.1 },
    { model: 'stalk', nx: 0.24, scale: 0.75, z: 0.1, flip: true, sink: 0.4 },
    { model: 'spear', nx: 0.38, scale: 0.75, z: 0.2, tilt: -0.15 },
    { model: 'spear', nx: 0.535, scale: 0.85, z: 0.2, tilt: 0.16 },
    { model: 'stalk', nx: 0.68, scale: 0.75, z: 0.1, sink: 0.4 },
    { model: 'spear', nx: 0.975, scale: 0.85, z: 0.15, tilt: -0.12 },
    { model: 'drum', nx: 0.035, scale: 0.85, z: 0.95 },
    { model: 'drum', nx: 0.965, scale: 0.85, z: 0.95 },
  ],
];

const WEAPONS: WeaponId[] = ['bazooka', 'holy', 'donkey', 'heli', 'tank'];

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 80);
  private readonly audio = new GameAudio();
  private readonly loop: Loop;
  private readonly gradient = createToonGradient();
  private readonly labels: HTMLElement;
  private readonly keys = new Set<string>();
  private library: ModelLibrary | null = null;
  private match: Match | null = null;
  private seed = 1;
  private rng = createSeededRandom(1);
  private frame = 0;
  private elapsed = 0;
  private ready: Promise<void>;
  private pausedForScreenshot = false;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private solidVersion = -1;
  private worldKey = '';
  private terrain: TerrainView | null = null;
  private readonly rockTexture = createRockTexture();
  private backdrop: Backdrop | null = null;
  private effects: Effects;
  private readonly labelSlots: LabelSlot[] = [];
  private wreck: THREE.Group | null = null;
  private matchClock = 0;
  private wormViews: WormView[] = [];
  private buildingViews: THREE.Group[] = [];
  private tankView: THREE.Group | null = null;
  private turret: THREE.Object3D | null = null;
  private heliView: THREE.Group | null = null;
  private rotor: THREE.Object3D | null = null;
  private shotViews: ShotView[] = [];
  private props: PropView[] = [];
  private marker: THREE.Mesh;
  private trajectory: THREE.Line;
  private trajectoryPositions = new Float32Array(90 * 3);
  private focus = new THREE.Vector3(WORLD_W / 2, 8, 0);
  private shake = 0;
  private holdDir = 0;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private clock = 0;
  private hudSizeKey = '';
  private hudTopPx = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMappingExposure = 1.12;
    this.labels = this.element('#labels');
    this.marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.55, 4),
      new THREE.MeshBasicMaterial({ color: '#ffe08a' }),
    );
    this.marker.rotation.x = Math.PI;
    this.scene.add(this.marker);
    const trajectoryGeometry = new THREE.BufferGeometry();
    trajectoryGeometry.setAttribute('position', new THREE.BufferAttribute(this.trajectoryPositions, 3));
    this.trajectory = new THREE.Line(
      trajectoryGeometry,
      new THREE.LineBasicMaterial({ color: '#fff6d0', transparent: true, opacity: 0.9 }),
    );
    this.scene.add(this.trajectory);
    this.effects = new Effects(this.scene);
    this.loop = new Loop(
      (delta) => this.update(delta),
      () => this.render(),
    );
    this.installSceneDressing();
    this.installInput();
    this.installTestHooks();
    this.ready = this.boot();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.audio.dispose();
    outlineMaterial.dispose();
    this.gradient.dispose();
    this.terrain?.dispose();
    this.backdrop?.dispose();
    this.effects.dispose();
    this.rockTexture.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private async boot(): Promise<void> {
    this.library = await loadModels(this.gradient);
    this.seed = 1;
    this.rng = createSeededRandom(this.seed);
    this.match = createMatch(0, this.rng, 'menu');
    this.mountWorld();
    this.refreshOverlay();
    const play = this.element('#play-button') as HTMLButtonElement;
    play.disabled = false;
    play.textContent = 'Jogar campanha';
  }

  private update(delta: number): void {
    this.frame += 1;
    const match = this.match;
    if (!match || this.pausedForScreenshot) {
      this.publish();
      return;
    }
    const dt = Math.min(delta, 0.05);
    this.elapsed += dt;
    this.clock += this.reducedMotion ? 0 : dt;
    const size = resizeRenderer(this.renderer, MAX_DPR);
    this.frameCamera(size.width, size.height);

    if (match.phase === 'aim' && match.team === 0) {
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) walkOrDrive(match, -1, dt);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) walkOrDrive(match, 1, dt);
      if (this.holdDir !== 0) walkOrDrive(match, this.holdDir, dt);
      if (this.keys.has('ArrowUp')) nudgeAim(match, 0.85 * dt, 0);
      if (this.keys.has('ArrowDown')) nudgeAim(match, -0.85 * dt, 0);
      if (this.keys.has('KeyW')) nudgeAim(match, 0, 0.45 * dt);
      if (this.keys.has('KeyS')) nudgeAim(match, 0, -0.45 * dt);
    }

    const steps = Math.max(1, Math.round(dt / (1 / 60)));
    const slice = dt / steps;
    for (let i = 0; i < steps; i += 1) stepMatch(match, slice);
    this.playEvents(match);
    this.syncWorld(dt);
    this.updateCamera(dt);
    this.updateHud();
    this.publish();
  }

  private render(): void {
    this.backdrop?.update(this.camera, this.clock, this.renderer.getPixelRatio());
    this.renderer.render(this.scene, this.camera);
  }

  private installSceneDressing(): void {
    this.scene.background = new THREE.Color('#9c1f3c');
    this.scene.add(this.camera);
    this.backdrop = new Backdrop(this.scene, this.camera);
    const hemi = new THREE.HemisphereLight('#ffe9dc', '#5a1e32', 1.45);
    const sun = new THREE.DirectionalLight('#ffe0c0', 1.7);
    sun.position.set(-6, 12, 14);
    const rim = new THREE.DirectionalLight('#ff8a7a', 0.6);
    rim.position.set(8, 4, -6);
    this.scene.add(hemi, sun, rim);
  }

  private mountWorld(): void {
    const match = this.match;
    const library = this.library;
    if (!match || !library) return;
    this.clearActors();
    if (!this.terrain) {
      this.terrain = new TerrainView(this.rockTexture);
      this.scene.add(this.terrain.mesh);
    }
    this.terrain.reset(match.solids);
    this.solidVersion = match.solidVersion;
    this.matchClock = 0;

    for (const worm of match.worms) {
      const group = spawnModel(library.worm);
      group.scale.setScalar(WORM_SCALE);
      const label = document.createElement('div');
      label.className = `tag ${worm.team === 0 ? 'ally' : 'foe'}`;
      this.labels.appendChild(label);
      this.wormViews.push({ id: worm.id, group, label, labelW: 0, labelH: 0 });
      this.scene.add(group);
    }

    for (const building of match.buildings) {
      const source = building.kind === 'bunker' ? library.bunker : library.workshop;
      const group = spawnModel(source);
      const width = building.kind === 'bunker' ? 2.5 : 2.3;
      group.scale.setScalar(building.w / width);
      this.buildingViews.push(group);
      this.scene.add(group);
    }

    this.tankView = spawnModel(library.tank);
    this.tankView.scale.setScalar(1.05);
    this.turret = this.tankView.getObjectByName('Turret') ?? null;
    this.scene.add(this.tankView);

    this.heliView = spawnModel(library.helicopter);
    this.heliView.scale.setScalar(1.15);
    this.rotor = this.heliView.getObjectByName('Rotor') ?? null;
    this.heliView.visible = false;
    this.scene.add(this.heliView);

    const shotSources: Array<[string, THREE.Group, number]> = [
      ['bazooka', library.bazooka, 0.7],
      ['holy', library.holy, 1.3],
      ['donkey', library.donkey, 1.55],
      ['bomb', library.bomb, 1.2],
      ['cannon', library.bazooka, 0.85],
    ];
    for (const [kind, source, scale] of shotSources) {
      const group = spawnModel(source);
      group.scale.setScalar(scale);
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 8, 6),
        new THREE.MeshBasicMaterial({
          color: kind === 'holy' ? '#fff1b0' : '#ffb03a',
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      if (kind === 'bazooka' || kind === 'bomb' || kind === 'cannon') glow.scale.setScalar(4.5);
      group.add(glow);
      group.visible = false;
      this.scene.add(group);
      this.shotViews.push({ kind, group });
    }
    for (let extra = 0; extra < 2; extra += 1) {
      const group = spawnModel(library.bomb);
      group.scale.setScalar(1.2);
      group.visible = false;
      this.scene.add(group);
      this.shotViews.push({ kind: 'bomb', group });
    }

    const layout = PROP_LAYOUTS[match.levelIndex] ?? PROP_LAYOUTS[0];
    for (const spec of layout) {
      const stand = findStand(match.solids, spec.nx);
      const group = spawnModel(library[spec.model]);
      const behind = spec.z < 0.5;
      if (behind) tintAsBackdrop(group, 0.12);
      group.scale.set(spec.flip ? -spec.scale : spec.scale, spec.scale, spec.scale);
      group.rotation.z = spec.tilt ?? 0;
      const baseY = stand.y - (spec.sink ?? (behind ? 0.25 : 0));
      group.position.set(stand.x, baseY, spec.z);
      this.props.push({ x: stand.x, baseY: stand.y, group });
      this.scene.add(group);
    }

    this.wreck = spawnModel(library.airship);
    tintAsBackdrop(this.wreck, 0.1);
    const wreckX = match.levelIndex === 0 ? WORLD_W * 0.5 : WORLD_W * 0.6;
    this.wreck.position.set(wreckX, WATER_Y + (match.levelIndex === 0 ? 1.7 : 1.3), -0.7);
    this.wreck.rotation.set(0.42, -0.18, match.levelIndex === 0 ? -0.34 : 0.28);
    this.wreck.scale.setScalar(match.levelIndex === 0 ? 1.3 : 0.95);
    this.scene.add(this.wreck);
    this.worldKey = `${match.levelIndex}-${this.seed}`;
  }

  private clearActors(): void {
    const drop = (object: THREE.Object3D | null) => {
      if (!object) return;
      this.scene.remove(object);
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || mesh.name === 'outline') return;
        const material = mesh.material as THREE.Material;
        if (material !== outlineMaterial) material.dispose();
      });
    };
    drop(this.wreck);
    this.wreck = null;
    for (const worm of this.wormViews) {
      drop(worm.group);
      worm.label.remove();
    }
    this.wormViews = [];
    for (const building of this.buildingViews) drop(building);
    this.buildingViews = [];
    drop(this.tankView);
    drop(this.heliView);
    for (const shot of this.shotViews) drop(shot.group);
    for (const prop of this.props) drop(prop.group);
    this.tankView = null;
    this.heliView = null;
    this.turret = null;
    this.rotor = null;
    this.shotViews = [];
    this.props = [];
    this.labels.replaceChildren();
    this.effects.clear();
  }

  private syncWorld(dt: number): void {
    const match = this.match;
    if (!match) return;
    if (this.worldKey !== `${match.levelIndex}-${this.seed}`) this.mountWorld();
    if (this.solidVersion !== match.solidVersion && this.terrain) {
      this.terrain.update(match.solids);
      this.solidVersion = match.solidVersion;
    }
    if (match.phase !== 'menu' && match.phase !== 'pause') this.matchClock += dt;

    const active = activeWorm(match);
    this.labelSlots.length = 0;
    for (const view of this.wormViews) {
      const worm = match.worms.find((entry) => entry.id === view.id);
      if (!worm || !worm.alive || worm.inTank) {
        view.group.visible = false;
        view.label.hidden = true;
        continue;
      }
      view.group.visible = true;
      const bob = this.reducedMotion ? 0 : Math.sin(this.clock * 4 + worm.id) * 0.035;
      view.group.position.set(worm.x, worm.y + bob, 0.95);
      view.group.scale.x = worm.face * WORM_SCALE;
      view.group.scale.y = WORM_SCALE;
      const wasHidden = view.label.hidden;
      view.label.hidden = false;
      const hot = worm.id === active?.id;
      const text = `${worm.name}|${Math.max(0, Math.ceil(worm.hp))}|${hot}`;
      if (view.label.dataset.text !== text || wasHidden || view.labelW === 0) {
        view.label.dataset.text = text;
        view.label.classList.toggle('hot', hot);
        view.label.innerHTML = `<b>${worm.name}</b><span>${Math.max(0, Math.ceil(worm.hp))}</span>`;
        view.labelW = view.label.offsetWidth;
        view.labelH = view.label.offsetHeight;
      }
      const screen = this.toScreen(worm.x, worm.y + LABEL_LIFT);
      this.labelSlots.push({ view, x: screen.x, y: screen.y });
    }
    this.layoutLabels();

    match.buildings.forEach((building, index) => {
      const view = this.buildingViews[index];
      if (!view) return;
      view.visible = building.alive;
      view.position.set(building.x, building.y, 0.82);
    });

    if (this.tankView) {
      this.tankView.visible = match.tank.alive;
      this.tankView.position.set(match.tank.x, match.tank.y, 0.88);
      this.tankView.scale.x = match.tank.facing * 1.05;
      if (this.turret) {
        const pitch = Math.atan2(Math.sin(match.tank.angle), Math.abs(Math.cos(match.tank.angle)));
        this.turret.rotation.z = pitch * 0.85;
      }
    }

    if (this.heliView) {
      const flying = match.phase === 'helicopter' && match.heli !== null;
      this.heliView.visible = flying;
      if (flying && match.heli) {
        this.heliView.position.set(match.heli.x, 15.4, 1.1);
        this.heliView.scale.x = match.heli.targetX >= match.heli.x ? 1.15 : -1.15;
        if (this.rotor && !this.reducedMotion) this.rotor.rotation.y += dt * 28;
      }
    }

    const used = new Set<ShotView>();
    for (const projectile of match.projectiles) {
      const view = this.shotViews.find((shot) => shot.kind === projectile.kind && !used.has(shot));
      if (!view) continue;
      used.add(view);
      view.group.visible = true;
      view.group.position.set(projectile.x, projectile.y, 1.15);
      view.group.rotation.z = Math.atan2(projectile.vy, projectile.vx);
    }
    for (const view of this.shotViews) {
      if (!used.has(view)) view.group.visible = false;
    }

    for (const prop of this.props) {
      if (!prop.group.visible) continue;
      const col = Math.max(0, Math.min(COLS - 1, Math.floor(prop.x / CELL)));
      let surface = -1;
      for (let row = ROWS - 1; row >= 0; row -= 1) {
        if (match.solids[row * COLS + col] === 1) {
          surface = (row + 1) * CELL;
          break;
        }
      }
      if (surface < prop.baseY - 0.35) prop.group.visible = false;
    }

    const points = previewPoints(match);
    const attribute = this.trajectory.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < points.length && i < 90; i += 1) {
      this.trajectoryPositions[i * 3] = points[i].x;
      this.trajectoryPositions[i * 3 + 1] = points[i].y;
      this.trajectoryPositions[i * 3 + 2] = 1.2;
    }
    attribute.needsUpdate = true;
    this.trajectory.geometry.setDrawRange(0, points.length);
    this.trajectory.visible = points.length > 1;

    const marking = match.phase === 'aim' && (match.weapon === 'heli' || match.weapon === 'donkey');
    this.marker.visible = marking;
    if (marking) {
      const col = Math.max(0, Math.min(COLS - 1, Math.floor(match.targetX / CELL)));
      let y = WATER_Y + 1;
      for (let row = ROWS - 1; row >= 0; row -= 1) {
        if (match.solids[row * COLS + col] === 1) {
          y = (row + 1) * CELL + 1.3;
          break;
        }
      }
      this.marker.position.set(match.targetX, y, 1.25);
      if (!this.reducedMotion) this.marker.position.y += Math.sin(this.clock * 5) * 0.08;
    }

    this.effects.update(dt);
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    const vector = new THREE.Vector3(x, y, 0).project(this.camera);
    return {
      x: (vector.x * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (-vector.y * 0.5 + 0.5) * this.canvas.clientHeight,
    };
  }

  /**
   * Labels are anchored bottom-centre above each worm. Walking from the lowest
   * anchor up, any label that overlaps one already placed is lifted above it, so
   * neighbours stack into a readable column instead of overprinting.
   */
  private layoutLabels(): void {
    const slots = this.labelSlots.sort((a, b) => b.y - a.y || a.x - b.x);
    const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    for (const slot of slots) {
      const half = slot.view.labelW / 2;
      const height = slot.view.labelH;
      let bottom = slot.y;
      for (let pass = 0; pass < placed.length; pass += 1) {
        let moved = false;
        for (const box of placed) {
          const overlapX = slot.x - half < box.right + LABEL_GAP && slot.x + half > box.left - LABEL_GAP;
          const overlapY = bottom - height < box.bottom && bottom > box.top - LABEL_GAP;
          if (overlapX && overlapY) {
            bottom = box.top - LABEL_GAP;
            moved = true;
          }
        }
        if (!moved) break;
      }
      placed.push({ left: slot.x - half, right: slot.x + half, top: bottom - height, bottom });
      slot.view.label.style.left = `${slot.x}px`;
      slot.view.label.style.top = `${bottom}px`;
    }
  }

  private updateCamera(dt: number): void {
    const match = this.match;
    if (!match) return;
    const viewW = this.camera.right - this.camera.left;
    const worm = activeWorm(match);
    let x = WORLD_W / 2;
    let y = 9.2;
    const shot = match.projectiles[0];
    if (viewW < WORLD_W - 1) {
      x = worm?.x ?? x;
      y = (worm?.y ?? 8) + 2.4;
      if ((match.phase === 'fly' || match.phase === 'helicopter') && shot) {
        x = shot.x;
        y = shot.y;
      } else if (match.phase === 'helicopter' && match.heli) {
        x = match.heli.x;
        y = 12;
      }
    } else {
      if (shot && (match.phase === 'fly' || match.phase === 'helicopter')) y = Math.max(9.2, shot.y - 2);
      // Lift the full-map view just enough for the highest worm's label to clear the top HUD row.
      const viewH = this.camera.top - this.camera.bottom;
      const unitsPerPx = viewH / Math.max(1, this.canvas.clientHeight);
      let highest = -Infinity;
      for (const view of this.wormViews) {
        if (view.label.hidden) continue;
        const worm = match.worms.find((entry) => entry.id === view.id);
        if (worm) highest = Math.max(highest, worm.y + LABEL_LIFT + (view.labelH + 6) * unitsPerPx);
      }
      if (highest > -Infinity) y = Math.max(y, highest + this.hudTopPx * unitsPerPx - viewH / 2 + 0.35);
    }
    y = Math.max(y, 8);
    const follow = this.reducedMotion ? 1 : 1 - Math.exp(-3.5 * dt);
    this.focus.x += (x - this.focus.x) * follow;
    this.focus.y += (y - this.focus.y) * follow;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const jx = this.reducedMotion ? 0 : Math.sin(this.clock * 48) * this.shake * 0.18;
    const jy = this.reducedMotion ? 0 : Math.cos(this.clock * 37) * this.shake * 0.12;
    this.camera.position.set(this.focus.x + jx, this.focus.y + jy + 1.4, 24);
    this.camera.lookAt(this.focus.x + jx, this.focus.y + jy - 0.35, 0);
  }

  private frameCamera(width: number, height: number): void {
    const sizeKey = `${width}x${height}`;
    if (sizeKey !== this.hudSizeKey) {
      this.hudSizeKey = sizeKey;
      const bars = ['#weapons', '.hud-side'].map((selector) => this.element(selector).getBoundingClientRect().bottom);
      this.hudTopPx = Math.max(0, ...bars);
    }
    const aspect = width / Math.max(1, height);
    let viewH = (WORLD_W + 3) / aspect;
    if (aspect < 1.15) viewH = 18;
    if (viewH < 15) viewH = 15;
    this.camera.left = (-viewH * aspect) / 2;
    this.camera.right = (viewH * aspect) / 2;
    this.camera.top = viewH / 2;
    this.camera.bottom = -viewH / 2;
    this.camera.updateProjectionMatrix();
  }

  private playEvents(match: Match): void {
    for (const event of drainEvents(match)) {
      if (event.type === 'fire') this.audio.play(event.kind === 'donkey' ? 'donkey' : 'fire');
      if (event.type === 'explode') {
        this.audio.play(event.kind === 'holy' ? 'holy' : event.kind === 'donkey' ? 'donkey' : 'explode');
        this.shake = event.kind === 'holy' || event.kind === 'donkey' ? 1 : 0.65;
        this.effects.explode(event.x ?? 0, event.y ?? 0, event.r ?? 1.5, event.kind ?? 'bazooka', this.reducedMotion);
      }
      if (event.type === 'splash') this.audio.play('splash');
      if (event.type === 'hurt') this.audio.play('hurt');
      if (event.type === 'win') this.audio.play('win');
      if (event.type === 'lose') this.audio.play('lose');
      if (event.type === 'rotor') this.audio.startRotor();
    }
    if (match.phase !== 'helicopter') this.audio.stopRotor();
    if (match.phase === 'levelclear' || match.phase === 'victory' || match.phase === 'defeat' || match.phase === 'pause' || match.phase === 'menu') {
      this.refreshOverlay();
    } else {
      this.element('#overlay').hidden = true;
    }
  }

  private updateHud(): void {
    const match = this.match;
    if (!match) return;
    const timer = this.element('#timer-value');
    timer.textContent = String(Math.max(0, Math.ceil(match.timer))).padStart(2, '0');
    timer.classList.toggle('danger', match.timer <= 5 && match.phase === 'aim');
    this.element('#level-label').textContent = `Nível ${match.levelIndex + 1} · ${match.levelName}`;
    const wind = match.wind;
    this.element('#wind-arrow').style.transform = `scaleX(${wind >= 0 ? 1 : -1})`;
    this.element('#wind-value').textContent = Math.abs(wind).toFixed(2);
    const windShare = Math.min(1, Math.abs(wind) / Math.max(0.01, match.windMax)) * 50;
    const windFill = this.element('#wind-fill');
    windFill.style.width = `${windShare}%`;
    windFill.style.left = wind >= 0 ? '50%' : `${50 - windShare}%`;
    const clock = Math.floor(this.matchClock);
    this.element('#match-clock').textContent = `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, '0')}`;
    const playerHp = this.teamHp(match, 0);
    const enemyHp = this.teamHp(match, 1);
    const playerMax = match.wormsPerTeam * 100;
    (this.element('#player-fill') as HTMLElement).style.width = `${(playerHp / playerMax) * 100}%`;
    (this.element('#enemy-fill') as HTMLElement).style.width = `${(enemyHp / playerMax) * 100}%`;
    this.element('#player-hp').textContent = String(playerHp);
    this.element('#enemy-hp').textContent = String(enemyHp);
    this.element('#banner').textContent = match.bannerTime > 0 ? match.banner : '';
    this.element('#banner').hidden = match.bannerTime <= 0;
    const power = this.element('#power-fill') as HTMLElement;
    power.style.width = `${match.aimPower * 100}%`;
    const steps = this.element('#steps-fill') as HTMLElement;
    steps.style.width = `${(match.walkLeft / 4.2) * 100}%`;
    const aimingAir = match.weapon === 'heli' || match.weapon === 'donkey';
    this.element('#power-wrap').hidden = aimingAir || match.phase !== 'aim';
    for (const weapon of WEAPONS) {
      const button = this.element(`#weapon-${weapon}`) as HTMLButtonElement;
      button.setAttribute('aria-pressed', String(match.weapon === weapon));
      const ammo = weapon === 'holy' ? match.ammo[0].holy : weapon === 'donkey' ? match.ammo[0].donkey : weapon === 'heli' ? match.ammo[0].heli : null;
      const badge = button.querySelector('small');
      if (badge) badge.textContent = ammo === null ? '' : `×${ammo}`;
      if (weapon === 'holy' || weapon === 'donkey' || weapon === 'heli') button.disabled = (ammo ?? 0) <= 0;
    }
    const fire = this.element('#fire-button');
    fire.textContent = aimingAir ? 'Lançar' : match.weapon === 'tank' && match.occupiedBy === null ? 'Entrar' : 'Fogo';
    this.element('#exit-button').hidden = match.occupiedBy === null || match.team !== 0;
    const playerTurn = match.phase === 'aim' && match.team === 0;
    this.element('#controls').classList.toggle('locked', !playerTurn);
  }

  private teamHp(match: Match, team: number): number {
    return Math.round(match.worms.filter((worm) => worm.team === team && worm.alive).reduce((sum, worm) => sum + worm.hp, 0));
  }

  private refreshOverlay(): void {
    const match = this.match;
    const overlay = this.element('#overlay');
    if (!match) return;
    const show = match.phase === 'menu' || match.phase === 'pause' || match.phase === 'levelclear' || match.phase === 'victory' || match.phase === 'defeat';
    overlay.hidden = !show;
    if (!show) return;
    const title = this.element('#overlay-title');
    const copy = this.element('#overlay-copy');
    const primary = this.element('#play-button');
    const secondary = this.element('#secondary-button') as HTMLButtonElement;
    secondary.hidden = true;
    if (match.phase === 'menu') {
      title.textContent = 'Minhocas: Caos Tático';
      copy.textContent = 'Demo de campanha em duas batalhas. Gire o celular para a horizontal, escolha uma arma e arraste para mirar.';
      primary.textContent = 'Jogar campanha';
    } else if (match.phase === 'pause') {
      title.textContent = 'Pausa';
      copy.textContent = match.blurb;
      primary.textContent = 'Continuar';
    } else if (match.phase === 'levelclear') {
      title.textContent = 'Posto conquistado';
      copy.textContent = 'O próximo campo é mais alto, o vento é mais forte e o inimigo atira de volta com tudo.';
      primary.textContent = 'Nível 2';
    } else if (match.phase === 'victory') {
      title.textContent = 'Campanha vencida';
      copy.textContent = 'As duas posições caíram. O campo ficou cheio de buracos e o time inimigo também.';
      primary.textContent = 'Jogar de novo';
    } else {
      title.textContent = 'Time eliminado';
      copy.textContent = 'A água, o vento ou o barracão levaram a melhor. O nível recomeça do mesmo mapa.';
      primary.textContent = 'Tentar de novo';
    }
  }

  private onPrimary(): void {
    const match = this.match;
    if (!match || !this.library) return;
    this.audio.unlock();
    this.audio.play('click');
    if (match.phase === 'menu') {
      openBattle(match);
      this.element('#overlay').hidden = true;
      return;
    }
    if (match.phase === 'pause') {
      togglePause(match);
      this.element('#overlay').hidden = true;
      return;
    }
    if (match.phase === 'levelclear') {
      this.startLevel(1);
      return;
    }
    if (match.phase === 'victory') {
      this.seed = (this.seed + 1) >>> 0;
      this.startLevel(0);
      return;
    }
    if (match.phase === 'defeat') this.startLevel(match.levelIndex);
  }

  private startLevel(index: number): void {
    this.rng = createSeededRandom((this.seed + index * 997) >>> 0);
    this.match = createMatch(index, this.rng, 'aim');
    openBattle(this.match);
    this.match.bannerTime = 1.4;
    this.mountWorld();
    this.focus.set(WORLD_W / 2, 9, 0);
    this.element('#overlay').hidden = true;
  }

  private installInput(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    window.addEventListener('pointerup', (event) => this.onPointerUp(event));
    window.addEventListener('pointercancel', () => {
      this.drag = null;
      this.holdDir = 0;
    });
    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code);
      this.onKey(event);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.holdDir = 0;
    });

    for (const weapon of WEAPONS) {
      this.element(`#weapon-${weapon}`).addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        event.preventDefault();
        const match = this.match;
        if (!match) return;
        this.audio.unlock();
        if (selectWeapon(match, weapon)) this.audio.play('click');
      });
    }
    this.holdButton('#left-button', -1);
    this.holdButton('#right-button', 1);
    this.element('#fire-button').addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      event.preventDefault();
      this.audio.unlock();
      if (this.match?.phase === 'aim' && this.match.team === 0) tryFire(this.match);
    });
    this.element('#pass-button').addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (this.match) playerEndTurn(this.match);
    });
    this.element('#exit-button').addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (this.match) exitTank(this.match);
    });
    this.element('#pause-button').addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (!this.match) return;
      togglePause(this.match);
      this.refreshOverlay();
    });
    this.element('#mute-button').addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      event.preventDefault();
      const muted = this.audio.toggleMute();
      this.element('#mute-button').textContent = muted ? 'Som off' : 'Som';
    });
    this.element('#play-button').addEventListener('click', () => this.onPrimary());
  }

  private holdButton(selector: string, dir: number): void {
    const button = this.element(selector);
    const start = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
      this.holdDir = dir;
    };
    const stop = () => {
      if (this.holdDir === dir) this.holdDir = 0;
    };
    button.addEventListener('pointerdown', start);
    button.addEventListener('pointerup', stop);
    button.addEventListener('pointercancel', stop);
    button.addEventListener('pointerleave', stop);
  }

  private onKey(event: KeyboardEvent): void {
    const match = this.match;
    if (!match || event.repeat) return;
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    if (event.code === 'Space' && match.phase === 'aim' && match.team === 0) {
      this.audio.unlock();
      tryFire(match);
    }
    if (event.code === 'Enter') playerEndTurn(match);
    if (event.code === 'Escape') {
      togglePause(match);
      this.refreshOverlay();
    }
    if (event.code === 'KeyE' && match.team === 0) exitTank(match);
    const weaponIndex = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(event.code);
    if (weaponIndex >= 0) selectWeapon(match, WEAPONS[weaponIndex]);
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.match || this.match.phase !== 'aim' || this.match.team !== 0) return;
    if ((event.target as HTMLElement).closest('#hud, #controls, #overlay')) return;
    this.audio.unlock();
    this.drag = { x: event.clientX, y: event.clientY, moved: false };
    this.pointAim(event, false);
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.drag || !this.match) return;
    if (Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) > 12) this.drag.moved = true;
    this.pointAim(event, true);
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.drag || !this.match) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (!moved || this.match.phase !== 'aim' || this.match.team !== 0) return;
    if (this.match.team !== 0 || this.match.weapon === 'heli' || this.match.weapon === 'donkey') return;
    this.pointAim(event, true);
    tryFire(this.match);
  }

  private pointAim(event: PointerEvent, fromDrag: boolean): void {
    const match = this.match;
    if (!match) return;
    const world = this.pointerWorld(event.clientX, event.clientY);
    if (match.weapon === 'heli' || match.weapon === 'donkey') {
      setTargetX(match, world.x);
      return;
    }
    const origin = muzzle(match);
    const distance = Math.hypot(event.clientX - (this.drag?.x ?? event.clientX), event.clientY - (this.drag?.y ?? event.clientY));
    const power = fromDrag ? 0.2 + Math.min(1, distance / 180) * 0.8 : null;
    if (Math.hypot(world.x - origin.x, world.y - origin.y) > 0.2) aimToward(match, world.x, world.y, power);
  }

  private pointerWorld(clientX: number, clientY: number): THREE.Vector3 {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    return new THREE.Vector3(ndcX, ndcY, 0).unproject(this.camera);
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.seed = value >>> 0 || 1;
      },
      setState: async (name: string) => {
        await this.ready;
        const known = ['menu', 'active-play', 'projectile', 'level-2', 'victory', 'defeat', 'complete'];
        if (!known.includes(name)) throw new Error(`Unknown test state: ${name}`);
        this.rng = createSeededRandom((this.seed + (name === 'level-2' || name === 'victory' || name === 'complete' ? 997 : 0)) >>> 0);
        const level = name === 'level-2' || name === 'victory' || name === 'complete' ? 1 : 0;
        const phase = name === 'menu' ? 'menu' : 'aim';
        this.match = createMatch(level, this.rng, phase);
        if (name === 'active-play' || name === 'level-2' || name === 'projectile') {
          openBattle(this.match);
          this.match.bannerTime = 0;
        }
        if (name === 'projectile') {
          this.match.phase = 'fly';
          this.match.projectiles.push({
            kind: 'bazooka',
            x: WORLD_W * 0.48,
            y: 12,
            vx: 3.2,
            vy: 1.4,
            fuse: 4,
            blast: 1.7,
            damage: 40,
            team: 0,
            bounce: false,
            radius: 0.14,
            age: 0.4,
          });
        }
        if (name === 'victory' || name === 'complete') {
          for (const worm of this.match.worms) {
            if (worm.team === 1) {
              worm.alive = false;
              worm.hp = 0;
            }
          }
          this.match.killed = this.match.wormsPerTeam;
          this.match.phase = 'victory';
          this.match.banner = 'Campanha vencida';
          this.match.bannerTime = 0;
        }
        if (name === 'defeat') {
          for (const worm of this.match.worms) {
            if (worm.team === 0) {
              worm.alive = false;
              worm.hp = 0;
            }
          }
          this.match.phase = 'defeat';
          this.match.bannerTime = 0;
        }
        this.mountWorld();
        this.refreshOverlay();
        this.syncWorld(0);
        this.updateHud();
        this.render();
        this.publish();
        return { state: name === 'complete' ? 'complete' : name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
        this.render();
      },
      hideDebugUi: () => undefined,
    };
  }

  private publish(): void {
    const match = this.match;
    const worm = match ? activeWorm(match) : null;
    const info = this.renderer.info;
    const size = this.canvas.getBoundingClientRect();
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: match?.killed ?? 0,
      targetScore: match?.wormsPerTeam ?? 0,
      complete: match?.phase === 'victory',
      phase: match?.phase ?? 'boot',
      level: match?.levelIndex ?? 0,
      aim: match?.aimAngle ?? 0,
      weapon: match?.weapon ?? 'bazooka',
      player: {
        position: { x: worm?.x ?? 0, y: worm?.y ?? 0, z: 0 },
        speed: worm ? Math.hypot(worm.vx, worm.vy) : 0,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: size.width,
        clientHeight: size.height,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: this.renderer.getPixelRatio(),
      },
    };
  }

  private element(selector: string): HTMLElement {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`Elemento ausente: ${selector}`);
    return node;
  }
}
