// Types logiques, actions FK et helpers partagés par tous les exporteurs.
// JS pur, aucune dépendance.
//
// Champs optionnels de colonne (non requis par MODEL.md, utilisés s'ils existent) :
//   length (string, défaut 255), precision / scale (decimal, défaut 10 / 2),
//   enumValues (enum : liste de chaînes ; sans valeurs, l'enum est exporté en texte).

export const TYPES = [
  { id: 'increments', label: 'Increments (int auto)', hasLength: false, hasPrecision: false },
  { id: 'bigIncrements', label: 'Big increments (bigint auto)', hasLength: false, hasPrecision: false },
  { id: 'integer', label: 'Integer', hasLength: false, hasPrecision: false },
  { id: 'bigInteger', label: 'Big integer', hasLength: false, hasPrecision: false },
  { id: 'smallInteger', label: 'Small integer', hasLength: false, hasPrecision: false },
  { id: 'decimal', label: 'Decimal', hasLength: false, hasPrecision: true },
  { id: 'float', label: 'Float', hasLength: false, hasPrecision: false },
  { id: 'boolean', label: 'Boolean', hasLength: false, hasPrecision: false },
  { id: 'string', label: 'String (varchar)', hasLength: true, hasPrecision: false },
  { id: 'text', label: 'Text', hasLength: false, hasPrecision: false },
  { id: 'uuid', label: 'UUID', hasLength: false, hasPrecision: false },
  { id: 'date', label: 'Date', hasLength: false, hasPrecision: false },
  { id: 'datetime', label: 'Datetime', hasLength: false, hasPrecision: false },
  { id: 'timestamp', label: 'Timestamp', hasLength: false, hasPrecision: false },
  { id: 'time', label: 'Time', hasLength: false, hasPrecision: false },
  { id: 'json', label: 'JSON', hasLength: false, hasPrecision: false },
  { id: 'enum', label: 'Enum', hasLength: false, hasPrecision: false },
  { id: 'binary', label: 'Binary', hasLength: false, hasPrecision: false },
];

export const ACTIONS = ['no action', 'cascade', 'set null', 'restrict', 'set default'];

export const DIALECTS = ['postgres', 'mysql', 'sqlite'];

// ---------------------------------------------------------------- lookups

export const tableById = (schema, id) => (schema?.tables ?? []).find((t) => t.id === id) ?? null;
export const columnById = (table, id) => (table?.columns ?? []).find((c) => c.id === id) ?? null;

/** Nom SQL d'une table / colonne, avec repli sur l'id si le nom est vide. */
export const tName = (t) => String(t?.name ?? '').trim() || String(t?.id ?? 'table');
export const cName = (c) => String(c?.name ?? '').trim() || String(c?.id ?? 'column');

/** Résout column.ref -> { table, column } ou null si la cible n'existe pas. */
export function resolveRef(schema, col) {
  if (!col?.ref) return null;
  const table = tableById(schema, col.ref.table);
  const column = table ? columnById(table, col.ref.column) : null;
  return table && column ? { table, column } : null;
}

export const isPk = (c) => !!c?.pk;
export const pkColumns = (t) => (t?.columns ?? []).filter(isPk);
export const isRequired = (c) => !!c.pk || c.nullable === false;

const INTEGER_TYPES = new Set(['increments', 'bigIncrements', 'integer', 'bigInteger', 'smallInteger']);
export const isIntegerType = (type) => INTEGER_TYPES.has(type);
/** Colonne auto-incrémentée (type *Increments, ou entier avec autoIncrement). */
export const isAuto = (c) =>
  c.type === 'increments' || c.type === 'bigIncrements' || (!!c.autoIncrement && isIntegerType(c.type));

export const normAction = (a) => (ACTIONS.includes(String(a ?? '').toLowerCase()) ? String(a).toLowerCase() : 'no action');

/** Une FK est 1-1 si la colonne est unique ou si c'est l'unique colonne de PK. */
export function isOneToOne(table, col) {
  return !!col.unique || (!!col.pk && pkColumns(table).length === 1);
}

// ---------------------------------------------------------------- topo sort

function dependencies(schema) {
  const deps = new Map();
  for (const t of schema?.tables ?? []) {
    const set = new Set();
    for (const c of t.columns ?? []) {
      const r = resolveRef(schema, c);
      if (r && r.table.id !== t.id) set.add(r.table.id);
    }
    deps.set(t.id, set);
  }
  return deps;
}

/**
 * Ordonne les tables pour que les tables référencées soient avant celles qui les
 * référencent. Ordre initial conservé quand c'est possible. Tolère les cycles
 * (une table du cycle est placée en premier, ses FK seront à différer) et
 * ignore les auto-références et les FK pointant vers une cible inexistante.
 */
export function topoSort(schema) {
  const tables = schema?.tables ?? [];
  const deps = dependencies(schema);
  const placed = new Set();
  const out = [];

  const inCycle = (startId) => {
    const seen = new Set();
    const stack = [...deps.get(startId)].filter((d) => !placed.has(d));
    while (stack.length) {
      const id = stack.pop();
      if (id === startId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const d of deps.get(id) ?? []) if (!placed.has(d)) stack.push(d);
    }
    return false;
  };

  while (out.length < tables.length) {
    const remaining = tables.filter((t) => !placed.has(t.id));
    let next = remaining.find((t) => [...deps.get(t.id)].every((d) => placed.has(d)));
    if (!next) {
      // cycle : on casse sur une table réellement dans un cycle, la moins dépendante
      let cands = remaining.filter((t) => inCycle(t.id));
      if (!cands.length) cands = remaining;
      const unplaced = (t) => [...deps.get(t.id)].filter((d) => !placed.has(d)).length;
      next = cands.reduce((best, t) => (unplaced(t) < unplaced(best) ? t : best), cands[0]);
    }
    placed.add(next.id);
    out.push(next);
  }
  return out;
}

/** Clé d'identification d'une FK (table + colonne). */
export const fkKey = (table, col) => `${table.id}:${col.id}`;

/**
 * Plan d'ordonnancement : tables triées + ensemble des FK à différer
 * (celles dont la cible est créée après la table source ; auto-références exclues).
 */
export function planOrder(schema) {
  const ordered = topoSort(schema);
  const index = new Map(ordered.map((t, i) => [t.id, i]));
  const deferred = new Set();
  for (const t of ordered) {
    for (const c of t.columns ?? []) {
      const r = resolveRef(schema, c);
      if (r && r.table.id !== t.id && index.get(r.table.id) > index.get(t.id)) deferred.add(fkKey(t, c));
    }
  }
  return { ordered, deferred };
}

// ---------------------------------------------------------------- nommage

function words(str) {
  const s = String(str ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

export const snake = (s) => words(s).join('_');
export const pascal = (s) => words(s).map(cap).join('');
export const camel = (s) => {
  const w = words(s);
  return w.map((x, i) => (i === 0 ? x : cap(x))).join('');
};

const IRREGULAR = { people: 'person', children: 'child', men: 'man', women: 'woman', mice: 'mouse', media: 'medium', data: 'data', series: 'series' };

export function singularWord(w) {
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (/(ss|us|is)$/.test(w)) return w;
  if (/ies$/.test(w) && w.length > 3) return w.slice(0, -3) + 'y';
  if (/(sses|xes|ches|shes|zes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && w.length > 1) return w.slice(0, -1);
  return w;
}

/** Singularise le dernier mot d'un nom (users -> user, order_items -> order_item). */
export function singular(name) {
  const w = words(name);
  if (!w.length) return '';
  w[w.length - 1] = singularWord(w[w.length - 1]);
  return w.join('_');
}

/** Garantit l'unicité d'un nom dans `used` (ajoute 2, 3, ... au besoin) et l'y enregistre. */
export function uniqueName(base, used) {
  let name = base;
  let i = 2;
  while (used.has(name)) name = `${base}${i++}`;
  used.add(name);
  return name;
}

const ident = (s, prefix) => (/^[0-9]/.test(s) ? prefix + s : s);

// ---------------------------------------------------------------- defaults

/**
 * Analyse une expression SQL par défaut.
 * -> null (aucun défaut) | { kind: 'null'|'bool'|'number'|'string'|'now'|'uuid'|'raw', value, raw }
 */
export function parseDefault(expr) {
  const raw = String(expr ?? '').trim();
  if (!raw) return null;
  if (/^null$/i.test(raw)) return { kind: 'null', value: null, raw };
  if (/^(true|false)$/i.test(raw)) return { kind: 'bool', value: raw.toLowerCase() === 'true', raw };
  if (/^[-+]?\d+(\.\d+)?$/.test(raw)) return { kind: 'number', value: raw.replace(/^\+/, ''), raw };
  const m = raw.match(/^'((?:[^']|'')*)'$/);
  if (m) return { kind: 'string', value: m[1].replace(/''/g, "'"), raw };
  if (/^(current_timestamp(\(\d*\))?|now\(\)|localtimestamp(\(\d*\))?)$/i.test(raw)) return { kind: 'now', value: null, raw };
  if (/^(gen_random_uuid\(\)|uuid_generate_v4\(\)|uuid\(\))$/i.test(raw)) return { kind: 'uuid', value: null, raw };
  return { kind: 'raw', value: raw, raw };
}

/** Valeurs d'enum nettoyées (tableau de chaînes) ou []. */
export function enumValues(c) {
  return Array.isArray(c.enumValues) ? c.enumValues.map(String).filter((v) => v !== '') : [];
}

/** Collapse un commentaire en une ligne. */
export const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- relations (Prisma / Doctrine)

/**
 * Calcule noms de modèles/classes, noms de champs, et relations (côté FK + côté inverse).
 * -> { models: Map(tableId -> { table, name, fields: Map(colId -> nom) }), rels: [...] }
 * rel : { from, to, col, refCol, fromModel, toModel, field, inverse, one, optional, named, relName }
 */
export function planRelations(schema) {
  const tables = schema?.tables ?? [];
  const usedModels = new Set();
  const models = new Map();
  const usedFields = new Map();

  for (const t of tables) {
    const base = ident(pascal(singular(tName(t))) || 'Model', 'T');
    const name = uniqueName(base, usedModels);
    const used = new Set();
    const fields = new Map();
    for (const c of t.columns ?? []) {
      fields.set(c.id, uniqueName(ident(camel(cName(c)) || 'field', '_'), used));
    }
    models.set(t.id, { table: t, name, fields });
    usedFields.set(t.id, used);
  }

  // regroupement des FK par (source, cible) pour détecter les relations à nommer
  const pairCount = new Map();
  const fks = [];
  for (const t of tables) {
    for (const c of t.columns ?? []) {
      const r = resolveRef(schema, c);
      if (!r) continue;
      fks.push({ t, c, r });
      const k = `${t.id}>${r.table.id}`;
      pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
    }
  }

  const rels = [];
  for (const { t, c, r } of fks) {
    const from = models.get(t.id);
    const to = models.get(r.table.id);
    const stripped = snake(cName(c)).replace(/_id$/, '');
    const fieldBase = stripped && stripped !== snake(cName(c)) ? camel(stripped) : camel(to.name);
    const field = uniqueName(ident(fieldBase, '_'), usedFields.get(t.id));
    const one = isOneToOne(t, c);
    const named = t.id === r.table.id || pairCount.get(`${t.id}>${r.table.id}`) > 1;
    const invBase = one ? camel(from.name) : camel(tName(t));
    const inverseBase = named ? `${invBase}As${cap(field)}` : invBase;
    const inverse = uniqueName(ident(inverseBase, '_'), usedFields.get(r.table.id));
    rels.push({
      from: t, to: r.table, col: c, refCol: r.column,
      fromModel: from.name, toModel: to.name,
      field, inverse, one, optional: !isRequired(c), named,
      relName: `${from.name}_${field}`,
    });
  }
  return { models, rels };
}
