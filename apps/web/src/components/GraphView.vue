<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch } from 'vue';
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
const DIM = 'rgba(120,126,136,0.16)';

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
}

const container = ref<HTMLDivElement | null>(null);
let graph: ForceGraph3DInstance | null = null;
let resizeObs: ResizeObserver | null = null;

// Map the shared GraphResponse → 3d-force-graph's {nodes, links}. Fresh objects each call (the
// library mutates nodes/links in place with x/y/z + resolved link endpoints).
function buildData(data: GraphResponse): { nodes: GNode[]; links: LinkObject[] } {
  const degree = new Map<string, number>();
  for (const e of data.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
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
    // Degree → size, so hubs look like bigger "neuron" spheres.
    val: 1 + Math.min(degree.get(n.id) ?? 0, 12),
  }));
  const links = data.edges.map((e) => ({
    source: e.source,
    target: e.target,
    type: e.type,
  })) as unknown as LinkObject[];
  return { nodes, links };
}

// Spotlight (chat answer) wins; otherwise area-highlight dims non-matching nodes; otherwise the
// node's own pillar colour.
function nodeColor(node: NodeObject): string {
  const n = node as GNode;
  const slugs = props.spotlightSlugs;
  if (slugs && slugs.length) return slugs.includes(n.slug) ? SPOTLIGHT : DIM;
  const area = props.highlightArea;
  if (area && n.productArea !== area) return DIM;
  return n.color;
}
function nodeVal(node: NodeObject): number {
  const n = node as GNode;
  const slugs = props.spotlightSlugs;
  return slugs && slugs.length && slugs.includes(n.slug) ? n.val * 2.4 : n.val;
}
function linkColor(link: LinkObject): string {
  return (link as { type?: string }).type === 'prerequisite' ? LINK_PREREQ : LINK_RELATED;
}

function refreshVisuals(): void {
  if (!graph) return;
  // Re-applying the accessors makes the library recompute node colours/sizes.
  graph.nodeColor(nodeColor).nodeVal(nodeVal);
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
  graph = new ForceGraph3D(container.value)
    .backgroundColor('#0c0c10')
    .graphData(buildData(props.data))
    .nodeRelSize(4)
    .nodeVal(nodeVal)
    .nodeColor(nodeColor)
    .nodeOpacity(1) // opaque → no per-frame transparency sort/blend
    .nodeResolution(6) // fewer triangles per sphere (cheaper at thousands of nodes)
    .nodeLabel('label') // shown as a tooltip on hover
    .linkColor(linkColor)
    .linkOpacity(0.22)
    .linkWidth(0)
    // ── Performance: the per-frame force sim is the main cost at scale. Pre-settle a few ticks
    // off-screen, then FREEZE the layout (cooldownTicks/Time) so it stops simulating and becomes a
    // static GPU render; disable node-drag so orbiting/clicking never re-heats the sim.
    .warmupTicks(30)
    .cooldownTicks(200)
    .cooldownTime(5000)
    .enableNodeDrag(false)
    .showNavInfo(false)
    .onNodeClick((node: NodeObject) => {
      const n = node as GNode;
      emit('select-node', {
        id: n.id,
        label: n.label,
        slug: n.slug,
        productArea: n.productArea,
        productPillar: n.productPillar,
        difficulty: n.difficulty,
        status: n.status,
      });
      // Ease the camera toward the clicked node.
      const at = { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 };
      graph?.cameraPosition({ x: at.x, y: at.y, z: at.z + 120 }, at, 800);
    });
  setSize();
  resizeObs = new ResizeObserver(setSize);
  resizeObs.observe(container.value);
}

watch(
  () => props.data,
  () => {
    if (graph) graph.graphData(buildData(props.data));
  },
  { deep: false },
);
watch(() => props.highlightArea, refreshVisuals);
watch(() => props.spotlightSlugs, () => {
  refreshVisuals();
  focusSpotlight();
});

onMounted(mountGraph);
onBeforeUnmount(() => {
  resizeObs?.disconnect();
  resizeObs = null;
  graph?._destructor?.();
  graph = null;
});
</script>

<template>
  <div class="relative gv-wrap min-w-0" :class="{ 'is-frameless': frameless }">
    <div
      ref="container"
      class="w-full overflow-hidden"
      :class="[heightClass ?? 'h-[640px]', frameless ? '' : 'rounded-btn border border-[#2a2a33]']"
      style="background: #0c0c10"
    />

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
