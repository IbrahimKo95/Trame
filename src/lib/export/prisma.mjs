// Export Prisma (schema.prisma).
import {
  planRelations, planOrder, pkColumns, isAuto, isRequired, normAction, parseDefault,
  enumValues, oneLine, tName, cName, columnById, pascal,
} from './types.mjs';

const PROVIDERS = { postgres: 'postgresql', mysql: 'mysql', sqlite: 'sqlite' };
const ACTION_MAP = {
  cascade: 'Cascade', 'set null': 'SetNull', restrict: 'Restrict', 'no action': 'NoAction', 'set default': 'SetDefault',
};
const VALID_ENUM_VALUE = /^[A-Za-z][A-Za-z0-9_]*$/;

function baseType(c, dialect, enumName) {
  const native = dialect !== 'sqlite';
  const pg = dialect === 'postgres';
  const len = Number.isInteger(c.length) && c.length > 0 ? c.length : 255;
  const prec = Number.isInteger(c.precision) && c.precision > 0 ? c.precision : 10;
  const scale = Number.isInteger(c.scale) && c.scale >= 0 ? c.scale : 2;
  switch (c.type) {
    case 'increments':
    case 'integer': return { type: 'Int', attrs: [] };
    case 'smallInteger': return { type: 'Int', attrs: native ? ['@db.SmallInt'] : [] };
    case 'bigIncrements':
    case 'bigInteger': return { type: 'BigInt', attrs: [] };
    case 'decimal': return { type: 'Decimal', attrs: native ? [`@db.Decimal(${prec}, ${scale})`] : [] };
    case 'float': return { type: 'Float', attrs: [] };
    case 'boolean': return { type: 'Boolean', attrs: [] };
    case 'string': return { type: 'String', attrs: native ? [`@db.VarChar(${len})`] : [] };
    case 'text': return { type: 'String', attrs: native ? ['@db.Text'] : [] };
    case 'uuid': return { type: 'String', attrs: native ? [pg ? '@db.Uuid' : '@db.Char(36)'] : [] };
    case 'date': return { type: 'DateTime', attrs: native ? ['@db.Date'] : [] };
    case 'datetime': return { type: 'DateTime', attrs: [] };
    case 'timestamp': return { type: 'DateTime', attrs: pg ? ['@db.Timestamptz(6)'] : dialect === 'mysql' ? ['@db.Timestamp(0)'] : [] };
    case 'time': return { type: 'DateTime', attrs: native ? ['@db.Time(0)'] : [] };
    case 'json': return { type: 'Json', attrs: [] };
    case 'binary': return { type: 'Bytes', attrs: [] };
    case 'enum':
      if (enumName) return { type: enumName, attrs: [], isEnum: true };
      return { type: 'String', attrs: native ? [`@db.VarChar(${len})`] : [] };
    default: return { type: 'String', attrs: [] };
  }
}

function defaultAttr(c, type, enumVals) {
  if (isAuto(c)) return '@default(autoincrement())';
  const p = parseDefault(c.default);
  if (!p || p.kind === 'null') return null;
  const db = () => `@default(dbgenerated(${JSON.stringify(p.raw)}))`;
  if (enumVals) {
    return p.kind === 'string' && enumVals.includes(p.value) ? `@default(${p.value})` : db();
  }
  switch (type) {
    case 'String':
      if (p.kind === 'string' || p.kind === 'number') return `@default(${JSON.stringify(String(p.value))})`;
      if (p.kind === 'bool') return `@default(${JSON.stringify(String(p.value))})`;
      if (p.kind === 'uuid') return '@default(uuid())';
      return db();
    case 'Int':
    case 'BigInt':
      return p.kind === 'number' && /^[-+]?\d+$/.test(p.value) ? `@default(${p.value})` : db();
    case 'Float':
    case 'Decimal':
      return p.kind === 'number' ? `@default(${p.value})` : db();
    case 'Boolean':
      if (p.kind === 'bool') return `@default(${p.value})`;
      if (p.kind === 'number' && (p.value === '0' || p.value === '1')) return `@default(${p.value === '1'})`;
      return db();
    case 'DateTime':
      return p.kind === 'now' ? '@default(now())' : db();
    case 'Json':
      return p.kind === 'string' ? `@default(${JSON.stringify(p.value)})` : db();
    default:
      return db();
  }
}

/** Exporte un schéma au format Prisma. */
export function toPrisma(schema) {
  const dialect = PROVIDERS[schema?.dialect] ? schema.dialect : 'postgres';
  const { models, rels } = planRelations(schema);
  const { ordered } = planOrder(schema);
  const lines = [];
  const enums = [];

  lines.push(
    'generator client {',
    '  provider = "prisma-client-js"',
    '}',
    '',
    'datasource db {',
    `  provider = "${PROVIDERS[dialect]}"`,
    '  url      = env("DATABASE_URL")',
    '}',
  );

  if (!ordered.length) lines.push('', '// (aucune table)');

  for (const t of ordered) {
    const m = models.get(t.id);
    const cols = t.columns ?? [];
    const pks = pkColumns(t);
    const rows = []; // [name, type, attrs, trailingComment]
    const fieldOf = (c) => m.fields.get(c.id);

    const header = [];
    if (t.comment) header.push(`/// ${oneLine(t.comment)}`);
    if (!pks.length && !cols.some((c) => c.unique && isRequired(c))) {
      header.push('// ATTENTION : Prisma exige un @id ou un @@unique ; ajoutez une clé primaire à cette table.');
    }

    for (const c of cols) {
      let enumName = null;
      let vals = null;
      if (c.type === 'enum' && dialect !== 'sqlite') {
        const ev = enumValues(c);
        if (ev.length && ev.every((v) => VALID_ENUM_VALUE.test(v)) && new Set(ev).size === ev.length) {
          enumName = `${m.name}${pascal(cName(c))}`;
          vals = ev;
          enums.push({ name: enumName, values: ev });
        }
      }
      const bt = baseType(c, dialect, enumName);
      const attrs = [];
      if (pks.length === 1 && c.pk) attrs.push('@id');
      const def = defaultAttr(c, bt.type, vals);
      if (def) attrs.push(def);
      if (c.unique && !(c.pk && pks.length === 1)) attrs.push('@unique');
      if (fieldOf(c) !== cName(c)) attrs.push(`@map(${JSON.stringify(cName(c))})`);
      attrs.push(...bt.attrs);
      const type = bt.type + (isRequired(c) ? '' : '?');
      const doc = c.comment ? `/// ${oneLine(c.comment)}` : null;
      rows.push({ name: fieldOf(c), type, attrs: attrs.join(' '), doc });
    }

    // relations côté FK
    for (const r of rels.filter((x) => x.from.id === t.id)) {
      const parts = [];
      if (r.named) parts.push(JSON.stringify(r.relName));
      parts.push(`fields: [${models.get(t.id).fields.get(r.col.id)}]`);
      parts.push(`references: [${models.get(r.to.id).fields.get(r.refCol.id)}]`);
      let note = '';
      const del = normAction(r.col.ref.onDelete);
      const upd = normAction(r.col.ref.onUpdate);
      if (del === 'set null' && !r.optional) {
        note = ' // onDelete SET NULL ignoré : colonne obligatoire';
      } else {
        parts.push(`onDelete: ${ACTION_MAP[del]}`);
      }
      parts.push(`onUpdate: ${ACTION_MAP[upd]}`);
      rows.push({ name: r.field, type: `${r.toModel}${r.optional ? '?' : ''}`, attrs: `@relation(${parts.join(', ')})${note}`, doc: null });
    }

    // relations inverses (tables qui pointent vers celle-ci)
    for (const r of rels.filter((x) => x.to.id === t.id)) {
      const rel = r.named ? ` @relation(${JSON.stringify(r.relName)})` : '';
      rows.push({ name: r.inverse, type: r.one ? `${r.fromModel}?` : `${r.fromModel}[]`, attrs: rel.trim(), doc: null });
    }

    const w1 = Math.max(0, ...rows.map((r) => r.name.length));
    const w2 = Math.max(0, ...rows.map((r) => r.type.length));
    const body = [];
    for (const r of rows) {
      if (r.doc) body.push(`  ${r.doc}`);
      body.push(`  ${r.name.padEnd(w1)} ${r.attrs ? r.type.padEnd(w2) + ' ' + r.attrs : r.type}`.trimEnd());
    }

    const block = [];
    if (pks.length > 1) block.push(`@@id([${pks.map(fieldOf).join(', ')}])`);
    for (const ix of t.indexes ?? []) {
      const fs = (ix.columns ?? []).map((id) => columnById(t, id)).filter(Boolean).map(fieldOf);
      if (!fs.length) continue;
      const map = ix.name ? `, map: ${JSON.stringify(ix.name)}` : '';
      block.push(`${ix.unique ? '@@unique' : '@@index'}([${fs.join(', ')}]${map})`);
    }
    if (m.name !== tName(t)) block.push(`@@map(${JSON.stringify(tName(t))})`);

    lines.push('', ...header, `model ${m.name} {`, ...body);
    if (block.length) lines.push('', ...block.map((b) => `  ${b}`));
    lines.push('}');
  }

  for (const e of enums) {
    lines.push('', `enum ${e.name} {`, ...e.values.map((v) => `  ${v}`), '}');
  }
  return lines.join('\n') + '\n';
}
