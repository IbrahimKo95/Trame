// Export SQL (postgres, mysql, sqlite).
import {
  DIALECTS, planOrder, resolveRef, pkColumns, isAuto, isRequired, normAction,
  parseDefault, enumValues, oneLine, tName, cName, columnById, fkKey,
} from './types.mjs';

const DIALECT_INFO = {
  postgres: { q: (s) => `"${s.replace(/"/g, '""')}"`, maxId: 63 },
  mysql: { q: (s) => `\`${s.replace(/`/g, '``')}\``, maxId: 64 },
  sqlite: { q: (s) => `"${s.replace(/"/g, '""')}"`, maxId: 1000 },
};

const str = (s) => `'${String(s).replace(/'/g, "''")}'`;
const mysqlStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;

function sqlType(c, d) {
  const len = Number.isInteger(c.length) && c.length > 0 ? c.length : 255;
  const prec = Number.isInteger(c.precision) && c.precision > 0 ? c.precision : 10;
  const scale = Number.isInteger(c.scale) && c.scale >= 0 ? c.scale : 2;
  const pg = d === 'postgres';
  const my = d === 'mysql';
  switch (c.type) {
    case 'increments':
    case 'integer': return my ? 'INT' : 'INTEGER';
    case 'bigIncrements':
    case 'bigInteger': return pg || my ? 'BIGINT' : 'INTEGER';
    case 'smallInteger': return pg || my ? 'SMALLINT' : 'INTEGER';
    case 'decimal': return d === 'sqlite' ? 'NUMERIC' : `${pg ? 'NUMERIC' : 'DECIMAL'}(${prec}, ${scale})`;
    case 'float': return pg ? 'DOUBLE PRECISION' : my ? 'DOUBLE' : 'REAL';
    case 'boolean': return 'BOOLEAN';
    case 'string': return `VARCHAR(${len})`;
    case 'text': return 'TEXT';
    case 'uuid': return pg ? 'UUID' : my ? 'CHAR(36)' : 'TEXT';
    case 'date': return 'DATE';
    case 'datetime': return my || d === 'sqlite' ? 'DATETIME' : 'TIMESTAMP';
    case 'timestamp': return pg ? 'TIMESTAMPTZ' : 'TIMESTAMP';
    case 'time': return 'TIME';
    case 'json': return pg ? 'JSONB' : my ? 'JSON' : 'TEXT';
    case 'enum': {
      const vals = enumValues(c);
      if (my && vals.length) return `ENUM(${vals.map(mysqlStr).join(', ')})`;
      return `VARCHAR(${len})`;
    }
    case 'binary': return pg ? 'BYTEA' : 'BLOB';
    default: return 'TEXT';
  }
}

function serialType(c) {
  if (c.type === 'bigIncrements' || c.type === 'bigInteger') return 'BIGSERIAL';
  if (c.type === 'smallInteger') return 'SMALLSERIAL';
  return 'SERIAL';
}

function defaultSql(c, d) {
  const p = parseDefault(c.default);
  if (!p || p.kind === 'null') return null;
  const s = p.raw;
  if (d === 'postgres') return s;
  if (d === 'sqlite') {
    if (p.kind === 'now') return 'CURRENT_TIMESTAMP';
    if (p.kind === 'uuid') return '(lower(hex(randomblob(16))))';
    if (['bool', 'number', 'string'].includes(p.kind)) return s;
    return s.startsWith('(') ? s : `(${s})`;
  }
  if (p.kind === 'uuid') return '(UUID())';
  // mysql : les défauts "expression" (et tout défaut sur TEXT/JSON/BLOB) exigent des parenthèses
  if (s.startsWith('(')) return s;
  if (['text', 'json', 'binary'].includes(c.type)) return `(${s})`;
  if (p.kind === 'raw' || p.kind === 'uuid') return `(${s})`;
  return s;
}

const limit = (name, n) => (name.length <= n ? name : name.slice(0, n));

/** Exporte un schéma en SQL pour le dialecte demandé. */
export function toSql(schema, dialect = schema?.dialect) {
  const d = dialect ?? 'postgres';
  if (!DIALECTS.includes(d)) throw new Error(`Dialecte SQL inconnu : ${d}`);
  const { q, maxId } = DIALECT_INFO[d];
  const { ordered, deferred } = planOrder(schema);
  const out = [];
  const usedConstraints = new Set();
  const alters = [];
  const indexStmts = [];
  const pgComments = [];

  out.push(`-- Schéma "${oneLine(schema?.name)}" : SQL ${d} généré par Trame`);

  const fkSql = (t, c, r) => {
    let base = `fk_${tName(t)}_${cName(c)}`;
    let name = limit(base, maxId);
    let i = 2;
    while (usedConstraints.has(name)) name = limit(base, maxId - String(i).length) + i++;
    usedConstraints.add(name);
    let sql = `CONSTRAINT ${q(name)} FOREIGN KEY (${q(cName(c))}) REFERENCES ${q(tName(r.table))} (${q(cName(r.column))})`;
    const del = normAction(c.ref.onDelete);
    const upd = normAction(c.ref.onUpdate);
    if (del !== 'no action') sql += ` ON DELETE ${del.toUpperCase()}`;
    if (upd !== 'no action') sql += ` ON UPDATE ${upd.toUpperCase()}`;
    return sql;
  };

  if (!ordered.length) out.push('', '-- (aucune table)');

  for (const t of ordered) {
    const cols = t.columns ?? [];
    const pks = pkColumns(t);
    const items = []; // { sql, pre: [] }

    if (!cols.length) {
      if (d === 'postgres') {
        out.push('', `CREATE TABLE ${q(tName(t))} ();`);
      } else {
        out.push('', `-- Table ${q(tName(t))} ignorée : aucune colonne (${d} n'accepte pas les tables vides)`);
      }
      continue;
    }

    for (const c of cols) {
      const auto = isAuto(c);
      const pre = [];
      if (d === 'sqlite' && c.comment) pre.push(oneLine(c.comment));
      const parts = [q(cName(c))];
      const soloPk = c.pk && pks.length === 1;

      if (d === 'sqlite' && auto && soloPk) {
        parts.push('INTEGER PRIMARY KEY AUTOINCREMENT');
        items.push({ sql: parts.join(' '), pre });
        continue;
      }

      parts.push(d === 'postgres' && auto ? serialType(c) : sqlType(c, d));
      if (isRequired(c)) parts.push('NOT NULL');
      else if (d === 'mysql' && c.type === 'timestamp') parts.push('NULL'); // évite le défaut implicite de MySQL
      const autoMy = d === 'mysql' && auto;
      if (autoMy) parts.push('AUTO_INCREMENT');
      if (!auto) {
        const def = defaultSql(c, d);
        if (def) parts.push(`DEFAULT ${def}`);
      }
      // MySQL exige qu'une colonne AUTO_INCREMENT soit indexée
      if ((c.unique && !soloPk) || (autoMy && !c.pk && !c.unique)) parts.push('UNIQUE');
      if (c.type === 'enum' && d !== 'mysql') {
        const vals = enumValues(c);
        if (vals.length) parts.push(`CHECK (${q(cName(c))} IN (${vals.map(str).join(', ')}))`);
      }
      if (d === 'mysql' && c.comment) parts.push(`COMMENT ${mysqlStr(c.comment)}`);
      items.push({ sql: parts.join(' '), pre });
    }

    const inlinePk = d === 'sqlite' && pks.length === 1 && isAuto(pks[0]);
    if (pks.length && !inlinePk) {
      items.push({ sql: `PRIMARY KEY (${pks.map((c) => q(cName(c))).join(', ')})`, pre: [] });
    }

    for (const c of cols) {
      const r = resolveRef(schema, c);
      if (!r) continue;
      const key = fkKey(t, c);
      // SQLite n'a pas d'ALTER TABLE ADD CONSTRAINT : les FK restent inline (elles peuvent
      // pointer vers une table créée plus tard).
      if (deferred.has(key) && d !== 'sqlite') {
        alters.push(`ALTER TABLE ${q(tName(t))} ADD ${fkSql(t, c, r)};`);
      } else {
        items.push({ sql: fkSql(t, c, r), pre: [] });
      }
    }

    const body = items
      .map((it, i) => it.pre.map((l) => `  -- ${l}`).concat(`  ${it.sql}${i < items.length - 1 ? ',' : ''}`).join('\n'))
      .join('\n');
    let head = '';
    if (d === 'sqlite' && t.comment) head = `-- ${oneLine(t.comment)}\n`;
    let tail = ')';
    if (d === 'mysql') {
      tail += ' ENGINE=InnoDB';
      if (t.comment) tail += ` COMMENT=${mysqlStr(t.comment)}`;
    }
    out.push('', `${head}CREATE TABLE ${q(tName(t))} (\n${body}\n${tail};`);

    for (const ix of t.indexes ?? []) {
      const names = (ix.columns ?? []).map((id) => columnById(t, id)).filter(Boolean).map(cName);
      if (!names.length) continue;
      const iname = ix.name || `${tName(t)}_${names.join('_')}_${ix.unique ? 'uniq' : 'idx'}`;
      indexStmts.push(
        `CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX ${q(limit(iname, maxId))} ON ${q(tName(t))} (${names.map(q).join(', ')});`,
      );
    }

    if (d === 'postgres') {
      if (t.comment) pgComments.push(`COMMENT ON TABLE ${q(tName(t))} IS ${str(t.comment)};`);
      for (const c of cols) {
        if (c.comment) pgComments.push(`COMMENT ON COLUMN ${q(tName(t))}.${q(cName(c))} IS ${str(c.comment)};`);
      }
    }
  }

  if (alters.length) out.push('', '-- Clés étrangères différées (dépendances circulaires)', ...alters);
  if (indexStmts.length) out.push('', ...indexStmts);
  if (pgComments.length) out.push('', ...pgComments);
  return out.join('\n') + '\n';
}
