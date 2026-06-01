<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
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

const container = ref<HTMLDivElement | null>(null);
let cy: Core | null = null;
// Drives the "data travelling along the connections" flow animation.
let flowRaf: number | null = null;
let flowOffset = 0;

// Neon palette reads well on the dark "neural" canvas.
const AREA_COLORS: Record<string, string> = {
  SG_CORE: '#ff3b6b',
  SG_MODULES: '#22d3ee',
  SG_DASHBOARD: '#fbbf24',
  NONE: '#a78bfa',
};

function buildElements(data: GraphResponse): ElementDefinition[] {
  // Degree → node size, so well-connected articles look like hub "neurons".
  const degree = new Map<string, number>();
  for (const e of data.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const elements: ElementDefinition[] = [];
  for (const n of data.nodes) {
    const d = degree.get(n.id) ?? 0;
    const size = 20 + Math.min(d, 8) * 5;
    elements.push({
      data: {
        id: n.id,
        label: n.label,
        slug: n.slug,
        productArea: n.productArea ?? 'NONE',
        difficulty: n.difficulty,
        status: n.status,
        color: AREA_COLORS[n.productArea ?? 'NONE'] ?? AREA_COLORS.NONE,
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
      'background-color': 'data(color)',
      'background-opacity': 0.95,
      'underlay-color': 'data(color)',
      'underlay-opacity': 0.45,
      'underlay-padding': 6,
      width: 'data(size)',
      height: 'data(size)',
      'border-width': 1,
      'border-color': 'rgba(255,255,255,0.7)',
      label: 'data(label)',
      color: '#e2e8f0',
      'font-size': 9,
      'font-weight': 500,
      'text-wrap': 'wrap',
      'text-max-width': '110px',
      'text-valign': 'bottom',
      'text-margin-y': 6,
      'text-background-color': '#05070d',
      'text-background-opacity': 0.7,
      'text-background-shape': 'roundrectangle',
      'text-background-padding': 3,
      'min-zoomed-font-size': 7,
      'transition-property': 'underlay-opacity, underlay-padding, border-width, opacity',
      'transition-duration': 150,
    },
  },
  { selector: 'node[status = "DRAFT"]', style: { 'border-style': 'dashed', 'border-color': '#fbbf24' } },
  { selector: 'node[status = "ARCHIVED"]', style: { opacity: 0.4 } },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      width: 1.6,
      opacity: 0.55,
      'underlay-opacity': 0,
      // Dashed line + a continuously-sliding dash offset (see animateFlow) makes each
      // connection read as live data travelling between the articles.
      'line-style': 'dashed',
      'line-dash-pattern': [6, 6],
    },
  },
  {
    selector: 'edge[type = "prerequisite"]',
    style: {
      'line-color': '#22d3ee',
      'target-arrow-color': '#22d3ee',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.8,
      'underlay-color': '#22d3ee',
      'underlay-opacity': 0.12,
      'underlay-padding': 2,
    },
  },
  {
    selector: 'edge[type = "related"]',
    style: {
      'line-color': '#a78bfa',
      'line-style': 'dashed',
      'underlay-color': '#a78bfa',
      'underlay-opacity': 0.1,
      'underlay-padding': 2,
    },
  },
  { selector: 'node:selected', style: { 'border-color': '#ffffff', 'border-width': 3, 'underlay-opacity': 0.6 } },
  { selector: '.faded', style: { opacity: 0.07 } },
  {
    selector: '.glow',
    style: {
      'underlay-opacity': 0.65,
      'border-color': '#ffffff',
      'border-width': 2,
      color: '#ffffff',
      'font-size': 11,
      'z-index': 20,
    },
  },
  { selector: '.lit', style: { opacity: 1 } },
  { selector: '.dim', style: { opacity: 0.12 } },
  // Spotlight (where a chat answer came from)
  { selector: '.src-faded', style: { opacity: 0.07 } },
  {
    selector: '.src-glow',
    style: {
      'underlay-opacity': 0.7,
      'underlay-padding': 10,
      'border-color': '#ffffff',
      'border-width': 2.5,
      color: '#ffffff',
      'font-size': 11,
      'z-index': 30,
      opacity: 1,
    },
  },
  { selector: '.src-hot', style: { 'underlay-opacity': 1, 'underlay-padding': 18 } },
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
  if (cy) {
    flowOffset = (flowOffset - 0.6) % 12; // 12 = dash(6) + gap(6) → seamless wrap
    cy.edges().style('line-dash-offset', flowOffset);
  }
  flowRaf = requestAnimationFrame(animateFlow);
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
    layout: {
      name: 'fcose',
      animate: true,
      randomize: true,
      nodeRepulsion: 16000,
      idealEdgeLength: 130,
      nodeSeparation: 180,
      gravity: 0.2,
      packComponents: true,
      tilingPaddingVertical: 70,
      tilingPaddingHorizontal: 70,
    } as never,
    minZoom: 0.2,
    maxZoom: 2.5,
    wheelSensitivity: 0.2,
  });

  cy.on('tap', 'node', (evt) => {
    const node = evt.target.data() as GraphNode & { color: string };
    emit('select-node', node);
  });

  // "Fire the neuron": light a node + its connections, dim the rest.
  cy.on('mouseover', 'node', (evt) => {
    if (!cy) return;
    const nb = evt.target.closedNeighborhood();
    cy.elements().addClass('faded');
    nb.removeClass('faded');
    evt.target.addClass('glow');
    if (container.value) container.value.style.cursor = 'pointer';
  });
  cy.on('mouseout', 'node', () => {
    if (!cy) return;
    cy.elements().removeClass('faded glow');
    applyAreaHighlight();
    if (container.value) container.value.style.cursor = 'default';
  });

  applyAreaHighlight();
  if (flowRaf === null) flowRaf = requestAnimationFrame(animateFlow);
}

watch(
  () => props.data,
  (next) => {
    if (!cy) return;
    cy.elements().remove();
    cy.add(buildElements(next));
    cy.layout({
      name: 'fcose',
      animate: true,
      randomize: true,
      nodeRepulsion: 16000,
      idealEdgeLength: 130,
      nodeSeparation: 180,
      gravity: 0.2,
      tilingPaddingVertical: 70,
      tilingPaddingHorizontal: 70,
    } as never).run();
    applyAreaHighlight();
  },
  { deep: false },
);

watch(() => props.highlightArea, applyAreaHighlight);
watch(() => props.spotlightSlugs, applySpotlight);

onMounted(mountCy);
onBeforeUnmount(() => {
  if (flowRaf !== null) cancelAnimationFrame(flowRaf);
  spotlightTimers.forEach((t) => clearTimeout(t));
  cy?.destroy();
});
</script>

<template>
  <div class="relative">
    <div
      ref="container"
      class="w-full"
      :class="[heightClass ?? 'h-[640px]', frameless ? '' : 'rounded-btn border border-[#1e293b]']"
      style="background: radial-gradient(circle at 50% 35%, #16203a 0%, #0a0f1d 60%, #05070d 100%);"
    />
    <div
      class="absolute top-3 right-3 bg-black/40 backdrop-blur px-3 py-2 rounded-btn border border-white/10 text-xs space-y-1 text-slate-200"
    >
      <div class="font-semibold mb-1">Legend</div>
      <div class="flex items-center gap-2">
        <span class="inline-block w-3 h-3 rounded-full" style="background:#ff3b6b;box-shadow:0 0 6px #ff3b6b" />
        SG Core
      </div>
      <div class="flex items-center gap-2">
        <span class="inline-block w-3 h-3 rounded-full" style="background:#22d3ee;box-shadow:0 0 6px #22d3ee" />
        SG Modules
      </div>
      <div class="flex items-center gap-2">
        <span class="inline-block w-3 h-3 rounded-full" style="background:#fbbf24;box-shadow:0 0 6px #fbbf24" />
        SG Dashboard
      </div>
      <div class="flex items-center gap-2">
        <span class="inline-block w-6 h-px" style="background:#22d3ee" /> Prerequisite
      </div>
      <div class="flex items-center gap-2">
        <span class="inline-block w-6 border-t border-dashed" style="border-color:#a78bfa" /> Related
      </div>
    </div>
    <div class="absolute bottom-3 left-3 text-[10px] text-slate-400/80">
      Hover a node to light up its connections · scroll to zoom · drag to pan
    </div>
  </div>
</template>
