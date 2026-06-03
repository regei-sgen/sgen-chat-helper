<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch } from 'vue';
import cytoscape, { type Core, type ElementDefinition, type NodeSingular, type NodeCollection } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { GraphResponse, GraphNode } from '@kb/shared';

cytoscape.use(fcose as Parameters<typeof cytoscape.use>[0]);

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

// The graph colours by `productPillar` (the populated reference field) — productArea is the strict
// enum and is null for reference KB cards. Known pillars get brand colours; any other pillar gets a
// stable fallback colour so a multi-pillar library still renders distinctly; a null pillar becomes
// its own grey "Uncategorized" group so unpillared nodes stay visible (not silently merged).
const PILLAR_COLORS: Record<string, string> = {
  'SG-Core': '#d51522', // brand red
  'SG-Modules': '#ffcf5c', // gold
  'SG-Dashboard': '#ff7a45', // coral
  'SG-Admin': '#4aa3e0', // blue
};
const PILLAR_FALLBACK = ['#a78bfa', '#34d399', '#f472b6', '#38bdf8', '#fb923c', '#c084fc'];
const NONE_COLOR = '#9aa0aa'; // neutral grey for a null pillar

// Stable {label,color} for every pillar present among the nodes (null/'' grouped as "Uncategorized").
// Shared by node colouring AND the legend so the two can never disagree.
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

// Data-driven legend: only the pillars present among the nodes, and only the link types present
// among the edges — so it never advertises a colour or a "Prerequisite" line that has no data.
const legendAreas = computed(() =>
  [...pillarColorMap(props.data.nodes).entries()].map(([key, v]) => ({
    key,
    label: v.label,
    color: v.color,
  })),
);
const hasPrereqEdges = computed(() => props.data.edges.some((e) => e.type === 'prerequisite'));
const hasRelatedEdges = computed(() => props.data.edges.some((e) => e.type === 'related'));

const container = ref<HTMLDivElement | null>(null);
let cy: Core | null = null;
// The active fcose layout instance — tracked so we can stop() it (so a stale 'layoutstop' can't
// fire after teardown/data-change, and fcose's tween doesn't fight a drag).
let currentLayout: ReturnType<Core['layout']> | null = null;
let homesSeeded = false;
// Drives the "data travelling along the connections" flow animation.
let flowRaf: number | null = null;
let flowOffset = 0;
let flowFrame = 0;
// Frames to skip between dash updates — 1 = every frame, 0 = animation disabled. Set by
// computeFlowSkip() from the edge count: the flow effect repaints the WHOLE scene on every update,
// which is the main idle cost on big graphs, so we throttle it as the graph grows and switch it OFF
// entirely past a large threshold (edges still render statically — just no constant motion).
let flowSkip = 1;
// While the user is actively zooming/panning, pause the per-frame all-edges dash restyle so it
// doesn't compete with viewport rendering — the single biggest cause of sluggish scroll on large
// graphs. Resumes shortly after motion stops.
let viewportInteracting = false;
let viewportIdleTimer: number | null = null;

// Scale the flow animation to the graph size so a large graph stays at idle (no per-frame repaint).
function computeFlowSkip() {
  const n = cy ? cy.edges().length : 0;
  flowSkip = n > 1500 ? 0 : n > 600 ? 4 : n > 250 ? 2 : 1;
}

// Shared so SPRING.ideal (the live-drag physics) settles to the same scale fcose produced.
const IDEAL_EDGE_LENGTH = 175;
// Above this node count, run fcose in DRAFT quality and skip the fly-in animation. Measured: the
// default force layout blocks the main thread ~1s on ~1000 nodes; draft is ~7× faster (~180ms), and
// animating a 1000-node fly-in is itself janky. Small graphs keep the prettier default + animation.
const BIG_LAYOUT_NODES = 400;
// Above this element (nodes+edges) count, the hover "dim everything else" effect is replaced by a
// cheap highlight of just the hovered node + its edges. Measured: dimming all elements restyles the
// whole graph and costs ~80ms PER hover at ~5000 elements (vs ~2ms for the local highlight).
const HOVER_DIM_MAX = 1200;

// Single source of truth for the fcose arrangement (first paint AND data change), adapted to size.
function fcoseOpts(nodeCount: number) {
  const big = nodeCount > BIG_LAYOUT_NODES;
  return {
    name: 'fcose',
    animate: !big,
    quality: big ? 'draft' : 'default',
    randomize: true,
    nodeRepulsion: 26000,
    idealEdgeLength: IDEAL_EDGE_LENGTH,
    nodeSeparation: 240,
    gravity: 0.15,
    packComponents: true,
    tilingPaddingVertical: 70,
    tilingPaddingHorizontal: 70,
  };
}

// Lighten (f>0, toward white) or darken (f<0, toward black) a #rrggbb colour.
function adjust(hex: string, f: number): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const mix = (x: number) => (f >= 0 ? Math.round(x + (255 - x) * f) : Math.round(x * (1 + f)));
  const hx = (x: number) => mix(x).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

// Soft white specular glint, laid over each orb's upper-left for a glossy 3D highlight.
const SPECULAR_GLINT =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs><radialGradient id="g" cx="50%" cy="50%" r="50%">' +
      '<stop offset="0%" stop-color="#fff" stop-opacity="0.95"/>' +
      '<stop offset="55%" stop-color="#fff" stop-opacity="0.18"/>' +
      '<stop offset="100%" stop-color="#fff" stop-opacity="0"/>' +
      '</radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#g)"/></svg>',
  );

function buildElements(data: GraphResponse): ElementDefinition[] {
  // Degree → node size, so well-connected articles look like hub "neurons".
  const degree = new Map<string, number>();
  for (const e of data.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const pcolors = pillarColorMap(data.nodes);
  const elements: ElementDefinition[] = [];
  for (const n of data.nodes) {
    const d = degree.get(n.id) ?? 0;
    const size = 22 + Math.min(d, 8) * 5;
    const color = pcolors.get(n.productPillar || 'NONE')?.color ?? NONE_COLOR;
    elements.push({
      data: {
        id: n.id,
        label: n.label,
        slug: n.slug,
        productArea: n.productArea ?? 'NONE',
        productPillar: n.productPillar ?? 'NONE',
        difficulty: n.difficulty,
        status: n.status,
        color,
        // light highlight → base → dark edge: the radial gradient that makes the orb look 3D.
        grad: `${adjust(color, 0.55)} ${color} ${adjust(color, -0.5)}`,
        rim: adjust(color, 0.35),
        size,
      },
    });
  }
  for (const e of data.edges) {
    elements.push({
      data: {
        id: `${e.source}-${e.target}-${e.type}`,
        source: e.source,
        target: e.target,
        type: e.type,
      },
    });
  }
  return elements;
}

const STYLE = [
  {
    selector: 'node',
    style: {
      // Glossy 3D orb: radial-gradient body (light centre → base → dark rim) + a specular glint,
      // a thin lighter Fresnel rim, and a soft dark contact shadow underneath.
      'background-color': 'data(color)',
      'background-fill': 'radial-gradient',
      'background-gradient-stop-colors': 'data(grad)',
      'background-gradient-stop-positions': '0 52 100',
      'background-image': SPECULAR_GLINT,
      'background-image-opacity': 0.5,
      'background-width': '52%',
      'background-height': '52%',
      'background-position-x': '30%',
      'background-position-y': '22%',
      'background-fit': 'none',
      'background-clip': 'node',
      width: 'data(size)',
      height: 'data(size)',
      'border-width': 1,
      'border-color': 'data(rim)',
      'border-opacity': 0.5,
      'underlay-color': '#000000',
      'underlay-opacity': 0.45,
      'underlay-padding': 3,
      // Readable label: app sans, sentence case, on a solid dark pill.
      label: 'data(label)',
      'font-family': 'Inter, system-ui, sans-serif',
      color: '#eef0f3',
      'font-size': 10,
      'font-weight': 600,
      'text-wrap': 'wrap',
      'text-max-width': '140px',
      'text-valign': 'bottom',
      'text-margin-y': 6,
      'text-background-color': '#0c0c11',
      'text-background-opacity': 0.82,
      'text-background-shape': 'roundrectangle',
      'text-background-padding': 4,
      'min-zoomed-font-size': 8,
      'transition-property': 'border-width, border-color, underlay-opacity, underlay-padding, opacity',
      'transition-duration': 150,
    },
  },
  {
    selector: 'node[status = "DRAFT"]',
    style: { 'border-style': 'dashed', 'border-color': '#ffcf5c', 'border-opacity': 0.95, 'border-width': 1.5 },
  },
  { selector: 'node[status = "ARCHIVED"]', style: { opacity: 0.4 } },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      width: 1.6,
      'line-color': '#7c828d',
      opacity: 0.8,
      'line-cap': 'round',
    },
  },
  {
    selector: 'edge[type = "prerequisite"]',
    style: {
      'line-color': '#bcc1c9',
      'target-arrow-color': '#bcc1c9',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 1,
      width: 2,
    },
  },
  {
    selector: 'edge[type = "related"]',
    style: {
      'line-color': '#71767f',
      'line-style': 'dashed',
      'line-dash-pattern': [5, 6],
      width: 1.5,
      opacity: 0.65,
    },
  },
  // Selected → gold ring + lifted (bigger) shadow.
  {
    selector: 'node:selected',
    style: {
      'border-color': '#ffcf5c',
      'border-width': 2.5,
      'border-opacity': 1,
      'underlay-opacity': 0.55,
      'underlay-padding': 7,
    },
  },
  { selector: '.faded', style: { opacity: 0.12 } },
  // Cheap hover highlight for large graphs: brighten the hovered node's edges (no global dim).
  {
    selector: 'edge.hl',
    style: { 'line-color': '#cfd3da', opacity: 1, width: 2.4, 'z-index': 15 },
  },
  // Hover → white ring + lifted shadow + brighter, larger label.
  {
    selector: '.glow',
    style: {
      'border-color': '#ffffff',
      'border-width': 2.5,
      'border-opacity': 1,
      'underlay-opacity': 0.55,
      'underlay-padding': 7,
      color: '#ffffff',
      'font-size': 12,
      'z-index': 20,
    },
  },
  { selector: '.lit', style: { opacity: 1 } },
  { selector: '.dim', style: { opacity: 0.18 } },
  // Spotlight (where a chat answer came from) → gold halo + ring.
  { selector: '.src-faded', style: { opacity: 0.12 } },
  {
    selector: '.src-glow',
    style: {
      'underlay-color': '#ffcf5c',
      'underlay-opacity': 0.7,
      'underlay-padding': 10,
      'border-color': '#fff0c2',
      'border-width': 2.5,
      'border-opacity': 1,
      color: '#ffffff',
      'font-size': 12,
      'z-index': 30,
      opacity: 1,
    },
  },
  { selector: '.src-hot', style: { 'underlay-opacity': 1, 'underlay-padding': 16 } },
];

function applyAreaHighlight() {
  if (!cy) return;
  const area = props.highlightArea;
  cy.elements().removeClass('dim');
  if (!area) return;
  cy.nodes().addClass('dim');
  cy.edges().addClass('dim');
  cy.nodes(`[productArea = "${area}"]`).removeClass('dim');
}

// Continuously slide every edge's dash pattern so the connections look like live data in
// transit (flowing from source → target). Cheap: one batched style write per frame.
function animateFlow() {
  flowRaf = requestAnimationFrame(animateFlow);
  // OFF for large graphs (flowSkip 0), or paused while the viewport is moving — in both cases the
  // scene isn't repainted, so a big graph sits idle instead of churning every frame.
  if (!cy || viewportInteracting || flowSkip === 0) return;
  // Throttle: only update every flowSkip-th frame, but advance the dash proportionally so the
  // perceived flow SPEED stays constant regardless of how much we skip.
  if (++flowFrame < flowSkip) return;
  flowFrame = 0;
  flowOffset = (flowOffset - 0.6 * flowSkip) % 12; // 12 = dash(6) + gap(6) → seamless wrap
  cy.edges().style('line-dash-offset', flowOffset);
}

// ---- Neo4j-style live drag physics (no extra deps) -------------------------
// fcose still owns the initial/data-change arrangement. This hand-written spring
// integrator runs ONLY while a node is held plus a short settle, then self-terminates,
// so idle CPU stays at just the pre-existing dash-flow rAF.
const SPRING = {
  k: 0.015, // edge spring stiffness (pull toward ideal length)
  ideal: IDEAL_EDGE_LENGTH, // == fcose so it settles to the same scale
  repel: 9000, // node-node Coulomb repulsion constant
  repelRange: 220, // ignore repulsion beyond this (keeps it O(neighbors), cheap)
  homePull: 0.004, // weak pull back to fcose resting pos (hx,hy) so the graph doesn't drift
  damping: 0.82, // velocity retained per frame (springy-but-settling feel)
  maxV: 35, // clamp px/frame to avoid blowups on dense hubs
  quietV: 0.25, // mean speed below which we declare "settled" and stop the rAF
};

let physRaf: number | null = null;
let activeSet: NodeCollection | null = null; // nodes we integrate during a drag
let pinned: NodeSingular | null = null; // the grabbed node (integrator's fixed point)
let quietFrames = 0;
let frameCount = 0; // hard backstop so the loop can never run forever
let draggedThisHold = false; // did the current grab actually move? (drag vs. plain tap)

// Record fcose's resting position on each node so released neighbors have a "home"
// to ease back toward, and a fresh fcose run (data change) re-seeds it.
function seedHomePositions() {
  if (!cy) return;
  cy.nodes().forEach((n) => {
    n.data('hx', n.position('x'));
    n.data('hy', n.position('y'));
  });
  homesSeeded = true;
}

// ---- Label-aware overlap removal --------------------------------------------
// fcose (especially the draft/spectral arrangement used for big graphs) packs a dense small-world
// graph tightly and is blind to LABEL size — so the ~140px-wide label pills pile into an unreadable
// wall even when the orbs themselves are roughly placed. Force layouts only *reduce* overlap, never
// eliminate it. This deterministic pass guarantees readable spacing: scale the whole layout out to a
// low target density, then run Gauss-Seidel AABB separation sweeps (spatial-hashed, O(n) per sweep)
// on each node's LABEL-INCLUSIVE box until no boxes overlap. One-time, after the layout settles.
// Measured ~225ms on the live 1068-node graph; residual overlaps are all sub-pixel.
const OVERLAP_PAD = 12; // px of breathing room added around every label box
const OVERLAP_AREA_MULT = 4; // target: label boxes fill ~1/4 of the spread → comfortable spacing
const OVERLAP_MAX_ITER = 200;
const GRID_OFFSET = 1_000_000; // keeps spatial-hash cell keys positive without bitwise ops

function removeLabelOverlaps() {
  if (!cy) return;
  const nodes = cy.nodes();
  const N = nodes.length;
  if (N < 2) return;

  const X = new Float64Array(N);
  const Y = new Float64Array(N);
  const HW = new Float64Array(N); // half-width incl. label
  const HH = new Float64Array(N); // half-height incl. label
  let cenX = 0;
  let cenY = 0;
  let sumArea = 0;
  nodes.forEach((n, i) => {
    const bb = n.boundingBox(); // label-inclusive, model coords
    const p = n.position();
    // Symmetrise half-extents (the label sits below the orb) so AABB separation always clears the
    // real box on both sides.
    HW[i] = Math.max(p.x - bb.x1, bb.x2 - p.x) + OVERLAP_PAD;
    HH[i] = Math.max(p.y - bb.y1, bb.y2 - p.y) + OVERLAP_PAD;
    X[i] = p.x;
    Y[i] = p.y;
    cenX += p.x;
    cenY += p.y;
    sumArea += 4 * HW[i] * HH[i];
  });
  cenX /= N;
  cenY /= N;

  // Deterministic PRNG (no Math.random) so the same graph lays out identically across reloads.
  let seed = (0x9e3779b9 ^ N) >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Break exact coincidences (spectral layout stacks dense-graph nodes) so separation has a
  // direction to push.
  for (let i = 0; i < N; i++) {
    X[i] += (rnd() - 0.5) * 30;
    Y[i] += (rnd() - 0.5) * 30;
  }

  // Scale the layout out about its centroid to the target density. Never compress (scale >= 1), so
  // an already-sparse small graph is left at its natural size.
  const eb = cy.elements().boundingBox();
  const curArea = Math.max(1, eb.w * eb.h);
  const scale = Math.max(1, Math.sqrt((sumArea * OVERLAP_AREA_MULT) / curArea));
  for (let i = 0; i < N; i++) {
    X[i] = cenX + (X[i] - cenX) * scale;
    Y[i] = cenY + (Y[i] - cenY) * scale;
  }

  // Spatial-hash grid; cell = 2× the largest half-extent so any overlapping pair is within the 3×3
  // neighbourhood of cells.
  let maxHalf = 1;
  for (let i = 0; i < N; i++) maxHalf = Math.max(maxHalf, HW[i], HH[i]);
  const cell = maxHalf * 2;
  const cellKey = (gx: number, gy: number) => (gx + GRID_OFFSET) * 4_000_000 + (gy + GRID_OFFSET);

  for (let it = 0; it < OVERLAP_MAX_ITER; it++) {
    const grid = new Map<number, number[]>();
    for (let i = 0; i < N; i++) {
      const k = cellKey(Math.floor(X[i] / cell), Math.floor(Y[i] / cell));
      const bucket = grid.get(k);
      if (bucket) bucket.push(i);
      else grid.set(k, [i]);
    }
    let moved = 0;
    for (let i = 0; i < N; i++) {
      const gx = Math.floor(X[i] / cell);
      const gy = Math.floor(Y[i] / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get(cellKey(gx + ox, gy + oy));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            let dx = X[j] - X[i];
            let dy = Y[j] - Y[i];
            if (dx === 0 && dy === 0) {
              dx = rnd() - 0.5;
              dy = rnd() - 0.5;
            }
            const px = HW[i] + HW[j] - Math.abs(dx);
            const py = HH[i] + HH[j] - Math.abs(dy);
            if (px > 0 && py > 0) {
              moved++;
              // Resolve along the axis of least penetration (cheapest separation → fast convergence).
              if (px < py) {
                const s = ((dx >= 0 ? 1 : -1) * px) / 2;
                X[i] -= s;
                X[j] += s;
              } else {
                const s = ((dy >= 0 ? 1 : -1) * py) / 2;
                Y[i] -= s;
                Y[j] += s;
              }
            }
          }
        }
      }
    }
    if (moved === 0) break;
  }

  cy.batch(() => {
    nodes.forEach((n, i) => {
      n.position({ x: X[i], y: Y[i] });
    });
  });
}

// Fit the whole (now wide) spread in view and lower the zoom floor so it can actually be seen at
// once — a 1068-node spread fits at ~0.06 zoom, which the default 0.2 floor would clip. Small graphs
// keep the normal floor.
function fitToSpread() {
  if (!cy || !container.value) return;
  const bb = cy.elements().boundingBox();
  const pad = 30;
  const w = container.value.clientWidth || cy.width();
  const h = container.value.clientHeight || cy.height();
  const fitZoom = Math.min((w - pad * 2) / Math.max(1, bb.w), (h - pad * 2) / Math.max(1, bb.h));
  cy.minZoom(Math.min(0.2, fitZoom * 0.8));
  cy.fit(undefined, pad);
}

// Post-layout pipeline: spread labels apart, record the new resting positions for the drag solver,
// then frame the result. Wired to fcose's 'layoutstop' on first paint and on every data change.
function afterLayoutSettled() {
  removeLabelOverlaps();
  seedHomePositions();
  fitToSpread();
}

function numScratch(n: NodeSingular, key: string): number {
  const v = n.scratch(key);
  return typeof v === 'number' ? v : 0;
}

function stepPhysics() {
  if (!cy || !activeSet) {
    physRaf = null;
    return;
  }
  const nodes = activeSet;
  const accel = new Map<string, [number, number]>();
  nodes.forEach((n) => {
    accel.set(n.id(), [0, 0]);
  });

  // Edge springs (any edge with an endpoint in the active set).
  nodes.connectedEdges().forEach((e) => {
    const s = e.source();
    const t = e.target();
    const sp = s.position();
    const tp = t.position();
    const dx = tp.x - sp.x;
    const dy = tp.y - sp.y;
    const dist = Math.hypot(dx, dy) || 0.01;
    const f = SPRING.k * (dist - SPRING.ideal);
    const fx = (dx / dist) * f;
    const fy = (dy / dist) * f;
    const sa = accel.get(s.id());
    if (sa) {
      sa[0] += fx;
      sa[1] += fy;
    }
    const ta = accel.get(t.id());
    if (ta) {
      ta[0] -= fx;
      ta[1] -= fy;
    }
  });

  // Pairwise repulsion within the (small) active set + weak home pull.
  const arr = nodes.toArray();
  for (let i = 0; i < arr.length; i++) {
    const ni = arr[i];
    const pi = ni.position();
    const ai = accel.get(ni.id());
    if (!ai) continue;
    for (let j = i + 1; j < arr.length; j++) {
      const nj = arr[j];
      const pj = nj.position();
      const dx = pi.x - pj.x;
      const dy = pi.y - pj.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > SPRING.repelRange * SPRING.repelRange) continue;
      const d = Math.sqrt(d2) || 0.01;
      // Floor d2 so two coincident nodes can't yield Infinity → NaN (NaN slips past the maxV
      // clamp and would permanently corrupt positions). Direction still uses the guarded d.
      const f = SPRING.repel / Math.max(d2, 0.01);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      ai[0] += fx;
      ai[1] += fy;
      const aj = accel.get(nj.id());
      if (aj) {
        aj[0] -= fx;
        aj[1] -= fy;
      }
    }
    const hx = ni.data('hx');
    const hy = ni.data('hy');
    if (typeof hx === 'number' && typeof hy === 'number') {
      ai[0] += (hx - pi.x) * SPRING.homePull;
      ai[1] += (hy - pi.y) * SPRING.homePull;
    }
  }

  // Integrate (Verlet-ish with damping). Skip the held node (cytoscape's drag owns it) and any
  // node the user has dropped/pinned ('_fixed'), so dropped nodes STAY exactly where placed
  // (Neo4j-style) while their neighbors settle around them.
  let sumV = 0;
  let moved = 0;
  nodes.forEach((n) => {
    if ((pinned && n.same(pinned)) || n.grabbed() || n.scratch('_fixed')) return;
    const a = accel.get(n.id());
    if (!a) return;
    let vx = numScratch(n, '_vx') * SPRING.damping + a[0];
    let vy = numScratch(n, '_vy') * SPRING.damping + a[1];
    // Defence-in-depth: never let a non-finite value reach node.position() — it would persist in
    // scratch and corrupt the node on every later frame.
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
      vx = 0;
      vy = 0;
    }
    const v = Math.hypot(vx, vy);
    if (v > SPRING.maxV) {
      vx = (vx / v) * SPRING.maxV;
      vy = (vy / v) * SPRING.maxV;
    }
    n.scratch('_vx', vx);
    n.scratch('_vy', vy);
    const p = n.position();
    n.position({ x: p.x + vx, y: p.y + vy });
    sumV += Math.hypot(vx, vy);
    moved++;
  });

  // Quiesce: once released AND motion is tiny for a few frames, stop the loop. The frame cap is a
  // hard backstop so the loop can never run indefinitely (e.g. a boundary node jittering just
  // above quietV) — ~600 frames ≈ 10s.
  const meanV = moved ? sumV / moved : 0;
  if (!pinned && meanV < SPRING.quietV) {
    quietFrames++;
    if (quietFrames > 8) {
      stopPhysics();
      return;
    }
  } else {
    quietFrames = 0;
  }
  if (++frameCount > 600) {
    stopPhysics();
    return;
  }
  physRaf = requestAnimationFrame(stepPhysics);
}

function startPhysics(grabbed: NodeSingular) {
  if (!cy) return;
  // Stop fcose's tween (if still animating) so it doesn't fight the drag, and make sure each
  // node has a 'home' recorded before homePull can reference it.
  currentLayout?.stop();
  if (!homesSeeded) seedHomePositions();
  pinned = grabbed;
  // Active set = grabbed node + neighborhood out to 2 hops (bounds CPU on big graphs).
  const oneHop = grabbed.closedNeighborhood();
  activeSet = oneHop.union(oneHop.neighborhood()).nodes();
  activeSet.forEach((n) => {
    n.scratch('_vx', 0);
    n.scratch('_vy', 0);
  });
  quietFrames = 0;
  frameCount = 0;
  if (physRaf === null) physRaf = requestAnimationFrame(stepPhysics);
}

function stopPhysics() {
  if (physRaf !== null) cancelAnimationFrame(physRaf);
  physRaf = null;
  activeSet = null;
  pinned = null;
  quietFrames = 0;
}

let spotlightTimers: number[] = [];
// Spotlight the article node(s) an answer came from: glow them, dim the rest, fly the camera
// to them, pulse a few times, then release the dim so the graph keeps flowing.
function applySpotlight() {
  if (!cy) return;
  spotlightTimers.forEach((t) => clearTimeout(t));
  spotlightTimers = [];
  cy.elements().removeClass('src-faded src-glow src-hot');
  const slugs = props.spotlightSlugs;
  if (!slugs || !slugs.length) return;
  const want = new Set(slugs);
  const sources = cy.nodes().filter((n) => want.has(n.data('slug') as string));
  if (!sources.length) return;
  const focus = sources.closedNeighborhood();
  cy.elements().addClass('src-faded');
  focus.removeClass('src-faded');
  sources.addClass('src-glow');
  cy.animate({ fit: { eles: focus, padding: 90 }, duration: 700, easing: 'ease-in-out' } as never);
  let n = 0;
  const pulse = () => {
    if (!cy) return;
    sources.toggleClass('src-hot');
    n += 1;
    if (n < 6) {
      spotlightTimers.push(window.setTimeout(pulse, 340));
    } else {
      sources.removeClass('src-hot');
      // Release the dim after the pulse; leave a lingering glow on the source nodes.
      spotlightTimers.push(window.setTimeout(() => cy?.elements().removeClass('src-faded'), 400));
    }
  };
  pulse();
}

function mountCy() {
  if (!container.value) return;
  cy = cytoscape({
    container: container.value,
    elements: buildElements(props.data),
    style: STYLE as never,
    minZoom: 0.2,
    maxZoom: 2.5,
    // A touch snappier per wheel tick so zooming a big graph needs fewer scrolls.
    wheelSensitivity: 0.3,
    // Large-graph scroll performance: while the user is panning/zooming, don't redraw every edge —
    // render a cached low-res texture and hide edges during the motion, then snap back to the full
    // crisp scene once it stops. This is what keeps scroll-zoom smooth with thousands of edges.
    hideEdgesOnViewport: true,
    textureOnViewport: true,
  });

  // Run fcose once and seed home positions after it settles (positions aren't placed until
  // 'layoutstop' when animate:true). Track the instance so a drag can stop the tween and
  // teardown can cancel a pending 'layoutstop'.
  homesSeeded = false;
  currentLayout = cy.layout(fcoseOpts(cy.nodes().length) as never);
  currentLayout.one('layoutstop', afterLayoutSettled);
  currentLayout.run();

  cy.on('tap', 'node', (evt) => {
    const node = evt.target.data() as GraphNode & { color: string };
    emit('select-node', node);
  });

  // "Fire the neuron": light a node + its connections, dim the rest. On LARGE graphs the global dim
  // is replaced by a cheap local highlight (hovered node + its edges) — dimming every element costs
  // ~80ms per hover at scale (measured), which is the interaction lag; the local highlight is ~2ms.
  cy.on('mouseover', 'node', (evt) => {
    if (!cy) return;
    if (container.value) container.value.style.cursor = 'pointer';
    if (cy.elements().length > HOVER_DIM_MAX) {
      evt.target.addClass('glow');
      evt.target.connectedEdges().addClass('hl');
      return;
    }
    const nb = evt.target.closedNeighborhood();
    cy.elements().addClass('faded');
    nb.removeClass('faded');
    evt.target.addClass('glow');
  });
  cy.on('mouseout', 'node', (evt) => {
    if (!cy) return;
    if (container.value) container.value.style.cursor = 'default';
    if (cy.elements().length > HOVER_DIM_MAX) {
      // Remove only what we added (same node → same edges), never touching every element.
      evt.target.removeClass('glow');
      evt.target.connectedEdges().removeClass('hl');
      return;
    }
    cy.elements().removeClass('faded glow');
    applyAreaHighlight();
  });

  // ---- Neo4j-style live drag: spring physics gated to the held interaction. ----
  // 'grab': start the bounded physics loop so neighbors flex live while the node is held.
  cy.on('grab', 'node', (evt) => {
    draggedThisHold = false;
    startPhysics(evt.target as NodeSingular);
  });
  // 'drag' fires continuously as cytoscape moves the held node to the cursor; the held node is
  // auto-excluded from the integrator (n.grabbed()/pinned). Record that this hold actually moved
  // (so a plain tap doesn't pin), and re-arm the loop if it had quiesced mid-hold.
  cy.on('drag', 'node', (evt) => {
    draggedThisHold = true;
    if (physRaf === null) startPhysics(evt.target as NodeSingular);
  });
  // 'free' (release): if the node was actually DRAGGED, pin it where it was dropped (Neo4j-style —
  // the integrator skips '_fixed' nodes, so it stays exactly put while neighbors settle around it)
  // and re-anchor its home there. A plain tap leaves it unpinned. Dropping the active pin lets the
  // quietV check self-terminate the loop.
  cy.on('free', 'node', (evt) => {
    const n = evt.target as NodeSingular;
    if (draggedThisHold) {
      n.scratch('_fixed', true);
      n.data('hx', n.position('x'));
      n.data('hy', n.position('y'));
    }
    draggedThisHold = false;
    pinned = null;
    quietFrames = 0;
    frameCount = 0; // give the post-release settle a fresh budget (avoids freeze after a long hold)
    if (physRaf === null && activeSet) physRaf = requestAnimationFrame(stepPhysics);
  });

  // Pan/zoom fires 'viewport' rapidly; flag "interacting" so animateFlow pauses the heavy edge
  // restyle, then clear it ~180ms after the last motion so the flow effect resumes when idle.
  cy.on('viewport', () => {
    viewportInteracting = true;
    if (viewportIdleTimer !== null) clearTimeout(viewportIdleTimer);
    viewportIdleTimer = window.setTimeout(() => {
      viewportInteracting = false;
    }, 180);
  });

  applyAreaHighlight();
  computeFlowSkip();
  if (flowRaf === null) flowRaf = requestAnimationFrame(animateFlow);
}

watch(
  () => props.data,
  (next) => {
    if (!cy) return;
    // Stop the live solver + any in-flight fcose tween BEFORE mutating elements so neither ticks
    // against removed nodes (and a stale 'layoutstop' can't re-seed a dead arrangement).
    stopPhysics();
    currentLayout?.stop();
    spotlightTimers.forEach((t) => clearTimeout(t));
    spotlightTimers = [];
    homesSeeded = false;
    cy.elements().remove();
    cy.add(buildElements(next));
    computeFlowSkip();
    currentLayout = cy.layout(fcoseOpts(cy.nodes().length) as never);
    currentLayout.one('layoutstop', afterLayoutSettled);
    currentLayout.run();
    applyAreaHighlight();
  },
  { deep: false },
);

watch(() => props.highlightArea, applyAreaHighlight);
watch(() => props.spotlightSlugs, applySpotlight);

onMounted(mountCy);
onBeforeUnmount(() => {
  if (flowRaf !== null) cancelAnimationFrame(flowRaf);
  if (viewportIdleTimer !== null) clearTimeout(viewportIdleTimer);
  stopPhysics();
  currentLayout?.stop();
  currentLayout = null;
  spotlightTimers.forEach((t) => clearTimeout(t));
  cy?.destroy();
  cy = null;
});
</script>

<template>
  <div class="relative gv-wrap" :class="{ 'is-frameless': frameless }">
    <div
      ref="container"
      class="w-full"
      :class="[heightClass ?? 'h-[640px]', frameless ? '' : 'rounded-btn border border-[#2a2a33]']"
      style="background: radial-gradient(circle at 50% 38%, #20202a 0%, #15151b 58%, #0c0c10 100%)"
    />

    <!-- subtle depth vignette (non-interactive) -->
    <div class="gv-vignette" aria-hidden="true" />

    <!-- legend (reflects the actual data on screen) -->
    <div class="gv-legend">
      <div class="gv-legend-head">Legend</div>
      <div v-for="a in legendAreas" :key="a.key" class="row">
        <span class="dot" :style="{ '--c': a.color }" /> {{ a.label }}
      </div>
      <div v-if="hasPrereqEdges" class="row"><span class="ln solid" /> Prerequisite</div>
      <div v-if="hasRelatedEdges" class="row"><span class="ln dash" /> Related</div>
      <div class="gv-legend-foot">{{ nodeCount }} nodes · {{ edgeCount }} links</div>
    </div>

    <!-- controls hint -->
    <div class="gv-hint">Hover a node to highlight its links · drag to rearrange · scroll to zoom</div>
  </div>
</template>

<style scoped>
.gv-wrap {
  isolation: isolate;
}
.gv-vignette,
.gv-legend,
.gv-hint {
  pointer-events: none;
}

/* soft inner shadow gives the canvas a touch of depth without clutter */
.gv-vignette {
  position: absolute;
  inset: 0;
  border-radius: 10px;
  box-shadow: inset 0 0 90px rgba(0, 0, 0, 0.55);
}
.is-frameless .gv-vignette {
  border-radius: 0;
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
/* mini glossy orb to match the nodes */
.gv-legend .dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.85), var(--c) 55%, rgba(0, 0, 0, 0.45) 130%);
}
.gv-legend .ln {
  width: 18px;
  height: 0;
}
.gv-legend .ln.solid {
  border-top: 2px solid #bcc1c9;
}
.gv-legend .ln.dash {
  border-top: 2px dashed #71767f;
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
