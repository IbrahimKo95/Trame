import { useSyncExternalStore } from "react";
import { SAMPLE_SHOP, EMPTY_SCHEMA } from "./lib/export/sample.mjs";
import { layoutTables, applyGenerated } from "./lib/ai/schema.mjs";

export type Ref = { table: string; column: string; onDelete: string; onUpdate: string } | null;
export interface Column { id: string; name: string; type: string; pk: boolean; nullable: boolean; unique: boolean; autoIncrement: boolean; default: string; comment: string; ref: Ref; length?: number; precision?: number; scale?: number; enumValues?: string[] }
export interface Index { id: string; name: string; columns: string[]; unique: boolean }
export interface Table { id: string; name: string; color: string; comment: string; x: number; y: number; columns: Column[]; indexes: Index[] }
export interface Schema { id: string; name: string; dialect: "postgres" | "mysql" | "sqlite"; tables: Table[] }
export interface State { schemas: Schema[]; activeId: string; selTable: string | null; selCol: string | null; theme: "dark" | "light"; dialog: null | "export" | "schemas" | "import" | "ai"; toast: string | null }

export const COLORS = ["#6ea8ff", "#7c9cff", "#a78bfa", "#f472b6", "#fb923c", "#facc15", "#4ade80", "#2dd4bf"];
const KEY = "trame:v1";
export const uid = (p: string) => p + "_" + Math.random().toString(36).slice(2, 8);

function load(): State {
  const base: State = { schemas: [], activeId: "", selTable: null, selCol: null, theme: "dark", dialog: null, toast: null };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && Array.isArray(raw.schemas) && raw.schemas.length) {
      return { ...base, schemas: raw.schemas, activeId: raw.schemas.find((s: Schema) => s.id === raw.activeId) ? raw.activeId : raw.schemas[0].id, theme: raw.theme === "light" ? "light" : "dark" };
    }
  } catch {}
  const s = structuredClone(SAMPLE_SHOP) as Schema;
  return { ...base, schemas: [s], activeId: s.id };
}

let state: State = load();
const subs = new Set<() => void>();
let past: string[] = [], future: string[] = [];
let saveT: any;

function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ schemas: state.schemas, activeId: state.activeId, theme: state.theme })); } catch {}
  }, 250);
}
function emit() { persist(); subs.forEach((f) => f()); }
export const useStore = <T,>(sel: (s: State) => T): T => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => sel(state));
export const getState = () => state;
export const active = (s: State = state): Schema => s.schemas.find((x) => x.id === s.activeId) || s.schemas[0];
export const useSchema = () => useStore((s) => active(s));

export function setUi(p: Partial<State>) { state = { ...state, ...p }; emit(); }
let toastT: any;
export function toast(msg: string) { setUi({ toast: msg }); clearTimeout(toastT); toastT = setTimeout(() => setUi({ toast: null }), 2600); }

/** Modifie le schéma actif. `record` = crée un point d'annulation (faux pendant un glissement). */
export function mutate(fn: (s: Schema) => void, record = true) {
  const cur = active();
  if (record) { past.push(JSON.stringify(cur)); if (past.length > 100) past.shift(); future = []; }
  const next = structuredClone(cur); fn(next);
  state = { ...state, schemas: state.schemas.map((x) => (x.id === cur.id ? next : x)) };
  emit();
}
export function checkpoint() { past.push(JSON.stringify(active())); if (past.length > 100) past.shift(); future = []; subs.forEach((f) => f()); }
export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
function swap(to: string) {
  const cur = active();
  const s = JSON.parse(to) as Schema;
  state = { ...state, schemas: state.schemas.map((x) => (x.id === cur.id ? s : x)), selCol: null, selTable: s.tables.find((t) => t.id === state.selTable) ? state.selTable : null };
  emit();
}
export function undo() { if (!past.length) return; future.push(JSON.stringify(active())); swap(past.pop()!); }
export function redo() { if (!future.length) return; past.push(JSON.stringify(active())); swap(future.pop()!); }

/* ---------- schémas ---------- */
export function switchSchema(id: string) { past = []; future = []; setUi({ activeId: id, selTable: null, selCol: null, dialog: null }); }
export function newSchema(name = "Nouveau schéma") {
  const s = structuredClone(EMPTY_SCHEMA(name)) as Schema; s.id = uid("s");
  state = { ...state, schemas: [...state.schemas, s] }; switchSchema(s.id);
}
export function loadSample() { const s = structuredClone(SAMPLE_SHOP) as Schema; s.id = uid("s"); state = { ...state, schemas: [...state.schemas, s] }; switchSchema(s.id); }
export function deleteSchema(id: string) {
  const rest = state.schemas.filter((s) => s.id !== id);
  if (!rest.length) { const e = structuredClone(EMPTY_SCHEMA("Nouveau schéma")) as Schema; e.id = uid("s"); rest.push(e); }
  state = { ...state, schemas: rest }; switchSchema(state.activeId === id ? rest[0].id : state.activeId);
}
export function importJson(text: string): string | null {
  try {
    const s = JSON.parse(text);
    if (!s || !Array.isArray(s.tables)) return "JSON invalide : il manque la liste « tables ».";
    s.id = uid("s"); s.name = s.name || "Importé"; s.dialect = ["postgres", "mysql", "sqlite"].includes(s.dialect) ? s.dialect : "postgres";
    for (const t of s.tables) { t.columns = t.columns || []; t.indexes = t.indexes || []; t.x = Number(t.x) || 0; t.y = Number(t.y) || 0; t.color = t.color || COLORS[0]; t.comment = t.comment || ""; }
    state = { ...state, schemas: [...state.schemas, s] }; switchSchema(s.id); return null;
  } catch (e: any) { return "JSON illisible : " + e.message; }
}

/* ---------- tables et colonnes ---------- */
export function newColumn(name = "colonne", type = "string"): Column {
  return { id: uid("c"), name, type, pk: false, nullable: true, unique: false, autoIncrement: false, default: "", comment: "", ref: null };
}
export function addTable(x?: number, y?: number) {
  const id = uid("t");
  mutate((s) => {
    const n = s.tables.length;
    let name = "table", i = n + 1; while (s.tables.some((t) => t.name === name + "_" + i)) i++; name = name + "_" + i;
    const idCol = { ...newColumn("id", s.dialect === "postgres" ? "uuid" : "bigIncrements"), pk: true, nullable: false, default: s.dialect === "postgres" ? "gen_random_uuid()" : "" };
    let px = x ?? 80 + (n % 4) * 300, py = y ?? 80 + Math.floor(n / 4) * 260;
    const hit = () => s.tables.some((o) => px < o.x + 280 && px + 280 > o.x && py < o.y + 70 + o.columns.length * 30 + 40 && py + 130 > o.y);
    for (let i = 0; i < 40 && hit(); i++) py += 60;
    s.tables.push({ id, name, color: COLORS[n % COLORS.length], comment: "", x: px, y: py, columns: [idCol], indexes: [] });
  });
  setUi({ selTable: id, selCol: null });
  return id;
}
export function updateTable(id: string, patch: Partial<Table>, record = true) { mutate((s) => { const t = s.tables.find((x) => x.id === id); if (t) Object.assign(t, patch); }, record); }
export function deleteTable(id: string) {
  mutate((s) => {
    s.tables = s.tables.filter((t) => t.id !== id);
    for (const t of s.tables) { for (const c of t.columns) if (c.ref && c.ref.table === id) c.ref = null; }
  });
  if (state.selTable === id) setUi({ selTable: null, selCol: null });
}
export function duplicateTable(id: string) {
  const nid = uid("t");
  mutate((s) => {
    const t = s.tables.find((x) => x.id === id); if (!t) return;
    const copy = structuredClone(t); copy.id = nid; copy.name = t.name + "_copy"; copy.x += 40; copy.y += 40;
    const map: Record<string, string> = {};
    copy.columns.forEach((c) => { const o = c.id; c.id = uid("c"); map[o] = c.id; if (c.ref && c.ref.table === id) c.ref = { ...c.ref, column: c.ref.column }; });
    copy.indexes = copy.indexes.map((i) => ({ ...i, id: uid("i"), columns: i.columns.map((c) => map[c] || c) }));
    s.tables.push(copy);
  });
  setUi({ selTable: nid, selCol: null });
}
export function addColumn(tid: string, col?: Partial<Column>) {
  const c = { ...newColumn(), ...col };
  mutate((s) => { const t = s.tables.find((x) => x.id === tid); if (t) { let n = "colonne", i = t.columns.length; while (t.columns.some((x) => x.name === n + "_" + i)) i++; if (!col?.name) c.name = n + "_" + i; t.columns.push(c); } });
  setUi({ selTable: tid, selCol: c.id });
  return c.id;
}
export function updateColumn(tid: string, cid: string, patch: Partial<Column>) {
  mutate((s) => {
    const t = s.tables.find((x) => x.id === tid); const c = t?.columns.find((x) => x.id === cid); if (!c) return;
    Object.assign(c, patch);
    if (patch.pk) { c.nullable = false; }
    if (patch.type && !["increments", "bigIncrements"].includes(patch.type)) { /* rien */ }
  });
}
export function deleteColumn(tid: string, cid: string) {
  mutate((s) => {
    const t = s.tables.find((x) => x.id === tid); if (!t) return;
    t.columns = t.columns.filter((c) => c.id !== cid);
    t.indexes = t.indexes.map((i) => ({ ...i, columns: i.columns.filter((c) => c !== cid) })).filter((i) => i.columns.length);
    for (const o of s.tables) for (const c of o.columns) if (c.ref && c.ref.table === tid && c.ref.column === cid) c.ref = null;
  });
  if (state.selCol === cid) setUi({ selCol: null });
}
export function moveColumn(tid: string, cid: string, dir: -1 | 1) {
  mutate((s) => { const t = s.tables.find((x) => x.id === tid); if (!t) return; const i = t.columns.findIndex((c) => c.id === cid), j = i + dir; if (i < 0 || j < 0 || j >= t.columns.length) return; [t.columns[i], t.columns[j]] = [t.columns[j], t.columns[i]]; });
}
/** Type SQL "logique" à copier sur une clé étrangère selon la colonne cible. */
export function fkType(target: Column): string {
  if (target.type === "increments") return "integer";
  if (target.type === "bigIncrements") return "bigInteger";
  return target.type;
}
export function setRef(tid: string, cid: string, ref: Ref) {
  mutate((s) => {
    const t = s.tables.find((x) => x.id === tid); const c = t?.columns.find((x) => x.id === cid); if (!c) return;
    c.ref = ref;
    if (ref) { const tt = s.tables.find((x) => x.id === ref.table)?.columns.find((x) => x.id === ref.column); if (tt) { c.type = fkType(tt); c.autoIncrement = false; } }
  });
}
export function addIndex(tid: string, columns: string[], unique = false) {
  mutate((s) => { const t = s.tables.find((x) => x.id === tid); if (!t) return; const names = columns.map((id) => t.columns.find((c) => c.id === id)?.name).join("_"); t.indexes.push({ id: uid("i"), name: `${t.name}_${names}_${unique ? "unique" : "idx"}`, columns, unique }); });
}
export function updateIndex(tid: string, iid: string, patch: Partial<Index>) { mutate((s) => { const i = s.tables.find((x) => x.id === tid)?.indexes.find((x) => x.id === iid); if (i) Object.assign(i, patch); }); }
export function deleteIndex(tid: string, iid: string) { mutate((s) => { const t = s.tables.find((x) => x.id === tid); if (t) t.indexes = t.indexes.filter((i) => i.id !== iid); }); }

/** Dispose les tables en colonnes selon leur profondeur de dépendance. */
export function autoLayout() { mutate((s) => { layoutTables(s.tables); }); }

/** Applique un schéma généré par l'IA (un seul point d'annulation). */
export function applyAi(generated: Schema, mode: "replace" | "merge" | "edit") {
  mutate((s) => {
    const wasEmpty = !s.tables.length;
    s.tables = applyGenerated(s, generated, mode) as Table[];
    if (generated.name && (wasEmpty || s.name === "Nouveau schéma")) s.name = generated.name;
  });
  setUi({ selTable: null, selCol: null, dialog: null });
}
/** Crée un nouveau schéma à partir du résultat de l'IA. */
export function newSchemaFromAi(generated: Schema) {
  const s = structuredClone(generated); s.id = uid("s"); s.tables = applyGenerated(s, s, "replace") as Table[];
  state = { ...state, schemas: [...state.schemas, s] }; switchSchema(s.id);
}

/* ---------- thème ---------- */
export function applyTheme() { document.documentElement.setAttribute("data-theme", state.theme); }
export function toggleTheme() { setUi({ theme: state.theme === "dark" ? "light" : "dark" }); applyTheme(); }
