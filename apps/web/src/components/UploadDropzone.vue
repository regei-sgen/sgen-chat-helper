<script setup lang="ts">
import { ref } from 'vue';
import { UploadCloud, FolderUp } from 'lucide-vue-next';

const props = defineProps<{
  multiple?: boolean;
  accept?: string;
}>();

const emit = defineEmits<{
  files: [files: File[]];
}>();

const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const dirInput = ref<HTMLInputElement | null>(null);
// Inline feedback after a folder pick/drop (added N files / none found / error).
const folderNote = ref('');
const folderNoteOk = ref(false);
const scanning = ref(false);

// Minimal File System Access API shape (not in every TS DOM lib version yet).
type FsFileHandle = { kind: 'file'; name: string; getFile: () => Promise<File> };
type FsDirHandle = {
  kind: 'directory';
  name: string;
  values: () => AsyncIterable<FsFileHandle | FsDirHandle>;
};
type DirPicker = (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FsDirHandle>;

const isMarkdown = (name: string) => /\.(md|markdown)$/i.test(name);

// A folder pick/drop returns EVERY file in the tree, so keep only markdown — this also drops the
// junk OSes sprinkle in (.DS_Store, Thumbs.db, images…).
function markdownOnly(files: File[]): File[] {
  return files.filter((f) => isMarkdown(f.name));
}

function setFolderNote(found: number, scanned: number, label?: string) {
  const where = label ? ` from "${label}"` : '';
  if (found > 0) {
    folderNoteOk.value = true;
    folderNote.value = `Added ${found} markdown file${found === 1 ? '' : 's'}${where}. Add more anytime.`;
  } else {
    folderNoteOk.value = false;
    folderNote.value = scanned ? `No .md files found${where}.` : `No files found${where}.`;
  }
}

// ---- Folder drag-and-drop (works everywhere incl. Brave; no native dialog) ----
// Uses the legacy Entries API (webkitGetAsEntry) so dropping one or more folders reads their whole
// tree. This is the reliable path when the File System Access API is blocked (Brave) or a native
// folder dialog misbehaves.
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const acc: FileSystemEntry[] = [];
    const pump = () =>
      reader.readEntries((batch) => {
        if (!batch.length) resolve(acc);
        else {
          acc.push(...batch);
          pump(); // readEntries returns at most ~100 per call — keep going until empty
        }
      }, reject);
    pump();
  });
}

async function filesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) =>
      (entry as FileSystemFileEntry).file(
        (f) => resolve([f]),
        () => resolve([]),
      ),
    );
  }
  if (entry.isDirectory) {
    const entries = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    const nested = await Promise.all(entries.map(filesFromEntry));
    return nested.flat();
  }
  return [];
}

async function onDrop(e: DragEvent) {
  e.preventDefault();
  dragOver.value = false;
  folderNote.value = '';
  if (!e.dataTransfer) return;
  // Capture entries synchronously — DataTransferItems are only valid during the drop event.
  const entries = Array.from(e.dataTransfer.items ?? [])
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter((en): en is FileSystemEntry => !!en);

  if (entries.some((en) => en.isDirectory)) {
    scanning.value = true;
    try {
      const all = (await Promise.all(entries.map(filesFromEntry))).flat();
      const md = markdownOnly(all);
      setFolderNote(md.length, all.length);
      if (md.length) emit('files', md);
    } finally {
      scanning.value = false;
    }
    return;
  }

  // Plain file drop — unchanged behaviour.
  const files = Array.from(e.dataTransfer.files);
  emit('files', props.multiple ? files : files.slice(0, 1));
}

function onSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files) return;
  emit('files', Array.from(target.files));
  target.value = '';
}

// webkitdirectory input: the OS returns the whole tree as a flat FileList.
function onSelectFolder(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files) return;
  const all = Array.from(target.files);
  const md = markdownOnly(all);
  setFolderNote(md.length, all.length);
  if (md.length) emit('files', md);
  target.value = '';
}

// Recursively gather markdown via the File System Access API (cleanest folder picker where allowed).
async function collectMarkdown(dir: FsDirHandle): Promise<File[]> {
  const out: File[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') {
      if (isMarkdown(entry.name)) out.push(await entry.getFile());
    } else {
      out.push(...(await collectMarkdown(entry)));
    }
  }
  return out;
}

function pick() {
  fileInput.value?.click();
}

// "Select a folder": prefer the File System Access API (true folder picker, repeatable). Falls back
// to the webkitdirectory input where the API is blocked/absent (Brave, Firefox, Safari).
async function pickFolder() {
  folderNote.value = '';
  const picker = (window as unknown as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;
  if (typeof picker !== 'function') {
    dirInput.value?.click();
    return;
  }
  let dir: FsDirHandle;
  try {
    dir = await picker({ mode: 'read' });
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      // API present but failed/blocked at runtime → fall back to the webkitdirectory input.
      dirInput.value?.click();
    }
    return;
  }
  scanning.value = true;
  try {
    const md = await collectMarkdown(dir);
    setFolderNote(md.length, 1, dir.name);
    if (md.length) emit('files', md);
  } finally {
    scanning.value = false;
  }
}
</script>

<template>
  <div
    class="border-2 border-dashed rounded-btn p-8 text-center transition-colors cursor-pointer"
    :class="dragOver ? 'border-primary bg-primary/5' : 'border-light bg-surface'"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop="onDrop"
    @click="pick"
  >
    <UploadCloud :size="32" :stroke-width="1.5" class="mx-auto text-text/50" />
    <div class="mt-2 font-medium">Drop markdown files — or whole folders — here</div>
    <div class="text-xs text-text/60 mt-1">
      To add <strong>multiple folders</strong>, drag them all in at once — or drop/select a single
      parent folder and every subfolder’s .md is included. Or click to browse files.
    </div>

    <!-- Folder picker button (native dialog — one folder per click; drag is the multi-folder path). -->
    <button
      v-if="multiple"
      type="button"
      class="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-60"
      :disabled="scanning"
      @click.stop="pickFolder"
    >
      <FolderUp :size="14" />
      {{ scanning ? 'Scanning folder…' : 'Select a folder (one at a time)' }}
    </button>
    <div v-if="folderNote" class="text-xs mt-1.5" :class="folderNoteOk ? 'text-text/60' : 'text-danger'">
      {{ folderNote }}
    </div>

    <input
      ref="fileInput"
      type="file"
      class="hidden"
      :multiple="multiple"
      :accept="accept ?? '.md,.markdown,text/markdown'"
      @change="onSelect"
    />
    <!-- Fallback folder input (browsers without the File System Access API): webkitdirectory opens a
         native folder picker and returns the whole tree, filtered to markdown in JS. -->
    <input
      ref="dirInput"
      type="file"
      class="hidden"
      webkitdirectory
      multiple
      @change="onSelectFolder"
    />
  </div>
</template>
