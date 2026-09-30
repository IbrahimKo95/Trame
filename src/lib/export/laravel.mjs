// Export Laravel : une migration par table, dans l'ordre topologique.
import {
  planOrder, resolveRef, pkColumns, isAuto, isRequired, normAction, parseDefault,
  enumValues, oneLine, snake, tName, cName, columnById, fkKey,
} from './types.mjs';

const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const phpList = (arr) => `[${arr.map(phpStr).join(', ')}]`;

// Noms Laravel : snake_case, repli sur l'id si le nom est inexploitable.
const tn = (t) => snake(tName(t)) || snake(t.id) || 'table';
const cn = (c) => snake(cName(c)) || snake(c.id) || 'column';

const STAMP = '2024_01_01';
const fileName = (i, slug) => `${STAMP}_${String(i).padStart(6, '0')}_${slug}.php`;

const HEADER = (usesDb) => `<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\${usesDb ? 'DB;\nuse Illuminate\\Support\\Facades\\' : ''}Schema;
`;

/** Table d'un type "auto" de clé -> type non signé à utiliser pour une FK qui le cible. */
function fkColumnOverride(target) {
  if (target.type === 'bigIncrements') return 'unsignedBigInteger';
  if (target.type === 'increments') return 'unsignedInteger';
  return null;
}

function defaultModifier(c, ctx) {
  const p = parseDefault(c.default);
  if (!p || p.kind === 'null') return null;
  switch (p.kind) {
    case 'bool': return `default(${p.value})`;
    case 'number': return `default(${p.value})`;
    case 'string': return `default(${phpStr(p.value)})`;
    case 'now': return 'useCurrent()';
    default:
      ctx.usesDb = true;
      return `default(DB::raw(${phpStr(p.raw)}))`;
  }
}

function typeCall(c, name, override) {
  const t = override ?? c.type;
  const len = Number.isInteger(c.length) && c.length > 0 ? c.length : 255;
  const prec = Number.isInteger(c.precision) && c.precision > 0 ? c.precision : 10;
  const scale = Number.isInteger(c.scale) && c.scale >= 0 ? c.scale : 2;
  const n = phpStr(name);
  switch (t) {
    case 'increments': return `increments(${n})`;
    case 'bigIncrements': return `bigIncrements(${n})`;
    case 'integer': return `integer(${n})`;
    case 'bigInteger': return `bigInteger(${n})`;
    case 'smallInteger': return `smallInteger(${n})`;
    case 'unsignedBigInteger': return `unsignedBigInteger(${n})`;
    case 'unsignedInteger': return `unsignedInteger(${n})`;
    case 'decimal': return `decimal(${n}, ${prec}, ${scale})`;
    case 'float': return `float(${n})`;
    case 'boolean': return `boolean(${n})`;
    case 'string': return len === 255 ? `string(${n})` : `string(${n}, ${len})`;
    case 'text': return `text(${n})`;
    case 'uuid': return `uuid(${n})`;
    case 'date': return `date(${n})`;
    case 'datetime': return `dateTime(${n})`;
    case 'timestamp': return `timestamp(${n})`;
    case 'time': return `time(${n})`;
    case 'json': return `json(${n})`;
    case 'enum': {
      const vals = enumValues(c);
      return vals.length ? `enum(${n}, ${phpList(vals)})` : `string(${n})`;
    }
    case 'binary': return `binary(${n})`;
    default: return `string(${n})`;
  }
}

function actionCalls(ref) {
  const out = [];
  const del = normAction(ref.onDelete);
  const upd = normAction(ref.onUpdate);
  const pick = (a, dir) => {
    const D = dir === 'Delete' ? 'Delete' : 'Update';
    switch (a) {
      case 'cascade': return `cascadeOn${D}()`;
      case 'restrict': return `restrictOn${D}()`;
      case 'set null': return `nullOn${D}()`;
      case 'set default': return `on${D}('set default')`;
      default: return null;
    }
  };
  const d = pick(del, 'Delete');
  const u = pick(upd, 'Update');
  if (d) out.push(d);
  if (u) out.push(u);
  return out;
}

/**
 * Colonnes d'une table (corps de Schema::create). Retourne { lines, usesDb }.
 * `deferred` : ensemble des FK à ne pas créer ici.
 */
function tableBody(schema, t, deferred) {
  const ctx = { usesDb: false };
  const cols = t.columns ?? [];
  const pks = pkColumns(t);
  const lines = [];
  const after = []; // contraintes à placer après les colonnes
  const hasTimestamps = (() => {
    const ca = cols.find((c) => cn(c) === 'created_at');
    const ua = cols.find((c) => cn(c) === 'updated_at');
    const ok = (c) => c && c.type === 'timestamp' && c.nullable === true && !c.pk && !c.unique && !c.ref && !parseDefault(c.default);
    return ok(ca) && ok(ua) ? { ca, ua } : null;
  })();
  let stampDone = false;

  if (t.comment) after.push(`$table->comment(${phpStr(oneLine(t.comment))});`);

  for (const c of cols) {
    if (hasTimestamps && (c === hasTimestamps.ca || c === hasTimestamps.ua)) {
      if (!stampDone) { lines.push('$table->timestamps();'); stampDone = true; }
      continue;
    }
    const name = cn(c);
    const r = resolveRef(schema, c);
    const isDeferred = !!r && deferred.has(fkKey(t, c));
    const mods = [];
    const soloPk = c.pk && pks.length === 1;
    let call;

    const modsCommon = () => {
      if (!isRequired(c)) mods.push('nullable()');
      const dm = defaultModifier(c, ctx);
      if (dm) mods.push(dm);
      if (c.unique && !soloPk) mods.push('unique()');
      if (c.comment) mods.push(`comment(${phpStr(oneLine(c.comment))})`);
    };

    if (isAuto(c) && soloPk && !r) {
      if (c.type === 'bigIncrements' && name === 'id') call = 'id()';
      else if (c.type === 'increments' || c.type === 'bigIncrements') call = typeCall(c, name);
      else call = `${typeCall(c, name)}->autoIncrement()`;
      if (c.comment) mods.push(`comment(${phpStr(oneLine(c.comment))})`);
      lines.push(`$table->${call}${mods.map((m) => '->' + m).join('')};`);
      continue;
    }

    if (r) {
      const target = r.column;
      const tt = tn(r.table);
      const tc = cn(target);
      const actions = actionCalls(c.ref);
      const override = fkColumnOverride(target);
      const helper = !isDeferred && cn(target) === 'id' && (target.type === 'bigIncrements' ? 'foreignId' : target.type === 'uuid' ? 'foreignUuid' : null);
      if (helper) {
        modsCommon();
        if (soloPk) mods.unshift('primary()');
        const cons = `constrained(${phpStr(tt)})`;
        lines.push(`$table->${helper}(${phpStr(name)})${mods.map((m) => '->' + m).join('')}->${cons}${actions.map((a) => '->' + a).join('')};`);
        continue;
      }
      // colonne simple + foreign()->references()->on() (après les colonnes, ou différé)
      call = typeCall(c, name, override);
      modsCommon();
      if (soloPk) mods.unshift('primary()');
      lines.push(`$table->${call}${mods.map((m) => '->' + m).join('')};`);
      if (!isDeferred) {
        after.push(`$table->foreign(${phpStr(name)})->references(${phpStr(tc)})->on(${phpStr(tt)})${actions.map((a) => '->' + a).join('')};`);
      }
      continue;
    }

    // auto-incrément dans une PK composite : *increments créerait une 2e clé primaire
    const ov = !soloPk && (c.type === 'increments' || c.type === 'bigIncrements') ? fkColumnOverride(c) : null;
    call = typeCall(c, name, ov);
    modsCommon();
    if (soloPk) mods.unshift('primary()');
    lines.push(`$table->${call}${mods.map((m) => '->' + m).join('')};`);
  }

  if (pks.length > 1) after.unshift(`$table->primary(${phpList(pks.map(cn))});`);
  // FK classées après PK composite mais avant les index
  for (const ix of t.indexes ?? []) {
    const names = (ix.columns ?? []).map((id) => columnById(t, id)).filter(Boolean).map(cn);
    if (!names.length) continue;
    const arg = names.length === 1 ? phpStr(names[0]) : phpList(names);
    const nm = ix.name ? `, ${phpStr(ix.name)}` : '';
    after.push(`$table->${ix.unique ? 'unique' : 'index'}(${arg}${nm});`);
  }
  return { lines: [...lines, ...after], usesDb: ctx.usesDb };
}

function wrap(usesDb, up, down) {
  const ind = (arr, n) => arr.map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');
  return `${HEADER(usesDb)}
return new class extends Migration
{
    public function up(): void
    {
${ind(up, 8)}
    }

    public function down(): void
    {
${ind(down, 8)}
    }
};
`;
}

/** Exporte un schéma en migrations Laravel : [{ filename, content }]. */
export function toLaravel(schema) {
  const { ordered, deferred } = planOrder(schema);
  const files = [];
  let i = 1;

  for (const t of ordered) {
    const { lines, usesDb } = tableBody(schema, t, deferred);
    const up = [`Schema::create(${phpStr(tn(t))}, function (Blueprint $table) {`, ...lines.map((l) => '    ' + l), '});'];
    const down = [`Schema::dropIfExists(${phpStr(tn(t))});`];
    files.push({ filename: fileName(i++, `create_${tn(t)}_table`), content: wrap(usesDb, up, down) });
  }

  // FK différées (cycles) : une migration finale
  const up = [];
  const down = [];
  for (const t of ordered) {
    const fks = [];
    const drops = [];
    for (const c of t.columns ?? []) {
      if (!deferred.has(fkKey(t, c))) continue;
      const r = resolveRef(schema, c);
      const actions = actionCalls(c.ref);
      fks.push(`$table->foreign(${phpStr(cn(c))})->references(${phpStr(cn(r.column))})->on(${phpStr(tn(r.table))})${actions.map((a) => '->' + a).join('')};`);
      drops.push(`$table->dropForeign([${phpStr(cn(c))}]);`);
    }
    if (fks.length) {
      up.push(`Schema::table(${phpStr(tn(t))}, function (Blueprint $table) {`, ...fks.map((l) => '    ' + l), '});');
      down.push(`Schema::table(${phpStr(tn(t))}, function (Blueprint $table) {`, ...drops.map((l) => '    ' + l), '});');
    }
  }
  if (up.length) {
    files.push({ filename: fileName(i++, 'add_foreign_keys'), content: wrap(false, up, down) });
  }
  return files;
}

/** Toutes les migrations dans une seule chaîne, séparées par des commentaires. */
export function toLaravelSingle(schema) {
  return toLaravel(schema)
    .map((f) => `// ===== ${f.filename} =====\n${f.content}`)
    .join('\n');
}
