// IA : format compact échangé avec le modèle, validation, fusion et placement.
// JS pur (aucun import React/DOM) : utilisé par le serveur (server/) et le client.
//
// Le modèle ne manipule pas le format complet de docs/MODEL.md (ids, positions,
// couleurs) : il reçoit/renvoie un format compact où les relations se font par
// NOM (`ref: { table: "users", column: "id" }`). `fromCompact()` le convertit en
// schéma Trame valide (ids générés, refs par id) et corrige ce qui peut l'être.
// En mode « modifier », les tables/colonnes existantes portent leur `id` : le
// modèle le recopie, ce qui permet de conserver positions et couleurs.

import { TYPES, ACTIONS, DIALECTS } from '../export/types.mjs';

export const MAX_PROMPT = 2000;
export const MAX_TABLES = 60;
export const MAX_COLUMNS = 80;
export const AI_COLORS = ['#6ea8ff', '#7c9cff', '#a78bfa', '#f472b6', '#fb923c', '#facc15', '#4ade80', '#2dd4bf'];

const TYPE_IDS = TYPES.map((t) => t.id);
// synonymes fréquents renvoyés par les modèles
const TYPE_ALIASES = {
  int: 'integer', int4: 'integer', serial: 'increments', bigserial: 'bigIncrements', bigint: 'bigInteger', int8: 'bigInteger',
  smallint: 'smallInteger', tinyint: 'smallInteger', number: 'integer', numeric: 'decimal', money: 'decimal', double: 'float', real: 'float',
  bool: 'boolean', varchar: 'string', char: 'string', str: 'string', email: 'string', longtext: 'text', mediumtext: 'text',
  jsonb: 'json', blob: 'binary', bytea: 'binary', timestamptz: 'timestamp', datetime2: 'datetime', guid: 'uuid',
};

const rnd = () => Math.random().toString(36).slice(2, 8);
const str = (v, max = 200) => (v == null ? '' : String(v)).slice(0, max);
const key = (s) => str(s).trim().toLowerCase();

/** Normalise un type renvoyé par le modèle vers un type logique de Trame. */
export function normType(t) {
  const raw = String(t ?? '').trim();
  if (TYPE_IDS.includes(raw)) return raw;
  const low = raw.toLowerCase().replace(/\(.*$/, '').trim();
  const hit = TYPE_IDS.find((x) => x.toLowerCase() === low);
  return hit || TYPE_ALIASES[low] || 'string';
}

const normAction = (a) => { const v = key(a).replace(/_/g, ' '); return ACTIONS.includes(v) ? v : 'no action'; };

/* ------------------------------------------------------------------ prompt */

export function systemPrompt(dialect = 'postgres') {
  return `Tu es un architecte de bases de données. Tu conçois des schémas relationnels propres et normalisés.
Réponds UNIQUEMENT par un objet JSON, sans texte autour, de la forme :
{
  "name": "Nom court du projet",
  "tables": [{
    "id": "(uniquement si la table existait déjà : recopie son id)",
    "name": "users",
    "comment": "rôle de la table, en français, court",
    "columns": [{
      "id": "(uniquement si la colonne existait déjà : recopie son id)",
      "name": "id",
      "type": "uuid",
      "pk": true, "nullable": false, "unique": false, "autoIncrement": false,
      "default": "",
      "length": 255,
      "enumValues": ["a", "b"],
      "ref": null
    }],
    "indexes": [{ "columns": ["email"], "unique": true }]
  }]
}
Règles :
- "type" parmi : ${TYPE_IDS.join(', ')}.
- Noms de tables au pluriel et de colonnes en snake_case anglais (users, order_items, created_at).
- Chaque table a une clé primaire. Base cible : ${dialect}. ${dialect === 'postgres' ? 'Utilise "uuid" avec default "gen_random_uuid()" pour les id.' : 'Utilise "bigIncrements" pour les id.'}
- Clé étrangère : colonne "<table_au_singulier>_id" du même type que la PK visée (bigInteger si la cible est bigIncrements), avec "ref": { "table": "users", "column": "id", "onDelete": "cascade" }. "table" et "column" sont des NOMS. onDelete parmi : ${ACTIONS.join(', ')}.
- Tables pivot pour les relations plusieurs-à-plusieurs.
- "default" est une expression SQL brute ("", "0", "'draft'", "now()"). "enumValues" seulement pour le type enum, "length" seulement si utile.
- Ajoute created_at / updated_at (timestamp, nullable) aux tables métier.
- Les champs non indiqués ("comment", "unique", "indexes"…) peuvent être omis.`;
}

/** Message utilisateur : description + (en mode modification) le schéma actuel compacté. */
export function userPrompt(prompt, current) {
  const p = str(prompt, MAX_PROMPT).trim();
  if (!current) return `Conçois le schéma de ce projet :\n${p}`;
  return `Voici le schéma actuel (JSON) :\n${JSON.stringify(toCompact(current))}\n\nApplique cette demande et renvoie le schéma COMPLET mis à jour (garde les "id" des tables et colonnes conservées) :\n${p}`;
}

/* ------------------------------------------------------------------ Trame -> compact */

export function toCompact(schema) {
  const tables = schema?.tables ?? [];
  const byId = new Map(tables.map((t) => [t.id, t]));
  return {
    name: schema?.name ?? '',
    tables: tables.map((t) => ({
      id: t.id, name: t.name, ...(t.comment ? { comment: t.comment } : {}),
      columns: (t.columns ?? []).map((c) => {
        const o = { id: c.id, name: c.name, type: c.type };
        if (c.pk) o.pk = true;
        if (c.nullable) o.nullable = true;
        if (c.unique) o.unique = true;
        if (c.autoIncrement) o.autoIncrement = true;
        if (c.default) o.default = c.default;
        if (c.length) o.length = c.length;
        if (c.precision) { o.precision = c.precision; o.scale = c.scale; }
        if (c.enumValues?.length) o.enumValues = c.enumValues;
        if (c.comment) o.comment = c.comment;
        if (c.ref) {
          const rt = byId.get(c.ref.table); const rc = rt?.columns.find((x) => x.id === c.ref.column);
          if (rt && rc) o.ref = { table: rt.name, column: rc.name, onDelete: c.ref.onDelete };
        }
        return o;
      }),
      ...(t.indexes?.length ? { indexes: t.indexes.map((i) => ({ columns: i.columns.map((id) => t.columns.find((c) => c.id === id)?.name).filter(Boolean), unique: !!i.unique })) } : {}),
    })),
  };
}

/* ------------------------------------------------------------------ compact -> Trame */

/**
 * Convertit et valide la réponse du modèle.
 * `base` (facultatif) = schéma actuel : les ids connus sont conservés avec position/couleur.
 * -> { schema, warnings: string[] }   ou lève une Error si rien d'exploitable.
 */
export function fromCompact(raw, { dialect = 'postgres', base = null } = {}) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const list = Array.isArray(data) ? data : Array.isArray(data?.tables) ? data.tables : null;
  if (!list) throw new Error('Réponse sans liste « tables ».');
  const warnings = [];
  const baseTables = new Map((base?.tables ?? []).map((t) => [t.id, t]));
  const usedIds = new Set();
  const newId = (p, wanted, known) => {
    if (wanted && known && !usedIds.has(wanted)) { usedIds.add(wanted); return wanted; }
    let id; do id = `${p}_${rnd()}`; while (usedIds.has(id)); usedIds.add(id); return id;
  };

  const tables = [];
  const tNames = new Set();
  for (const rt of list.slice(0, MAX_TABLES)) {
    if (!rt || typeof rt !== 'object') continue;
    let name = str(rt.name, 64).trim();
    if (!name) continue;
    if (tNames.has(key(name))) { warnings.push(`Table « ${name} » en double ignorée.`); continue; }
    tNames.add(key(name));
    const prev = baseTables.get(rt.id);
    const t = {
      id: newId('t', rt.id, !!prev), name, color: prev?.color ?? '', comment: str(rt.comment, 300),
      x: prev?.x ?? NaN, y: prev?.y ?? NaN, columns: [], indexes: [], _refs: [], _idx: rt.indexes,
    };
    const prevCols = new Map((prev?.columns ?? []).map((c) => [c.id, c]));
    const cNames = new Set();
    for (const rc of (Array.isArray(rt.columns) ? rt.columns : []).slice(0, MAX_COLUMNS)) {
      if (!rc || typeof rc !== 'object') continue;
      const cname = str(rc.name, 64).trim();
      if (!cname || cNames.has(key(cname))) continue;
      cNames.add(key(cname));
      const type = normType(rc.type);
      const c = {
        id: newId('c', rc.id, prevCols.has(rc.id)), name: cname, type,
        pk: !!rc.pk, nullable: !rc.pk && !!rc.nullable, unique: !!rc.unique,
        autoIncrement: !!rc.autoIncrement && ['integer', 'bigInteger', 'smallInteger'].includes(type),
        default: str(rc.default, 120), comment: str(rc.comment, 300), ref: null,
      };
      if (type === 'string' && Number(rc.length) > 0) c.length = Math.min(Math.round(Number(rc.length)), 65535);
      if (type === 'decimal' && Number(rc.precision) > 0) { c.precision = Math.min(Math.round(Number(rc.precision)), 65); c.scale = Math.max(0, Math.min(Math.round(Number(rc.scale) || 0), c.precision)); }
      if (type === 'enum') {
        const vals = Array.isArray(rc.enumValues) ? [...new Set(rc.enumValues.map((v) => str(v, 60).trim()).filter(Boolean))].slice(0, 50) : [];
        if (vals.length) c.enumValues = vals;
      }
      t.columns.push(c);
      if (rc.ref && typeof rc.ref === 'object') t._refs.push([c, rc.ref]);
    }
    if (!t.columns.length) { warnings.push(`Table « ${name} » sans colonne ignorée.`); continue; }
    if (!t.columns.some((c) => c.pk)) {
      const id = t.columns.find((c) => key(c.name) === 'id');
      if (id) { id.pk = true; id.nullable = false; }
      else {
        const pk = { id: newId('c'), name: 'id', type: dialect === 'postgres' ? 'uuid' : 'bigIncrements', pk: true, nullable: false, unique: false, autoIncrement: false, default: dialect === 'postgres' ? 'gen_random_uuid()' : '', comment: '', ref: null };
        t.columns.unshift(pk);
        warnings.push(`Clé primaire « id » ajoutée à « ${name} ».`);
      }
    }
    tables.push(t);
  }
  if (!tables.length) throw new Error('Aucune table exploitable dans la réponse.');

  // refs : par id (mode modification) ou par nom, sinon supprimées
  const findTable = (r) => tables.find((t) => t.id === r.table) || tables.find((t) => key(t.name) === key(r.table));
  for (const t of tables) {
    for (const [c, r] of t._refs) {
      const tt = findTable(r);
      if (!tt) { warnings.push(`Relation ${t.name}.${c.name} → ${str(r.table, 64)} ignorée (table inconnue).`); continue; }
      const cc = tt.columns.find((x) => x.id === r.column) || tt.columns.find((x) => key(x.name) === key(r.column)) || (tt.columns.filter((x) => x.pk).length === 1 ? tt.columns.find((x) => x.pk) : null);
      if (!cc) { warnings.push(`Relation ${t.name}.${c.name} ignorée (colonne cible introuvable).`); continue; }
      c.ref = { table: tt.id, column: cc.id, onDelete: normAction(r.onDelete), onUpdate: normAction(r.onUpdate) };
      // même type que la cible (increments -> entier)
      c.type = cc.type === 'increments' ? 'integer' : cc.type === 'bigIncrements' ? 'bigInteger' : cc.type;
      c.autoIncrement = false;
      if (c.ref.onDelete === 'set null') c.nullable = true;
    }
    for (const ri of Array.isArray(t._idx) ? t._idx.slice(0, 20) : []) {
      const cols = (Array.isArray(ri?.columns) ? ri.columns : []).map((n) => t.columns.find((c) => c.id === n || key(c.name) === key(n))?.id).filter(Boolean);
      if (!cols.length) continue;
      const names = cols.map((id) => t.columns.find((c) => c.id === id).name).join('_');
      t.indexes.push({ id: newId('i'), name: `${t.name}_${names}_${ri.unique ? 'unique' : 'idx'}`, columns: [...new Set(cols)], unique: !!ri.unique });
    }
    delete t._refs; delete t._idx;
  }

  tables.forEach((t, i) => { if (!t.color) t.color = AI_COLORS[i % AI_COLORS.length]; });
  const d = DIALECTS.includes(base?.dialect) ? base.dialect : DIALECTS.includes(dialect) ? dialect : 'postgres';
  return { schema: { id: base?.id ?? `s_${rnd()}`, name: str(data?.name, 80).trim() || base?.name || 'Schéma IA', dialect: d, tables }, warnings };
}

/* ------------------------------------------------------------------ placement */

const cardH = (t) => 64 + t.columns.length * 30 + 70;

/**
 * Place en colonnes par profondeur de dépendance les tables de `ids` (toutes si absent),
 * à partir de (ox, oy). Modifie les tables en place.
 */
export function layoutTables(tables, ids = null, ox = 60, oy = 60) {
  const set = ids ? new Set(ids) : new Set(tables.map((t) => t.id));
  const todo = tables.filter((t) => set.has(t.id));
  const depth = {};
  const byId = new Map(todo.map((t) => [t.id, t]));
  const visit = (id, seen) => {
    if (depth[id] != null) return depth[id];
    if (seen.has(id)) return 0; seen.add(id);
    const t = byId.get(id); if (!t) return 0;
    const deps = t.columns.filter((c) => c.ref && c.ref.table !== t.id && byId.has(c.ref.table)).map((c) => c.ref.table);
    const d = deps.length ? 1 + Math.max(...deps.map((x) => visit(x, seen))) : 0;
    return (depth[id] = d);
  };
  todo.forEach((t) => visit(t.id, new Set()));
  const cols = {};
  todo.forEach((t) => (cols[depth[t.id] || 0] ||= []).push(t));
  Object.entries(cols).forEach(([d, list]) => { let y = oy; list.forEach((t) => { t.x = ox + Number(d) * 360; t.y = y; y += cardH(t); }); });
  return tables;
}

/** Coin droit de la zone occupée par `tables` (pour poser de nouvelles tables à côté). */
const rightOf = (tables) => (tables.length ? Math.max(...tables.map((t) => t.x)) + 360 : 60);

/* ------------------------------------------------------------------ fusion */

/**
 * Applique le schéma généré au schéma courant.
 * - "replace" : remplace toutes les tables (rangées automatiquement).
 * - "merge"   : ajoute les tables ; une table générée qui porte le nom d'une table
 *               existante n'est pas dupliquée, ses relations visent l'existante.
 * - "edit"    : le résultat devient le schéma ; les tables conservées gardent leur place.
 * Renvoie un nouveau tableau de tables (ne modifie pas `current`).
 */
export function applyGenerated(current, generated, mode) {
  const gen = structuredClone(generated.tables);
  if (mode === 'replace') return layoutTables(gen);

  if (mode === 'edit') {
    const fresh = gen.filter((t) => !Number.isFinite(t.x) || !Number.isFinite(t.y));
    const placed = gen.filter((t) => !fresh.includes(t));
    return layoutTables(gen, fresh.map((t) => t.id), rightOf(placed), 60);
  }

  // merge
  const cur = structuredClone(current.tables ?? []);
  const tMap = new Map(); const cMap = new Map();
  const added = [];
  for (const t of gen) {
    const same = cur.find((o) => key(o.name) === key(t.name));
    if (!same) { added.push(t); continue; }
    tMap.set(t.id, same.id);
    const samePk = same.columns.filter((c) => c.pk);
    for (const c of t.columns) {
      const m = same.columns.find((o) => key(o.name) === key(c.name)) || (c.pk && samePk.length === 1 ? samePk[0] : null);
      if (m) cMap.set(c.id, m.id);
    }
  }
  // ids en collision avec le schéma courant (improbable) : renommés partout
  const curIds = new Set(cur.flatMap((t) => [t.id, ...t.columns.map((c) => c.id), ...t.indexes.map((i) => i.id)]));
  const ren = new Map();
  const fix = (id, p) => { if (!curIds.has(id)) return id; const n = `${p}_${rnd()}`; ren.set(id, n); return n; };
  for (const t of added) { t.id = fix(t.id, 't'); t.columns.forEach((c) => { c.id = fix(c.id, 'c'); }); t.indexes.forEach((i) => { i.id = fix(i.id, 'i'); }); }
  const r = (id) => ren.get(id) ?? id;
  for (const t of added) {
    t.indexes.forEach((i) => { i.columns = i.columns.map(r); });
    for (const c of t.columns) {
      if (!c.ref) continue;
      if (!tMap.has(c.ref.table)) { c.ref = { ...c.ref, table: r(c.ref.table), column: r(c.ref.column) }; continue; }
      const tgt = cur.find((o) => o.id === tMap.get(c.ref.table));
      const col = cMap.get(c.ref.column) || tgt.columns.find((x) => x.pk)?.id;
      if (col) {
        c.ref = { ...c.ref, table: tgt.id, column: col };
        const cc = tgt.columns.find((x) => x.id === col);
        c.type = cc.type === 'increments' ? 'integer' : cc.type === 'bigIncrements' ? 'bigInteger' : cc.type;
      } else c.ref = null;
    }
  }
  const n = cur.length;
  added.forEach((t, i) => { t.color = AI_COLORS[(n + i) % AI_COLORS.length]; });
  layoutTables(added, null, rightOf(cur), 60);
  return [...cur, ...added];
}
