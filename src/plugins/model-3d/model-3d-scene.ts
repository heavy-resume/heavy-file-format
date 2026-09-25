// three.js viewer for the 3D model plugin. Everything here is behind a dynamic
// import from model-3d.ts so the renderer is only fetched when a 3D component
// is actually mounted.

import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Box3,
  BufferGeometry,
  Clock,
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  HemisphereLight,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type AnimationClip,
  type Material,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { Model3dFormat } from './model-3d-formats';
import { resolveSandboxedResourceUrl } from './model-3d-resource-policy';

export interface Model3dParseResult {
  object: Object3D;
  animations: AnimationClip[];
  /** Resource URLs the model asked for that we refused to fetch. */
  blockedResources: string[];
}

/**
 * Model formats can reference external textures and buffers by relative or
 * absolute URL. Fetching those would let an attached file make the reader issue
 * arbitrary outbound requests, so every non-inline URL is refused and reported.
 * `data:` URIs are self-contained and stay allowed.
 */
function createSandboxedManager(blockedResources: string[]): LoadingManager {
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    const resolution = resolveSandboxedResourceUrl(url);
    if (resolution.blocked && !blockedResources.includes(url)) blockedResources.push(url);
    return resolution.url;
  });
  return manager;
}

function isGlbBuffer(bytes: Uint8Array): boolean {
  // glTF binary container starts with the ASCII magic "glTF".
  return bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function createDefaultMaterial(wireframe: boolean): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: 0x9aa7b4,
    metalness: 0.08,
    roughness: 0.72,
    side: DoubleSide,
    wireframe,
    flatShading: false,
  });
}

export async function parseModel3d(
  format: Model3dFormat,
  bytes: Uint8Array,
  wireframe: boolean
): Promise<Model3dParseResult> {
  const blockedResources: string[] = [];
  const manager = createSandboxedManager(blockedResources);
  const buffer = toArrayBuffer(bytes);
  const decodeText = () => new TextDecoder().decode(bytes);

  switch (format.id) {
    case 'gltf': {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loader = new GLTFLoader(manager);
      const gltf = await new Promise<{ scene: Group; animations: AnimationClip[] }>((resolve, reject) => {
        // Empty path so relative resource URLs resolve to bare names and are
        // caught by the sandboxed URL modifier rather than the document origin.
        loader.parse(isGlbBuffer(bytes) ? buffer : decodeText(), '', resolve, reject);
      });
      return { object: gltf.scene, animations: gltf.animations ?? [], blockedResources };
    }
    case 'obj': {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
      // The companion .mtl is not attached, so OBJ renders with the default
      // material. Vertex colors, when present in the file, still apply.
      return { object: new OBJLoader(manager).parse(decodeText()), animations: [], blockedResources };
    }
    case 'stl': {
      const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
      return wrapGeometry(new STLLoader(manager).parse(buffer), wireframe, blockedResources);
    }
    case 'ply': {
      const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
      return wrapGeometry(new PLYLoader(manager).parse(buffer), wireframe, blockedResources);
    }
    case 'fbx': {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      const object = new FBXLoader(manager).parse(buffer, '');
      return { object, animations: object.animations ?? [], blockedResources };
    }
    case 'collada': {
      const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
      const collada = new ColladaLoader(manager).parse(decodeText(), '');
      if (!collada?.scene) throw new Error('Collada file contained no scene.');
      return { object: collada.scene, animations: collada.scene.animations ?? [], blockedResources };
    }
    case '3mf': {
      const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
      return { object: new ThreeMFLoader(manager).parse(buffer), animations: [], blockedResources };
    }
    case 'amf': {
      const { AMFLoader } = await import('three/addons/loaders/AMFLoader.js');
      return { object: new AMFLoader(manager).parse(buffer), animations: [], blockedResources };
    }
    case 'vtk': {
      const { VTKLoader } = await import('three/addons/loaders/VTKLoader.js');
      return wrapGeometry(new VTKLoader(manager).parse(buffer, ''), wireframe, blockedResources);
    }
    case 'pcd': {
      const { PCDLoader } = await import('three/addons/loaders/PCDLoader.js');
      return { object: new PCDLoader(manager).parse(buffer), animations: [], blockedResources };
    }
    case 'xyz': {
      const { XYZLoader } = await import('three/addons/loaders/XYZLoader.js');
      // @types/three declares parse() as callback-based returning `object`, but
      // the shipped loader returns the geometry directly and never calls the
      // callback. Trust the runtime and narrow the stale declaration.
      const geometry = (new XYZLoader(manager) as unknown as {
        parse(text: string): BufferGeometry;
      }).parse(decodeText());
      const points = new Points(geometry, new PointsMaterial({ size: 0.02, vertexColors: hasVertexColors(geometry) }));
      return { object: points, animations: [], blockedResources };
    }
    default:
      throw new Error(`Unsupported 3D format "${format.id}".`);
  }
}

function hasVertexColors(geometry: BufferGeometry): boolean {
  return geometry.getAttribute('color') !== undefined;
}

/**
 * True when a geometry carries normals that cannot light a surface. Plenty of
 * STL and VTK exporters write all-zero normals and expect the viewer to derive
 * them; shading against those yields a solid black model.
 */
function hasUnusableNormals(geometry: BufferGeometry): boolean {
  const normals = geometry.getAttribute('normal');
  if (!normals) return true;
  for (let index = 0; index < normals.count; index += 1) {
    if (normals.getX(index) !== 0 || normals.getY(index) !== 0 || normals.getZ(index) !== 0) {
      return false;
    }
  }
  return true;
}

function wrapGeometry(
  geometry: BufferGeometry,
  wireframe: boolean,
  blockedResources: string[]
): Model3dParseResult {
  if (hasUnusableNormals(geometry)) geometry.computeVertexNormals();
  const material = createDefaultMaterial(wireframe);
  material.vertexColors = hasVertexColors(geometry);
  return { object: new Mesh(geometry, material), animations: [], blockedResources };
}

export interface Model3dViewerOptions {
  autoRotate: boolean;
  showGrid: boolean;
  wireframe: boolean;
}

export interface Model3dViewer {
  canvas: HTMLCanvasElement;
  /** Label the focusable canvas for assistive technology. */
  setAccessibleName(name: string): void;
  setModel(result: Model3dParseResult): void;
  setOptions(options: Model3dViewerOptions): void;
  /** Re-read theme colors after a palette change. */
  syncTheme(): void;
  resetView(): void;
  dispose(): void;
}

function readThemeColor(host: HTMLElement, variable: string, fallback: string): Color {
  const raw = getComputedStyle(host).getPropertyValue(variable).trim();
  try {
    // Color rejects unparseable input; fall back rather than throwing into the
    // render loop.
    return new Color(raw || fallback);
  } catch {
    return new Color(fallback);
  }
}

export function createModel3dViewer(host: HTMLElement, options: Model3dViewerOptions): Model3dViewer {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.className = 'hvy-model-3d-canvas';

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.01, 5000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotateSpeed = 1.6;

  // The viewer must not swallow the page's scroll just because the pointer
  // happens to be over it. Wheel zoom stays off until the canvas is focused;
  // OrbitControls checks enableZoom before calling preventDefault, so while it
  // is off the wheel event falls through to the scroll container as normal.
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  const hint = document.createElement('div');
  hint.className = 'hvy-model-3d-hint';
  hint.textContent = 'Click to zoom';
  hint.setAttribute('aria-hidden', 'true');

  const setInteractive = (interactive: boolean) => {
    controls.enableZoom = interactive;
    // OrbitControls forces touchAction 'none' when it connects, which also
    // blocks touch page scrolling. Hand vertical panning back until focused.
    canvas.style.touchAction = interactive ? 'none' : 'pan-y';
    host.classList.toggle('is-model-3d-interactive', interactive);
  };
  const onFocus = () => setInteractive(true);
  const onBlur = () => setInteractive(false);
  const onPointerDown = () => canvas.focus();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    // Consume the first Escape so it steps out of the model rather than
    // reaching block-level handling. A second press, with the viewer already
    // released, travels to the host as usual.
    event.stopPropagation();
    canvas.blur();
  };
  canvas.addEventListener('focus', onFocus);
  canvas.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('keydown', onKeyDown);
  setInteractive(false);

  scene.add(new AmbientLight(0xffffff, 0.55));
  const hemisphere = new HemisphereLight(0xffffff, 0x404a55, 1.1);
  scene.add(hemisphere);
  const key = new DirectionalLight(0xffffff, 1.5);
  key.position.set(4, 8, 6);
  scene.add(key);
  const fill = new DirectionalLight(0xffffff, 0.5);
  fill.position.set(-6, -2, -4);
  scene.add(fill);

  let grid: GridHelper | null = null;
  let model: Object3D | null = null;
  let mixer: AnimationMixer | null = null;
  let currentOptions = options;
  let frameRadius = 1;
  const clock = new Clock();

  const syncTheme = () => {
    scene.background = readThemeColor(host, '--hvy-surface-alt', '#f9fcff');
    hemisphere.groundColor = readThemeColor(host, '--hvy-bg-alt', '#eef3fa');
    rebuildGrid();
  };

  const rebuildGrid = () => {
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      disposeMaterial(grid.material);
      grid = null;
    }
    if (!currentOptions.showGrid) return;
    const line = readThemeColor(host, '--hvy-border', '#ced9e2');
    const accent = readThemeColor(host, '--hvy-border-alt', '#b8c8d3');
    grid = new GridHelper(frameRadius * 4, 20, accent, line);
    grid.position.y = -frameRadius;
    scene.add(grid);
  };

  const frameModel = () => {
    if (!model) return;
    const box = new Box3().setFromObject(model);
    if (box.isEmpty()) return;
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    // Normalize wildly different authoring units (millimetres in STL, metres in
    // glTF) into a consistent frame instead of scaling the model itself.
    frameRadius = Math.max(size.length() * 0.5, 0.001);
    const distance = frameRadius / Math.sin((camera.fov * Math.PI) / 360);
    camera.near = Math.max(frameRadius / 1000, 0.001);
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
    model.position.sub(center);
    camera.position.set(distance * 0.55, distance * 0.42, distance * 0.85);
    controls.target.set(0, 0, 0);
    controls.maxDistance = distance * 6;
    controls.update();
    rebuildGrid();
  };

  const applyWireframe = (object: Object3D, wireframe: boolean) => {
    object.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      for (const material of toMaterialArray(child.material)) {
        if ('wireframe' in material) {
          (material as MeshStandardMaterial).wireframe = wireframe;
          material.needsUpdate = true;
        }
      }
    });
  };

  const clearModel = () => {
    mixer?.stopAllAction();
    mixer = null;
    if (!model) return;
    scene.remove(model);
    disposeObject(model);
    model = null;
  };

  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(host);

  let running = true;
  const renderLoop = () => {
    if (!running) return;
    controls.autoRotate = currentOptions.autoRotate;
    controls.update();
    mixer?.update(clock.getDelta());
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(renderLoop);

  host.append(canvas, hint);
  syncTheme();

  return {
    canvas,
    setAccessibleName(name) {
      canvas.setAttribute('aria-label', name);
    },
    setModel(result) {
      clearModel();
      model = result.object;
      applyWireframe(model, currentOptions.wireframe);
      scene.add(model);
      frameModel();
      if (result.animations.length > 0) {
        mixer = new AnimationMixer(model);
        mixer.clipAction(result.animations[0]).play();
        clock.getDelta();
      }
    },
    setOptions(next) {
      const gridChanged = next.showGrid !== currentOptions.showGrid;
      const wireframeChanged = next.wireframe !== currentOptions.wireframe;
      currentOptions = next;
      if (gridChanged) rebuildGrid();
      if (wireframeChanged && model) applyWireframe(model, next.wireframe);
    },
    syncTheme,
    resetView: frameModel,
    dispose() {
      running = false;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      clearModel();
      if (grid) {
        grid.geometry.dispose();
        disposeMaterial(grid.material);
      }
      canvas.removeEventListener('focus', onFocus);
      canvas.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('keydown', onKeyDown);
      hint.remove();
      controls.dispose();
      renderer.dispose();
      // Browsers cap live WebGL contexts, so give this one up eagerly instead
      // of waiting for GC when documents mount many 3D components.
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

function toMaterialArray(material: Material | Material[]): Material[] {
  return Array.isArray(material) ? material : [material];
}

function disposeMaterial(material: Material | Material[]): void {
  for (const entry of toMaterialArray(material)) {
    for (const value of Object.values(entry)) {
      // Textures decoded from the model own GPU memory and are not freed by
      // material.dispose() alone.
      if (value && typeof value === 'object' && 'isTexture' in value) {
        (value as { dispose(): void }).dispose();
      }
    }
    entry.dispose();
  }
}

function disposeObject(root: Object3D): void {
  root.traverse((child) => {
    if (child instanceof Mesh || child instanceof Points) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}
