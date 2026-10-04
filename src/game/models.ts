import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** Nodes animated at runtime; their meshes are merged separately so they keep moving. */
const ANIMATED_NODES = new Set(['Rotor', 'Turret']);

export interface ModelLibrary {
  worm: THREE.Group;
  bazooka: THREE.Group;
  holy: THREE.Group;
  donkey: THREE.Group;
  helicopter: THREE.Group;
  tank: THREE.Group;
  bunker: THREE.Group;
  workshop: THREE.Group;
  cactus: THREE.Group;
  crate: THREE.Group;
  bomb: THREE.Group;
  spear: THREE.Group;
  stalk: THREE.Group;
  airship: THREE.Group;
  drum: THREE.Group;
}

const FILES: Record<keyof ModelLibrary, string> = {
  worm: 'worm.glb',
  bazooka: 'bazooka.glb',
  holy: 'holy-grenade.glb',
  donkey: 'donkey.glb',
  helicopter: 'helicopter.glb',
  tank: 'tank.glb',
  bunker: 'bunker.glb',
  workshop: 'workshop.glb',
  cactus: 'cactus.glb',
  crate: 'crate.glb',
  bomb: 'bomb.glb',
  spear: 'spear.glb',
  stalk: 'stalk.glb',
  airship: 'airship.glb',
  drum: 'oil-drum.glb',
};

export function createToonGradient(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 3;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível');
  const image = context.createImageData(3, 1);
  const bands = [120, 200, 255];
  for (let i = 0; i < 3; i += 1) {
    image.data[i * 4] = bands[i];
    image.data[i * 4 + 1] = bands[i];
    image.data[i * 4 + 2] = bands[i];
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

// Inverted hull pushed along smoothed normals in view space, so the ink line keeps
// a constant width regardless of model scale or mirroring.
export const outlineMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color('#1e0f12') },
    uThickness: { value: 0.055 },
  },
  vertexShader: /* glsl */ `
    uniform float uThickness;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vec3 n = normalize(normalMatrix * normal);
      mv.xyz += n * uThickness;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    void main() {
      gl_FragColor = vec4(uColor, 1.0);
      #include <colorspace_fragment>
    }
  `,
  side: THREE.BackSide,
});

const hullCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function hullGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = hullCache.get(source);
  if (cached) return cached;
  const stripped = new THREE.BufferGeometry();
  stripped.setAttribute('position', source.getAttribute('position'));
  if (source.index) stripped.setIndex(source.index);
  const merged = mergeVertices(stripped, 1e-4);
  merged.computeVertexNormals();
  hullCache.set(source, merged);
  return merged;
}

export async function loadModels(gradient: THREE.Texture): Promise<ModelLibrary> {
  const loader = new GLTFLoader();
  const library = {} as ModelLibrary;
  await Promise.all(
    (Object.keys(FILES) as Array<keyof ModelLibrary>).map(async (key) => {
      const url = `${import.meta.env.BASE_URL}models/${FILES[key]}`;
      try {
        const gltf = await loader.loadAsync(url);
        collapse(gltf.scene);
        stylize(gltf.scene, gradient);
        library[key] = gltf.scene;
      } catch (error) {
        console.warn(`Modelo ausente (${key}), usando forma reserva.`, error);
        library[key] = fallback(key);
        stylize(library[key], gradient);
      }
    }),
  );
  return library;
}

export function spawnModel(source: THREE.Group, outline = true): THREE.Group {
  const clone = source.clone(true);
  const meshes: THREE.Mesh[] = [];
  clone.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  for (const mesh of meshes) {
    mesh.material = (mesh.material as THREE.MeshToonMaterial).clone();
    if (!outline) continue;
    const shell = new THREE.Mesh(hullGeometry(mesh.geometry), outlineMaterial);
    shell.name = 'outline';
    mesh.add(shell);
  }
  return clone;
}

/** Darkens and warms a spawned model so it reads as background decoration. */
export function tintAsBackdrop(root: THREE.Object3D, amount: number): void {
  const haze = new THREE.Color('#8a2340');
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh.name === 'outline') return;
    const material = mesh.material as THREE.MeshToonMaterial;
    material.color.lerp(haze, amount);
  });
}

/**
 * Bakes every material colour into vertex colours and merges each rigid part of a
 * model into one mesh, so a model costs one draw call plus one outline instead of
 * two per material.
 */
function collapse(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const parts = new Map<THREE.Object3D, THREE.Mesh[]>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    let owner: THREE.Object3D = root;
    for (let node: THREE.Object3D | null = mesh.parent; node && node !== root; node = node.parent) {
      if (ANIMATED_NODES.has(node.name)) {
        owner = node;
        break;
      }
    }
    const list = parts.get(owner) ?? [];
    list.push(mesh);
    parts.set(owner, list);
  });

  for (const [owner, meshes] of parts) {
    const toLocal = owner.matrixWorld.clone().invert();
    const geometries = meshes.map((mesh) => {
      const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', source.getAttribute('position'));
      geometry.setAttribute('normal', source.getAttribute('normal'));
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, mesh.matrixWorld));
      const color = (mesh.material as THREE.MeshStandardMaterial).color ?? new THREE.Color('#d7a07a');
      const count = geometry.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) color.toArray(colors, i * 3);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return geometry;
    });
    const merged = mergeVertices(mergeGeometries(geometries), 1e-5);
    for (const mesh of meshes) mesh.removeFromParent();
    const combined = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true }));
    combined.name = owner === root ? 'Body' : `${owner.name}Mesh`;
    owner.add(combined);
  }
}

function stylize(root: THREE.Object3D, gradient: THREE.Texture): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const previous = mesh.material as THREE.MeshStandardMaterial;
    const color = previous?.color?.clone() ?? new THREE.Color('#d7a07a');
    const material = new THREE.MeshToonMaterial({ color, gradientMap: gradient, vertexColors: previous?.vertexColors ?? false });
    material.name = previous?.name ?? mesh.name;
    mesh.material = material;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
}

function fallback(key: keyof ModelLibrary): THREE.Group {
  const group = new THREE.Group();
  const color = key === 'worm' ? '#f7a39a' : key === 'tank' ? '#6d8a3e' : '#c4a574';
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), new THREE.MeshStandardMaterial({ color, name: 'Body' }));
  mesh.position.y = 0.4;
  group.add(mesh);
  return group;
}
