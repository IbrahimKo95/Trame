// Export DBML (dbdiagram.io).
import {
  planOrder, resolveRef, pkColumns, isAuto, isRequired, normAction, parseDefault,
  enumValues, oneLine, tName, cName, columnById, isOneToOne,
} from './types.mjs';

const ident = (s) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`);
const note = (s) => `'${oneLine(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function dbmlType(c) {
  const len = Number.isInteger(c.length) && c.length > 0 ? c.length : 255;
  const prec = Number.isInteger(c.precision) && c.precision > 0 ? c.precision : 10;
  const scale = Number.isInteger(c.scale) && c.scale >= 0 ? c.scale : 2;
  switch (c.type) {
    case 'increments':
    case 'integer': return 'int';
    case 'bigIncrements':
    case 'bigInteger': return 'bigint';
    case 'smallInteger': return 'smallint';
    case 'decimal': return `decimal(${prec},${scale})`;
    case 'float': return 'float';
    case 'boolean': return 'boolean';
    case 'string': return `varchar(${len})`;
    case 'enum': return `varchar(${len})`;
    case 'binary': return 'blob';
    default: return c.type || 'varchar';
  }
}

function defaultSetting(c) {
  const p = parseDefault(c.default);
  if (!p) return null;
  switch (p.kind) {
    case 'null': return 'default: null';
    case 'bool': return `default: ${p.value}`;
    case 'number': return `default: ${p.value}`;
    case 'string': return `default: ${note(p.value)}`;
    default: return `default: \`${p.raw.replace(/`/g, '')}\``;
  }
}

/** Exporte un schéma au format DBML. */
export function toDbml(schema) {
  const { ordered } = planOrder(schema);
  const out = [`// Schéma "${oneLine(schema?.name)}" — DBML généré par Trame`];
  const enums = [];
  const refs = [];

  for (const t of ordered) {
    const cols = t.columns ?? [];
    const pks = pkColumns(t);
    const head = /^#[0-9a-fA-F]{3,8}$/.test(t.color ?? '') ? ` [headercolor: ${t.color}]` : '';
    out.push('', `Table ${ident(tName(t))}${head} {`);
    for (const c of cols) {
      let type = dbmlType(c);
      const vals = enumValues(c);
      if (c.type === 'enum' && vals.length) {
        const ename = `${tName(t)}_${cName(c)}`;
        enums.push({ name: ename, values: vals });
        type = ident(ename);
      }
      const set = [];
      if (c.pk && pks.length === 1) set.push('pk');
      if (isAuto(c)) set.push('increment');
      set.push(isRequired(c) ? 'not null' : 'null');
      if (c.unique && !(c.pk && pks.length === 1)) set.push('unique');
      const d = isAuto(c) ? null : defaultSetting(c);
      if (d) set.push(d);
      if (c.comment) set.push(`note: ${note(c.comment)}`);
      out.push(`  ${ident(cName(c))} ${type} [${set.join(', ')}]`);
    }
    if (t.comment) out.push('', `  Note: ${note(t.comment)}`);

    const idx = [];
    if (pks.length > 1) idx.push(`(${pks.map((c) => ident(cName(c))).join(', ')}) [pk]`);
    for (const ix of t.indexes ?? []) {
      const names = (ix.columns ?? []).map((id) => columnById(t, id)).filter(Boolean).map((c) => ident(cName(c)));
      if (!names.length) continue;
      const set = [];
      if (ix.unique) set.push('unique');
      if (ix.name) set.push(`name: ${note(ix.name)}`);
      const target = names.length === 1 ? names[0] : `(${names.join(', ')})`;
      idx.push(`${target}${set.length ? ` [${set.join(', ')}]` : ''}`);
    }
    if (idx.length) out.push('', '  indexes {', ...idx.map((l) => `    ${l}`), '  }');
    out.push('}');

    for (const c of cols) {
      const r = resolveRef(schema, c);
      if (!r) continue;
      const op = isOneToOne(t, c) ? '-' : '>';
      const set = [];
      const del = normAction(c.ref.onDelete);
      const upd = normAction(c.ref.onUpdate);
      if (del !== 'no action') set.push(`delete: ${del}`);
      if (upd !== 'no action') set.push(`update: ${upd}`);
      refs.push(`Ref: ${ident(tName(t))}.${ident(cName(c))} ${op} ${ident(tName(r.table))}.${ident(cName(r.column))}${set.length ? ` [${set.join(', ')}]` : ''}`);
    }
  }

  if (enums.length) {
    const seen = new Set();
    for (const e of enums) {
      if (seen.has(e.name)) continue;
      seen.add(e.name);
      out.push('', `Enum ${ident(e.name)} {`, ...e.values.map((v) => `  ${ident(v)}`), '}');
    }
  }
  if (refs.length) out.push('', ...refs);
  return out.join('\n') + '\n';
}
