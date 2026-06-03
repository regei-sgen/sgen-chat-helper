<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch } from 'vue';
import * as THREE from 'three';
import ForceGraph3D, {
  type ForceGraph3DInstance,
  type NodeObject,
  type LinkObject,
} from '3d-force-graph';
import type { GraphResponse, GraphNode } from '@kb/shared';

const props = defineProps<{
  data: GraphResponse;
  highlightArea?: string | null;
  heightClass?: string;
  frameless?: boolean;
  // Slugs of the article node(s) an answer came from — spotlighted on the graph.
  spotlightSlugs?: string[] | null;
}>();

const emit = defineEmits<{
  'select-node': [node: GraphNode];
}>();

// HUD telemetry readouts.
const nodeCount = computed(() => props.data.nodes.length);
const edgeCount = computed(() => props.data.edges.length);

// Colour by `productPillar` (the populated reference field); known pillars get brand colours, any
// other pillar a stable fallback, and a null pillar its own grey "Uncategorized" group.
const PILLAR_COLORS: Record<string, string> = {
  'SG-Core': '#d51522',
  'SG-Modules': '#ffcf5c',
  'SG-Dashboard': '#ff7a45',
  'SG-Admin': '#4aa3e0',
  'SG-Builder': '#a78bfa',
};
const PILLAR_FALLBACK = ['#34d399', '#f472b6', '#38bdf8', '#fb923c', '#c084fc', '#facc15'];
const NONE_COLOR = '#9aa0aa';

// Stable {label,color} for every pillar present (null/'' → "Uncategorized"). Shared by node colour
// AND the legend so the two can never disagree.
function pillarColorMap(
  nodes: GraphResponse['nodes'],
): Map<string, { label: string; color: string }> {
  const present = [...new Set(nodes.map((n) => n.productPillar || 'NONE'))];
  const named = present.filter((p) => p !== 'NONE').sort();
  const map = new Map<string, { label: string; color: string }>();
  let fi = 0;
  for (const p of named) {
    const color = PILLAR_COLORS[p] ?? PILLAR_FALLBACK[fi++ % PILLAR_FALLBACK.length];
    map.set(p, { label: p, color });
  }
  if (present.includes('NONE')) map.set('NONE', { label: 'Uncategorized', color: NONE_COLOR });
  return map;
}

const legendAreas = computed(() =>
  [...pillarColorMap(props.data.nodes).entries()].map(([key, v]) => ({
    key,
    label: v.label,
    color: v.color,
  })),
);
const hasPrereqEdges = computed(() => props.data.edges.some((e) => e.type === 'prerequisite'));
const hasRelatedEdges = computed(() => props.data.edges.some((e) => e.type === 'related'));

const LINK_PREREQ = '#ef4444'; // red
const LINK_RELATED = '#ffffff'; // white
const SPOTLIGHT = '#ffcf5c';

// The shape we attach to each force-graph node (extra props ride alongside NodeObject).
interface GNode extends NodeObject {
  id: string;
  label: string;
  slug: string;
  productArea: GraphNode['productArea'];
  productPillar: GraphNode['productPillar'];
  difficulty: GraphNode['difficulty'];
  status: GraphNode['status'];
  color: string;
  val: number;
  isHub: boolean; // among the top-degree nodes → always-on floating label
}

const container = ref<HTMLDivElement | null>(null);
let graph: ForceGraph3DInstance | null = null;
let resizeObs: ResizeObserver | null = null;

// ── Loading / settle overlay ─────────────────────────────────────────────────
// The ONLY laggy window is the initial force simulation: the engine recomputes forces for every
// node/link each frame during warmup + cooldown. Once it cools the layout freezes and orbiting is a
// cheap static GPU render. three-forcegraph fires `onEngineStop` exactly once when the sim stops
// (cntTicks > cooldownTicks OR elapsed > cooldownTime), in the same frame as the settled layout — so
// we cover that window with an opaque overlay and reveal the already-settled graph underneath.
const COOLDOWN_TICKS = 200;
const COOLDOWN_TIME = 5000;
const SETTLE_FALLBACK_MS = COOLDOWN_TIME + 4000; // hard cap so the overlay can never trap the user
const settling = ref(true);
const progressPct = ref(0);
const progressNow = computed(() => Math.round(progressPct.value)); // integer for aria-valuenow
let startTime = 0;
let tickCount = 0;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let rafId: number | null = null;
let destroyed = false;

function finishSettle(): void {
  if (settleTimer !== null) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  progressPct.value = 100;
  settling.value = false;
}
function beginSettle(): void {
  // Empty graph → nothing to lay out; skip the overlay entirely (no pointless 0% spinner that would
  // otherwise sit until the fallback timer, since few/no engine ticks fire for an empty sim).
  if (props.data.nodes.length === 0) {
    finishSettle();
    return;
  }
  settling.value = true;
  progressPct.value = 0;
  tickCount = 0;
  startTime = performance.now();
  if (settleTimer !== null) clearTimeout(settleTimer);
  settleTimer = setTimeout(finishSettle, SETTLE_FALLBACK_MS);
}
function onEngineTickProgress(): void {
  if (!settling.value) return;
  tickCount += 1;
  // The engine stops on whichever threshold (time vs ticks) fires first, so drive the bar by the
  // closer of the two. Capped at 99% until onEngineStop confirms the layout has actually settled.
  const byTime = (performance.now() - startTime) / COOLDOWN_TIME;
  const byTicks = tickCount / COOLDOWN_TICKS;
  progressPct.value = Math.min(99, Math.max(byTime, byTicks) * 100);
}

// ── Planet rendering ─────────────────────────────────────────────────────────
// Each node is a lit sphere wearing a procedurally-painted "planet" skin (continents, faint
// cloud bands, polar caps) tinted by its pillar colour. Everything is cached/shared so a graph of
// thousands of nodes still has only ~a dozen materials/textures, one geometry, and one mesh/node
// (the same mesh count the default renderer already used — no draw-call regression).
const NODE_REL = 4; // matches the old nodeRelSize so planet sizes match the previous spheres
let sphereGeo: THREE.SphereGeometry | null = null; // shared unit sphere (built once, sized per node)
const texByColor = new Map<string, THREE.Texture>();
const matByColor = new Map<string, THREE.MeshStandardMaterial>();
let dimMat: THREE.MeshStandardMaterial | null = null; // un-highlighted nodes (opaque, cheap)
let spotMat: THREE.MeshStandardMaterial | null = null; // chat-answer spotlight (glowing gold)

// ── Floating labels (zoom-adaptive) ──────────────────────────────────────────
// Hub nodes (most-connected) are labelled at all times; non-hub labels reveal as the camera moves
// closer (and for chat-spotlighted nodes). Labels are THREE.Sprites (canvas text — no new dep)
// parented to each node's group so they float above the planet and always face the camera. Created
// lazily and capped (LRU) so a 2094-node graph never holds thousands of text textures at once.
const HUB_COUNT = 18; // always-on "landmark" labels for the top-N nodes by degree
const NEAR_COUNT = 70; // max non-hub labels revealed by proximity at once
const MAX_SPRITES = 400; // hard cap on live label sprites (LRU-evicted)
const LABEL_SCREEN = 0.05; // every label: constant on-screen size (sizeAttenuation off) → all uniform
const LABEL_UPDATE_MS = 140; // throttle for the proximity recompute
// Each node's 3D object: a group holding the planet mesh and (optionally) a label sprite.
interface NodeObj3D {
  group: THREE.Group;
  mesh: THREE.Mesh;
  sprite: THREE.Sprite | null;
  node: GNode;
}
const nodeObjs = new Map<string, NodeObj3D>();
const labelSprites = new Map<string, THREE.Sprite>(); // id → live sprite (subset of nodeObjs)
const labelOrder: string[] = []; // LRU bookkeeping: least-recently-shown first
let distNear = 0; // proximity threshold (world units), calibrated from the settled layout
let labelLoopId: number | null = null;
let lastLabelUpdate = 0;

// Paint an equirectangular (2:1) planet skin onto a small canvas, tinted around `hex`.
function makePlanetTexture(hex: string): THREE.Texture {
  const w = 256;
  const h = 128;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  const base = new THREE.Color(hex);
  const css = (c: THREE.Color) => c.getStyle();

  // Base "ocean" — a darker shade of the pillar colour.
  ctx.fillStyle = css(base.clone().multiplyScalar(0.5));
  ctx.fillRect(0, 0, w, h);

  // Mottled "continents" — many soft blobs at varying lightness.
  for (let i = 0; i < 240; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 3 + Math.random() * 15;
    const k = 0.4 + Math.random() * 0.95; // lightness factor (some darker, some brighter)
    ctx.beginPath();
    ctx.fillStyle = css(base.clone().multiplyScalar(k));
    ctx.globalAlpha = 0.4;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Faint horizontal cloud/gas bands for a more "planetary" feel.
  ctx.globalAlpha = 0.08;
  for (let y = 0; y < h; y += 4) {
    ctx.fillStyle =
      (y / 4) % 2 ? css(base.clone().multiplyScalar(0.8)) : css(base.clone().multiplyScalar(1.2));
    ctx.fillRect(0, y, w, 2);
  }

  // Brighter polar caps (top & bottom rows wrap to the sphere's poles).
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = css(base.clone().lerp(new THREE.Color('#ffffff'), 0.7));
  ctx.fillRect(0, 0, w, 9);
  ctx.fillRect(0, h - 9, w, 9);

  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

// One planet material per distinct pillar colour (shared across every node of that pillar).
function planetMaterial(hex: string): THREE.MeshStandardMaterial {
  let m = matByColor.get(hex);
  if (!m) {
    const tex = makePlanetTexture(hex);
    texByColor.set(hex, tex);
    m = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.9,
      metalness: 0.0,
      // A whisper of self-glow so a planet's night side stays visible against the black.
      emissive: new THREE.Color(hex).multiplyScalar(0.08),
    });
    matByColor.set(hex, m);
  }
  return m;
}

// Sphere radius for a node, mirroring three-forcegraph's default cbrt(val)*relSize sizing.
function radiusFor(val: number): number {
  return NODE_REL * Math.cbrt(val);
}

// Pick the right material + size for a mesh given the current spotlight/highlight state.
function applyAppearance(mesh: THREE.Mesh, n: GNode): void {
  const slugs = props.spotlightSlugs;
  let r = radiusFor(n.val);
  let mat: THREE.Material;
  if (slugs && slugs.length) {
    if (slugs.includes(n.slug)) {
      mat = spotMat!;
      r = radiusFor(n.val * 2.4); // spotlighted nodes swell, as before
    } else {
      mat = dimMat!;
    }
  } else if (props.highlightArea && n.productArea !== props.highlightArea) {
    mat = dimMat!;
  } else {
    mat = planetMaterial(n.color);
  }
  mesh.material = mat;
  mesh.scale.setScalar(r);
}

// Draw the node title onto a canvas → a camera-facing Sprite that floats above the planet.
function makeLabelSprite(text: string): THREE.Sprite {
  const fontPx = 34;
  const pad = 12;
  const label = text.length > 42 ? text.slice(0, 40) + '…' : text;
  const font = `600 ${fontPx}px Inter, system-ui, sans-serif`;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const w = Math.ceil(measure.measureText(label).width) + pad * 2;
  const h = fontPx + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  // subtle dark pill for legibility over bright planets / pale links
  ctx.fillStyle = 'rgba(8,9,14,0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false, // float on top of the planets/links rather than being occluded
    depthWrite: false,
    // Constant on-screen size for every label, so they're all the same size regardless of distance.
    sizeAttenuation: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 10;
  sprite.userData.aspect = w / h;
  setLabelSize(sprite, LABEL_SCREEN);
  return sprite;
}

// Set a label's on-screen size, preserving the text aspect ratio.
function setLabelSize(sprite: THREE.Sprite, size: number): void {
  const a = (sprite.userData.aspect as number) || 4;
  sprite.scale.set(size * a, size, 1);
}

// Place a label just above its planet (accounts for the spotlight swell).
function positionLabel(sprite: THREE.Sprite, n: GNode): void {
  const slugs = props.spotlightSlugs;
  const swelled = !!(slugs && slugs.length && slugs.includes(n.slug));
  const r = radiusFor(swelled ? n.val * 2.4 : n.val);
  sprite.position.set(0, r + 3, 0);
}

function disposeLabel(id: string): void {
  const sprite = labelSprites.get(id);
  if (sprite) {
    const obj = nodeObjs.get(id);
    obj?.group.remove(sprite);
    if (obj) obj.sprite = null;
    const m = sprite.material as THREE.SpriteMaterial;
    m.map?.dispose();
    m.dispose();
  }
  labelSprites.delete(id);
}

// True when the node is currently dimmed (area-highlight / spotlight) — hide its label too.
function isDimmed(n: GNode): boolean {
  const slugs = props.spotlightSlugs;
  if (slugs && slugs.length) return !slugs.includes(n.slug);
  return !!(props.highlightArea && n.productArea !== props.highlightArea);
}

// Decide which labels show now: ONLY when zoomed in (nodes within distNear of the camera, hubs
// preferred when crowded), plus spotlighted nodes. Create lazily, toggle, LRU-evict beyond the cap.
function updateLabels(): void {
  if (!graph) return;
  const cam = graph.camera();
  const nodes = graph.graphData().nodes as GNode[];
  const slugs = props.spotlightSlugs;
  const show = new Set<string>();
  // Spotlighted (chat-answer) nodes are always labelled — a deliberate "look here" cue.
  if (slugs && slugs.length) {
    for (const n of nodes) if (slugs.includes(n.slug)) show.add(n.id);
  }
  // Otherwise labels appear ONLY when zoomed in: nodes within distNear of the camera, capped to
  // NEAR_COUNT (hubs first, then nearest). distNear stays 0 until the layout calibrates at settle.
  if (distNear > 0) {
    const near: { id: string; d2: number; hub: boolean }[] = [];
    const lim = distNear * distNear;
    for (const n of nodes) {
      if (typeof n.x !== 'number') continue;
      const dx = n.x - cam.position.x;
      const dy = (n.y ?? 0) - cam.position.y;
      const dz = (n.z ?? 0) - cam.position.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < lim) near.push({ id: n.id, d2, hub: n.isHub });
    }
    near.sort((a, b) => (b.hub ? 1 : 0) - (a.hub ? 1 : 0) || a.d2 - b.d2);
    for (let i = 0; i < near.length && i < NEAR_COUNT; i++) show.add(near[i].id);
  }
  // apply visibility, creating sprites lazily; suppress labels on dimmed nodes
  for (const [id, obj] of nodeObjs) {
    const want = show.has(id) && !isDimmed(obj.node);
    if (want) {
      if (!obj.sprite) {
        const sprite = makeLabelSprite(obj.node.label);
        positionLabel(sprite, obj.node);
        obj.group.add(sprite);
        obj.sprite = sprite;
        labelSprites.set(id, sprite);
      }
      obj.sprite.visible = true;
      const idx = labelOrder.indexOf(id); // LRU touch
      if (idx >= 0) labelOrder.splice(idx, 1);
      labelOrder.push(id);
    } else if (obj.sprite) {
      obj.sprite.visible = false;
    }
  }
  // LRU cap: dispose the least-recently-shown sprites that aren't currently shown
  let i = 0;
  while (labelSprites.size > MAX_SPRITES && i < labelOrder.length) {
    const id = labelOrder[i];
    if (!show.has(id) && labelSprites.has(id)) {
      disposeLabel(id);
      labelOrder.splice(i, 1);
    } else {
      i += 1;
    }
  }
}

// Calibrate the proximity threshold from the settled layout's bounding radius: ~a third of the
// graph radius, so labels stay hidden when viewing the whole graph and reveal as you zoom in.
function calibrateLabelDistance(): void {
  if (!graph) return;
  const nodes = graph.graphData().nodes as GNode[];
  let cx = 0, cy = 0, cz = 0, k = 0;
  for (const n of nodes) {
    if (typeof n.x === 'number') {
      cx += n.x;
      cy += n.y ?? 0;
      cz += n.z ?? 0;
      k += 1;
    }
  }
  if (!k) {
    distNear = 0;
    return;
  }
  cx /= k;
  cy /= k;
  cz /= k;
  let maxR2 = 0;
  for (const n of nodes) {
    if (typeof n.x !== 'number') continue;
    const dx = n.x - cx, dy = (n.y ?? 0) - cy, dz = (n.z ?? 0) - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > maxR2) maxR2 = d2;
  }
  distNear = Math.sqrt(maxR2) * 0.35;
}

function labelTick(): void {
  labelLoopId = requestAnimationFrame(labelTick);
  const t = performance.now();
  if (t - lastLabelUpdate < LABEL_UPDATE_MS) return;
  lastLabelUpdate = t;
  updateLabels();
}

// Build (or reuse) the Three.js object for a node — a group of {textured planet sphere, lazy label}.
function nodeObject(node: NodeObject): THREE.Object3D {
  const n = node as GNode;
  let obj = nodeObjs.get(n.id);
  if (!obj) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(sphereGeo!, planetMaterial(n.color));
    group.add(mesh);
    obj = { group, mesh, sprite: null, node: n };
    nodeObjs.set(n.id, obj);
  } else {
    obj.node = n; // keep the live node reference fresh across rebuilds
  }
  applyAppearance(obj.mesh, n);
  return obj.group;
}

// Map the shared GraphResponse → 3d-force-graph's {nodes, links}. Fresh objects each call (the
// library mutates nodes/links in place with x/y/z + resolved link endpoints).
function buildData(data: GraphResponse): { nodes: GNode[]; links: LinkObject[] } {
  const degree = new Map<string, number>();
  for (const e of data.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  // Top-degree nodes get an always-on label (the rest reveal by proximity / spotlight).
  const hubIds = new Set(
    [...degree.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, HUB_COUNT)
      .map((e) => e[0]),
  );
  const pcolors = pillarColorMap(data.nodes);
  const nodes: GNode[] = data.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    slug: n.slug,
    productArea: n.productArea,
    productPillar: n.productPillar,
    difficulty: n.difficulty,
    status: n.status,
    color: pcolors.get(n.productPillar || 'NONE')?.color ?? NONE_COLOR,
    // Degree → size, so hubs look like bigger planets.
    val: 1 + Math.min(degree.get(n.id) ?? 0, 12),
    isHub: hubIds.has(n.id),
  }));
  const links = data.edges.map((e) => ({
    source: e.source,
    target: e.target,
    type: e.type,
  })) as unknown as LinkObject[];
  return { nodes, links };
}

function linkColor(link: LinkObject): string {
  return (link as { type?: string }).type === 'prerequisite' ? LINK_PREREQ : LINK_RELATED;
}

// Re-apply material/size to the existing meshes (cheap — no rebuild) when highlight/spotlight flips,
// then recompute which labels show (spotlight changes what's labelled and the swell offset).
function refreshVisuals(): void {
  if (!graph) return;
  for (const n of graph.graphData().nodes as GNode[]) {
    const obj = nodeObjs.get(n.id);
    if (obj) {
      obj.node = n;
      applyAppearance(obj.mesh, n);
      if (obj.sprite) positionLabel(obj.sprite, n);
    }
  }
  updateLabels();
}

// Fly the camera to the centroid of the spotlighted nodes once the sim has placed them.
function focusSpotlight(): void {
  if (!graph) return;
  const slugs = props.spotlightSlugs;
  if (!slugs || !slugs.length) return;
  const targets = (graph.graphData().nodes as GNode[]).filter(
    (n) => slugs.includes(n.slug) && typeof n.x === 'number',
  );
  if (!targets.length) return;
  const c = targets.reduce(
    (a, n) => ({ x: a.x + (n.x ?? 0), y: a.y + (n.y ?? 0), z: a.z + (n.z ?? 0) }),
    { x: 0, y: 0, z: 0 },
  );
  c.x /= targets.length;
  c.y /= targets.length;
  c.z /= targets.length;
  graph.cameraPosition({ x: c.x, y: c.y, z: c.z + 200 }, c, 1200);
}

function setSize(): void {
  if (graph && container.value) {
    graph.width(container.value.clientWidth).height(container.value.clientHeight);
  }
}

function mountGraph(): void {
  if (!container.value) return;

  // Shared sphere geometry — resolution gated by graph size (round planets when small, leaner
  // triangles when there are thousands).
  const n = props.data.nodes.length;
  const wSeg = n <= 700 ? 24 : n <= 2500 ? 16 : 10;
  const hSeg = Math.max(8, Math.round(wSeg * 0.75));
  sphereGeo = new THREE.SphereGeometry(1, wSeg, hSeg);

  // Highlight/spotlight materials (opaque → no per-frame transparency sort even when dimming).
  dimMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 1, metalness: 0 });
  spotMat = new THREE.MeshStandardMaterial({
    color: SPOTLIGHT,
    emissive: new THREE.Color(SPOTLIGHT).multiplyScalar(0.5),
    roughness: 0.5,
    metalness: 0,
  });

  graph = new ForceGraph3D(container.value)
    .backgroundColor('#06070d')
    .graphData(buildData(props.data))
    .nodeThreeObject(nodeObject) // textured planet meshes (replaces flat default spheres)
    .nodeLabel('label') // shown as a tooltip on hover
    .linkColor(linkColor)
    .linkOpacity(0.22)
    .linkWidth(0)
    // ── Performance: the per-frame force sim is the main cost at scale. Pre-settle a few ticks
    // off-screen, then FREEZE the layout (cooldownTicks/Time) so it stops simulating and becomes a
    // static GPU render; disable node-drag so orbiting/clicking never re-heats the sim.
    .warmupTicks(30)
    .cooldownTicks(COOLDOWN_TICKS)
    .cooldownTime(COOLDOWN_TIME)
    .enableNodeDrag(false)
    .showNavInfo(false)
    // Drive the loading overlay off the real engine lifecycle: tick → progress, stop → reveal.
    .onEngineTick(onEngineTickProgress)
    .onEngineStop(() => {
      if (destroyed) return;
      finishSettle();
      calibrateLabelDistance(); // positions are settled → set the proximity reveal threshold
      updateLabels();
    })
    .onNodeClick((node: NodeObject) => {
      const nn = node as GNode;
      emit('select-node', {
        id: nn.id,
        label: nn.label,
        slug: nn.slug,
        productArea: nn.productArea,
        productPillar: nn.productPillar,
        difficulty: nn.difficulty,
        status: nn.status,
      });
      // Ease the camera toward the clicked node.
      const at = { x: nn.x ?? 0, y: nn.y ?? 0, z: nn.z ?? 0 };
      graph?.cameraPosition({ x: at.x, y: at.y, z: at.z + 120 }, at, 800);
    });

  // A directional "sun" gives every planet a lit side and a shadowed terminator (the default
  // ambient light handles fill so the night side isn't pure black).
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(1, 0.6, 0.8);
  graph.scene().add(sun);

  setSize();
  resizeObs = new ResizeObserver(setSize);
  resizeObs.observe(container.value);

  // Start the throttled label loop (hubs label immediately; proximity reveal kicks in once the
  // layout settles and calibrateLabelDistance() sets distNear).
  lastLabelUpdate = 0;
  labelTick();
}

watch(
  () => props.data,
  () => {
    if (!graph) return;
    // New dataset: dispose the old label sprites + node objects (shared geo/materials/textures stay);
    // groups + planet meshes rebuild lazily via nodeThreeObject.
    for (const id of [...labelSprites.keys()]) disposeLabel(id);
    labelOrder.length = 0;
    nodeObjs.clear();
    distNear = 0;
    beginSettle(); // re-show the overlay while the new layout re-settles (fallback timer hides it)
    graph.graphData(buildData(props.data));
  },
  { deep: false },
);
watch(() => props.highlightArea, refreshVisuals);
watch(() => props.spotlightSlugs, () => {
  refreshVisuals();
  focusSpotlight();
});

onMounted(() => {
  // Paint the overlay first, THEN build the graph: `warmupTicks` run synchronously inside
  // ForceGraph3D construction and would otherwise block the very first paint — hiding the overlay
  // during the heaviest moment. One rAF guarantees the overlay is on screen before we do the work.
  beginSettle();
  rafId = requestAnimationFrame(() => {
    rafId = null;
    if (!destroyed) mountGraph();
  });
});
onBeforeUnmount(() => {
  destroyed = true;
  if (labelLoopId !== null) cancelAnimationFrame(labelLoopId);
  labelLoopId = null;
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  if (settleTimer !== null) clearTimeout(settleTimer);
  settleTimer = null;
  resizeObs?.disconnect();
  resizeObs = null;
  graph?._destructor?.();
  graph = null;
  // Free GPU resources. Label sprites own their own textures, so dispose those first; the shared
  // geometry/materials/planet-textures are disposed below.
  for (const id of [...labelSprites.keys()]) disposeLabel(id);
  labelOrder.length = 0;
  nodeObjs.clear();
  for (const m of matByColor.values()) m.dispose();
  matByColor.clear();
  for (const t of texByColor.values()) t.dispose();
  texByColor.clear();
  dimMat?.dispose();
  dimMat = null;
  spotMat?.dispose();
  spotMat = null;
  sphereGeo?.dispose();
  sphereGeo = null;
});
</script>

<template>
  <div class="relative gv-wrap min-w-0" :class="{ 'is-frameless': frameless }">
    <div
      ref="container"
      class="w-full overflow-hidden"
      :class="[heightClass ?? 'h-[640px]', frameless ? '' : 'rounded-btn border border-[#2a2a33]']"
      style="background: #06070d"
    />

    <!-- loading / settle overlay — opaque cover over the one laggy window (initial force sim) -->
    <transition name="gv-fade">
      <div
        v-if="settling"
        class="gv-loading"
        :class="frameless ? '' : 'rounded-btn'"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div class="gv-loading-inner">
          <div class="gv-spinner" />
          <div class="gv-loading-title">Rendering knowledge graph…</div>
          <div class="gv-loading-sub">{{ nodeCount }} nodes · {{ edgeCount }} links · settling layout</div>
          <div
            class="gv-progress"
            role="progressbar"
            aria-label="Graph rendering progress"
            :aria-valuenow="progressNow"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div class="gv-progress-bar" :style="{ width: progressPct + '%' }" />
          </div>
        </div>
      </div>
    </transition>

    <!-- legend (reflects the actual data on screen) -->
    <div class="gv-legend">
      <div class="gv-legend-head">Legend</div>
      <div v-for="a in legendAreas" :key="a.key" class="row">
        <span class="dot" :style="{ '--c': a.color }" /> {{ a.label }}
      </div>
      <div v-if="hasPrereqEdges" class="row"><span class="ln" :style="{ '--c': LINK_PREREQ }" /> Prerequisite</div>
      <div v-if="hasRelatedEdges" class="row"><span class="ln" :style="{ '--c': LINK_RELATED }" /> Related</div>
      <div class="gv-legend-foot">{{ nodeCount }} nodes · {{ edgeCount }} links</div>
    </div>

    <!-- controls hint -->
    <div class="gv-hint">Drag to orbit · scroll to zoom · hover a node for its title · click to open</div>
  </div>
</template>

<style scoped>
.gv-wrap {
  isolation: isolate;
}
.gv-legend,
.gv-hint {
  pointer-events: none;
}

/* loading / settle overlay — opaque (matches the canvas bg) so the layout churn is never seen;
   sits above the legend/hint while active, then fades out to reveal the settled graph */
.gv-loading {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: #06070d;
  overflow: hidden;
}
.gv-loading-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.gv-spinner {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.14);
  border-top-color: #ffcf5c;
  animation: gv-spin 0.9s linear infinite;
}
@keyframes gv-spin {
  to {
    transform: rotate(360deg);
  }
}
.gv-loading-title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}
.gv-loading-sub {
  font-size: 11px;
  color: #9197a1;
}
.gv-progress {
  width: 180px;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}
.gv-progress-bar {
  height: 100%;
  width: 0;
  background: #ffcf5c;
  transition: width 0.2s ease;
}
/* keep the overlay non-blocking the instant it starts leaving, so the settled graph is interactive */
.gv-fade-leave-active {
  transition: opacity 0.45s ease;
  pointer-events: none;
}
.gv-fade-enter-active {
  transition: opacity 0.15s ease;
}
.gv-fade-enter-from,
.gv-fade-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .gv-spinner {
    animation-duration: 2.4s;
  }
  .gv-progress-bar,
  .gv-fade-enter-active,
  .gv-fade-leave-active {
    transition: none;
  }
}

/* legend */
.gv-legend {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  font-size: 11px;
  color: #cfd2d8;
  background: rgba(20, 20, 26, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  backdrop-filter: blur(4px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}
.gv-legend-head {
  margin-bottom: 2px;
  font-weight: 600;
  color: #fff;
}
.gv-legend .row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.gv-legend .dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.85), var(--c) 55%, rgba(0, 0, 0, 0.45) 130%);
}
.gv-legend .ln {
  width: 18px;
  height: 0;
  border-top: 2px solid var(--c);
}
.gv-legend-foot {
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 10px;
  color: #9197a1;
}

/* controls hint */
.gv-hint {
  position: absolute;
  bottom: 10px;
  left: 14px;
  z-index: 6;
  font-size: 10.5px;
  color: #888e98;
}
</style>
