import "@logseq/libs";
import { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin.user";

type BlockEntity = { uuid: string; content: string; children?: BlockEntity[] };
type ScanStats = { scanned: number; marked: number; inputsFound: number; inputsUpdated: number };

const DEFAULT_OFFSETS = "1,2,4,7,15,30,90,180";
const DEFAULT_MARKER_OFFSETS = "@ebbinghaus-created"; // offsets (template-only)
const DEFAULT_MARKER_RANGE = "@ebbinghaus-range";     // range (any page)
const DEFAULT_TEMPLATE_PAGES = "Templates";
const DEFAULT_MAX_RANGE_DAYS = 400;

const settings: SettingSchemaDesc[] = [
  {
    key: "templatePages",
    type: "string",
    default: DEFAULT_TEMPLATE_PAGES,
    title: "Template source page(s) (offsets only)",
    description: "Comma-separated page names that hold TEMPLATE blocks for offsets. Only these pages are updated for offsets."
  },
  {
    key: "caseInsensitivePageMatch",
    type: "boolean",
    default: true,
    title: "Case-insensitive template page match"
  },
  {
    key: "markerOffsets",
    type: "string",
    default: DEFAULT_MARKER_OFFSETS,
    title: "Marker (offsets)",
    description: "Marker for offsets blocks (template-only)."
  },
  {
    key: "markerRange",
    type: "string",
    default: DEFAULT_MARKER_RANGE,
    title: "Marker (RANGE)",
    description: "Marker for RANGE blocks (any page)."
  },
  {
    key: "propertyKey",
    type: "string",
    default: "created",
    title: "Property key",
    description: "Page property key containing created date (default: created)."
  },
  {
    key: "offsetDays",
    type: "string",
    default: DEFAULT_OFFSETS,
    title: "Ebbinghaus offsets (days)"
  },
  {
    key: "excludeToday",
    type: "boolean",
    default: true,
    title: "Exclude today",
    description: "If true, offset=1 means yesterday."
  },
  // GUI default range (ONLY used when INSERTING range blocks; NOT used to update existing pages)
  {
    key: "rangeStart",
    type: "string",
    default: "",
    title: "Default RANGE start (YYYYMMDD)",
    description: "Used only for inserting RANGE blocks. Existing pages will NOT be overwritten by changing this."
  },
  {
    key: "rangeEnd",
    type: "string",
    default: "",
    title: "Default RANGE end (YYYYMMDD)",
    description: "Used only for inserting RANGE blocks. Existing pages will NOT be overwritten by changing this."
  },
  {
    key: "autoUpdateTemplates",
    type: "boolean",
    default: true,
    title: "Auto update template pages (offsets)"
  },
  {
    key: "updateWhenOpenTemplatePage",
    type: "boolean",
    default: true,
    title: "Update offsets when opening template page"
  },
  {
    key: "autoUpdateRangeOnOpenPage",
    type: "boolean",
    default: true,
    title: "Auto update RANGE on open page"
  },
  {
    key: "autoUpdateRangeOnEdit",
    type: "boolean",
    default: true,
    title: "Auto update RANGE on edit (debounced)"
  },
  {
    key: "maxRangeDays",
    type: "number",
    default: DEFAULT_MAX_RANGE_DAYS,
    title: "Max days for RANGE expansion"
  }
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

function getDefaultRangeForInsert(): { start: string; end: string } | null {
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

/**
 * v0.1.12 IMPORTANT REFACTOR:
 * Update is now per-block (marker must be in the SAME block content that contains :inputs).
 * This prevents offsets updates from overwriting RANGE blocks (and vice versa), even if blocks are adjacent/siblings.
 */
async function updatePageBlocksByMarker(pageName: string, marker: string, mode: "offsets" | "range"): Promise<ScanStats> {
  const stats: ScanStats = { scanned: 0, marked: 0, inputsFound: 0, inputsUpdated: 0 };
  const tree = await getPageTree(pageName);
  if (!tree) return stats;

  // flatten tree
  const stack: BlockEntity[] = [...tree];
  while (stack.length) {
    const b = stack.pop()!;
    stats.scanned++;
    if (b.children?.length) stack.push(...b.children);

    if (!b.content.includes(marker)) continue;
    stats.marked++;

    // Marker must be in same block; only update inputs inside THIS block.
    if (!/:inputs\s*\[\[/.test(b.content)) continue;
    stats.inputsFound++;

    if (mode === "offsets") {
      const offsets = parseOffsets(String(logseq.settings?.offsetDays || DEFAULT_OFFSETS));
      const excludeToday = Boolean(logseq.settings?.excludeToday ?? true);
      const dates = datesByOffsets(offsets, excludeToday);
      const ok = await updateInputsClauseInBlock(b.uuid, b.content, formatInputsFromList(dates));
      if (ok) stats.inputsUpdated++;
      continue;
    }

    // mode === "range"
    // v0.1.12 decouple: Only use PAGE-LOCAL sentinel for updates.
    // (Settings rangeStart/end are used only when INSERTING new blocks.)
    const r = parseRangeSentinel(b.content);
    if (!r) continue;

    const maxRangeDays = Number(logseq.settings?.maxRangeDays ?? DEFAULT_MAX_RANGE_DAYS);
    const dates = dateRangeList(r.start, r.end, maxRangeDays);
    if (!dates) continue;

    const ok = await updateInputsClauseInBlock(b.uuid, b.content, formatInputsFromList(dates));
    if (ok) stats.inputsUpdated++;
  }

  return stats;
}

async function updateTemplatePagesOffsetsOnce(): Promise<{ pages: string[]; stats: ScanStats }> {
  const markerOffsets = String(logseq.settings?.markerOffsets || DEFAULT_MARKER_OFFSETS);
  const pages = getTemplatePages();
  const total: ScanStats = { scanned: 0, marked: 0, inputsFound: 0, inputsUpdated: 0 };

  for (const p of pages) {
    const s = await updatePageBlocksByMarker(p, markerOffsets, "offsets");
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
  return await updatePageBlocksByMarker(cur, markerRange, "range");
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
  const def = getDefaultRangeForInsert();
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
    try { await updateCurrentPageRangeOnce(); } catch (e) { console.error(e); }
  }, 600);
}

async function main() {
  console.log("[Ebbinghaus] plugin version 0.1.12 loaded");
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

  // Auto updates
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
