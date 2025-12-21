import "@logseq/libs";
import { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin.user";

type BlockEntity = { uuid: string; content: string; children?: BlockEntity[] };
type ScanStats = { scanned: number; marked: number; inputsFound: number; inputsUpdated: number };

const DEFAULT_OFFSETS = "1,2,4,7,15,30,90,180";
const DEFAULT_MARKER_OFFSETS = "@ebbinghaus-created"; // template-only offsets
const DEFAULT_MARKER_RANGE = "@ebbinghaus-range";     // RANGE can work on ANY page
const DEFAULT_TEMPLATE_PAGES = "Templates";
const DEFAULT_MAX_RANGE_DAYS = 400;

const settings: SettingSchemaDesc[] = [
  { key: "templatePages", type: "string", default: DEFAULT_TEMPLATE_PAGES, title: "Template source page(s) (offsets only)",
    description: "Comma-separated page names that hold your TEMPLATE blocks for offsets. Only these pages are updated for offsets marker." },
  { key: "caseInsensitivePageMatch", type: "boolean", default: true, title: "Case-insensitive template page match",
    description: "If true, match template page names case-insensitively." },
  { key: "markerOffsets", type: "string", default: DEFAULT_MARKER_OFFSETS, title: "Marker (offsets)",
    description: "Marker for offsets blocks. These are updated ONLY inside template source pages." },
  { key: "markerRange", type: "string", default: DEFAULT_MARKER_RANGE, title: "Marker (RANGE)",
    description: "Marker for RANGE blocks. These can be updated on ANY page." },
  { key: "propertyKey", type: "string", default: "created", title: "Property key",
    description: "Page property key containing the created date (default: created)." },
  { key: "offsetDays", type: "string", default: DEFAULT_OFFSETS, title: "Ebbinghaus offsets (days)",
    description: "Comma-separated offsets, e.g. 1,2,4,7,15,30,90,180" },
  { key: "excludeToday", type: "boolean", default: true, title: "Exclude today",
    description: "Exclude today (true => yesterday is offset 1)." },

  // NEW: Default RANGE in settings UI
  { key: "rangeStart", type: "string", default: "", title: "RANGE start (YYYYMMDD)",
    description: "Optional default start date for RANGE insertion and fallback when no RANGE sentinel exists." },
  { key: "rangeEnd", type: "string", default: "", title: "RANGE end (YYYYMMDD)",
    description: "Optional default end date for RANGE insertion and fallback when no RANGE sentinel exists." },

  { key: "autoUpdateTemplates", type: "boolean", default: true, title: "Auto update template pages (offsets)",
    description: "Update TEMPLATE pages on startup + after midnight (Logseq open)." },
  { key: "updateWhenOpenTemplatePage", type: "boolean", default: true, title: "Update offsets when opening template page",
    description: "When you open a TEMPLATE source page, update offsets once (template-only)." },
  { key: "autoUpdateRangeOnOpenPage", type: "boolean", default: true, title: "Auto update RANGE on open page",
    description: "When you open ANY page, update RANGE blocks on that page." },
  { key: "autoUpdateRangeOnEdit", type: "boolean", default: true, title: "Auto update RANGE on edit",
    description: "When you edit a block containing RANGE marker/sentinel, update inputs automatically (debounced)." },
  { key: "maxRangeDays", type: "number", default: DEFAULT_MAX_RANGE_DAYS, title: "Max days for RANGE expansion",
    description: "Safety limit. RANGE larger than this will be rejected." }
];

function parseOffsets(s: string): number[] {
  return s.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
}

function yyyymmdd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function parseYYYYMMDD(s: string): Date | null {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function daysBetweenInclusive(start: Date, end: Date): number {
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const b = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.floor((b - a) / 86400000) + 1;
}

function dateRangeList(startStr: string, endStr: string, maxDays: number): string[] | null {
  const s = parseYYYYMMDD(startStr);
  const e = parseYYYYMMDD(endStr);
  if (!s || !e) return null;
  if (s.getTime() > e.getTime()) return null;
  const n = daysBetweenInclusive(s, e);
  if (n > maxDays) return null;

  const out: string[] = [];
  const cur = new Date(s);
  for (let i = 0; i < n; i++) {
    out.push(yyyymmdd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function parseRangeSentinel(content: string): { start: string; end: string } | null {
  const re = /RANGE:(\d{8})\s*(?:-|\.\.)\s*(\d{8})/;
  const m = content.match(re);
  if (!m) return null;
  return { start: m[1], end: m[2] };
}

function getDefaultRangeFromSettings(): { start: string; end: string } | null {
  const s = String(logseq.settings?.rangeStart ?? "").trim();
  const e = String(logseq.settings?.rangeEnd ?? "").trim();
  if (!s || !e) return null;
  if (!parseYYYYMMDD(s) || !parseYYYYMMDD(e)) return null;
  return { start: s, end: e };
}

function datesByOffsets(offsets: number[], excludeToday: boolean): string[] {
  const now = new Date();
  return offsets.map((n) => {
    const dd = new Date(now);
    dd.setDate(now.getDate() - (excludeToday ? n : Math.max(0, n - 1)));
    return yyyymmdd(dd);
  });
}

function formatInputsFromList(dates: string[]): string {
  const lines = dates.map((x, i) => (i === 0 ? `"${x}"` : `           "${x}"`));
  return `:inputs [[${lines.join("\n")}]]`;
}

function normPageName(s: string): string {
  return s.replace(/\u3000/g, " ").trim();
}

function getTemplatePages(): string[] {
  return String(logseq.settings?.templatePages || DEFAULT_TEMPLATE_PAGES).split(",").map((x) => normPageName(x)).filter(Boolean);
}

function matchTemplatePage(current: string): boolean {
  const ci = Boolean(logseq.settings?.caseInsensitivePageMatch ?? true);
  const cur = normPageName(current);
  const set = getTemplatePages();
  if (ci) {
    const curL = cur.toLowerCase();
    return set.some((p) => p.toLowerCase() === curL);
  }
  return set.some((p) => p === cur);
}

async function getPageTree(page: string): Promise<BlockEntity[] | null> {
  return (await logseq.Editor.getPageBlocksTree(page)) as any;
}

async function updateInputsClauseInBlock(uuid: string, content: string, inputsText: string): Promise<boolean> {
  const reInputs = /:inputs\s*\[\[[\s\S]*?\]\]/m;
  if (!reInputs.test(content)) return false;
  const out = content.replace(reInputs, inputsText);
  if (out === content) return false;
  await logseq.Editor.updateBlock(uuid, out);
  return true;
}

function flattenWithParents(tree: BlockEntity[]) {
  const blocks: BlockEntity[] = [];
  const parent = new Map<string, string | null>();
  const children = new Map<string, string[]>();
  const pushChild = (p: string, c: string) => {
    const arr = children.get(p) ?? [];
    arr.push(c);
    children.set(p, arr);
  };
  const walk = (nodes: BlockEntity[], parentUuid: string | null) => {
    for (const b of nodes) {
      blocks.push(b);
      parent.set(b.uuid, parentUuid);
      if (parentUuid) pushChild(parentUuid, b.uuid);
      if (b.children?.length) walk(b.children, b.uuid);
    }
  };
  walk(tree, null);
  return { blocks, parent, children };
}

function subtreeUuids(root: string, children: Map<string, string[]>): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const u = stack.pop()!;
    out.push(u);
    const ch = children.get(u);
    if (ch?.length) stack.push(...ch);
  }
  return out;
}

function computeInputsForRoot(subUuids: string[], byId: Map<string, BlockEntity>, mode: "offsets" | "range"): { inputsText: string } | null {
  const maxRangeDays = Number(logseq.settings?.maxRangeDays ?? DEFAULT_MAX_RANGE_DAYS);

  if (mode === "range") {
    let range: { start: string; end: string } | null = null;

    // 1) Prefer page-local RANGE sentinel
    for (const u of subUuids) {
      const b = byId.get(u);
      if (!b) continue;
      const r = parseRangeSentinel(b.content);
      if (r) { range = r; break; }
    }
    // 2) Fallback to settings default range
    if (!range) range = getDefaultRangeFromSettings();
    if (!range) return null;

    const dates = dateRangeList(range.start, range.end, maxRangeDays);
    if (!dates) return null;
    return { inputsText: formatInputsFromList(dates) };
  }

  const offsets = parseOffsets(String(logseq.settings?.offsetDays || DEFAULT_OFFSETS));
  const excludeToday = Boolean(logseq.settings?.excludeToday ?? true);
  const dates = datesByOffsets(offsets, excludeToday);
  return { inputsText: formatInputsFromList(dates) };
}

async function updatePageByMarker(pageName: string, marker: string, mode: "offsets" | "range"): Promise<ScanStats> {
  const stats: ScanStats = { scanned: 0, marked: 0, inputsFound: 0, inputsUpdated: 0 };
  const tree = await getPageTree(pageName);
  if (!tree) return stats;

  const { blocks, parent, children } = flattenWithParents(tree);
  const byId = new Map(blocks.map((b) => [b.uuid, b]));

  const roots = new Set<string>();
  for (const b of blocks) {
    stats.scanned++;
    if (!b.content.includes(marker)) continue;
    stats.marked++;
    const root = parent.get(b.uuid) ?? b.uuid;
    roots.add(root);
  }

  for (const rootUuid of roots) {
    const sub = subtreeUuids(rootUuid, children);
    const computed = computeInputsForRoot(sub, byId, mode);
    if (!computed) continue;

    for (const u of sub) {
      const b = byId.get(u);
      if (!b) continue;
      if (/:inputs\s*\[\[/.test(b.content)) {
        stats.inputsFound++;
        const ok = await updateInputsClauseInBlock(u, b.content, computed.inputsText);
        if (ok) stats.inputsUpdated++;
      }
    }
  }
  return stats;
}

async function updateTemplatePagesOffsetsOnce(): Promise<{ pages: string[]; stats: ScanStats }> {
  const markerOffsets = String(logseq.settings?.markerOffsets || DEFAULT_MARKER_OFFSETS);
  const pages = getTemplatePages();
  const total: ScanStats = { scanned: 0, marked: 0, inputsFound: 0, inputsUpdated: 0 };

  for (const p of pages) {
    const s = await updatePageByMarker(p, markerOffsets, "offsets");
    total.scanned += s.scanned;
    total.marked += s.marked;
    total.inputsFound += s.inputsFound;
    total.inputsUpdated += s.inputsUpdated;
  }
  return { pages, stats: total };
}

async function getCurrentPageName(): Promise<string | null> {
  const page = await logseq.Editor.getCurrentPage();
  return (page as any)?.name ?? null;
}

async function updateCurrentPageRangeOnce(): Promise<ScanStats> {
  const markerRange = String(logseq.settings?.markerRange || DEFAULT_MARKER_RANGE);
  const cur = await getCurrentPageName();
  if (!cur) return { scanned: 0, marked: 0, inputsFound: 0, inputsUpdated: 0 };
  return await updatePageByMarker(cur, markerRange, "range");
}

function msUntilNextMidnight(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 1, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

function scheduleDailyTemplateUpdate() {
  const tick = async () => {
    try { await updateTemplatePagesOffsetsOnce(); }
    finally { setTimeout(tick, msUntilNextMidnight()); }
  };
  setTimeout(tick, msUntilNextMidnight());
}

function buildOffsetsQueryBlock(propertyKey: string, marker: string): string {
  return `#+BEGIN_QUERY
{:title "Ebbinghaus created offsets (exclude today)"
 :query
 [:find (pull ?p [*])
  :in $ [?d ...]
  :where
  [?p :block/properties ?props]
  [(get ?props :${propertyKey}) ?c]
  [(contains? ?c ?d)]]
 :inputs [["20000101"]]}
#+END_QUERY
;; ${marker}`;
}

function buildRangeQueryBlock(propertyKey: string, marker: string): string {
  const def = getDefaultRangeFromSettings();
  const sentinel = def ? `RANGE:${def.start}-${def.end}` : "RANGE:20250101-20251010";
  return `#+BEGIN_QUERY
{:title "Created pages in RANGE"
 :query
 [:find (pull ?p [*])
  :in $ [?d ...]
  :where
  [?p :block/properties ?props]
  [(get ?props :${propertyKey}) ?c]
  [(contains? ?c ?d)]]
 :inputs [["${sentinel}"]]}
#+END_QUERY
;; ${marker}`;
}

let editTimer: number | null = null;
function debounceUpdateRange() {
  if (!logseq.settings?.autoUpdateRangeOnEdit) return;
  if (editTimer) window.clearTimeout(editTimer);
  editTimer = window.setTimeout(async () => {
    try { await updateCurrentPageRangeOnce(); }
    catch (e) { console.error(e); }
  }, 600);
}

async function main() {
  console.log("[Ebbinghaus] plugin version 0.1.11 loaded");
  logseq.useSettingsSchema(settings);

  // Slash commands
  logseq.Editor.registerSlashCommand("Ebbinghaus: Insert created query (offsets)", async () => {
    const marker = String(logseq.settings?.markerOffsets || DEFAULT_MARKER_OFFSETS);
    const propertyKey = String(logseq.settings?.propertyKey || "created");
    await logseq.Editor.insertAtEditingCursor(buildOffsetsQueryBlock(propertyKey, marker));

    const cur = await getCurrentPageName();
    if (cur && matchTemplatePage(cur)) {
      const r = await updateTemplatePagesOffsetsOnce();
      logseq.UI.showMsg(`Inserted offsets into template. inputsUpdated=${r.stats.inputsUpdated}`, "success");
    } else {
      logseq.UI.showMsg("Inserted offsets. (Offsets auto-update only on template source pages.)", "success");
    }
  });

  logseq.Editor.registerSlashCommand("Ebbinghaus: Insert created query (RANGE)", async () => {
    const marker = String(logseq.settings?.markerRange || DEFAULT_MARKER_RANGE);
    const propertyKey = String(logseq.settings?.propertyKey || "created");
    await logseq.Editor.insertAtEditingCursor(buildRangeQueryBlock(propertyKey, marker));
    const s = await updateCurrentPageRangeOnce();
    logseq.UI.showMsg(`Inserted RANGE. inputsUpdated=${s.inputsUpdated}`, "success");
  });

  // Command palette manual triggers
  logseq.App.registerCommandPalette(
    { key: "ebbinghaus-update-templates-now", label: "Ebbinghaus: Update template query inputs NOW" },
    async () => {
      const r = await updateTemplatePagesOffsetsOnce();
      logseq.UI.showMsg(
        `Template offsets updated. inputsUpdated=${r.stats.inputsUpdated} (found=${r.stats.inputsFound}, marked=${r.stats.marked})`,
        "success",
        { timeout: 6000 }
      );
    }
  );

  logseq.App.registerCommandPalette(
    { key: "ebbinghaus-update-range-now", label: "Ebbinghaus: Update RANGE inputs NOW (current page)" },
    async () => {
      const s = await updateCurrentPageRangeOnce();
      logseq.UI.showMsg(
        `RANGE updated on this page. inputsUpdated=${s.inputsUpdated} (found=${s.inputsFound}, marked=${s.marked})`,
        "success",
        { timeout: 6000 }
      );
    }
  );

  // Template offsets auto update
  if (logseq.settings?.autoUpdateTemplates) {
    await updateTemplatePagesOffsetsOnce();
    scheduleDailyTemplateUpdate();
  }

  if (logseq.settings?.updateWhenOpenTemplatePage) {
    logseq.App.onRouteChanged(async () => {
      const cur = await getCurrentPageName();
      if (cur && matchTemplatePage(cur)) {
        await updateTemplatePagesOffsetsOnce();
      }
    });
  }

  if (logseq.settings?.autoUpdateRangeOnOpenPage) {
    logseq.App.onRouteChanged(async () => {
      await updateCurrentPageRangeOnce();
    });
  }

  if (logseq.settings?.autoUpdateRangeOnEdit) {
    // @ts-ignore
    logseq.DB.onChanged(() => debounceUpdateRange());
  }
}

logseq.ready(main).catch(console.error);
