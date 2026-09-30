// Tests IA (conversion / validation / fusion), sans réseau : node test/ai.test.mjs
import assert from 'node:assert/strict';
import { fromCompact, toCompact, applyGenerated, layoutTables, normType, userPrompt, systemPrompt } from '../src/lib/ai/schema.mjs';
import { SAMPLE_SHOP } from '../src/lib/export/sample.mjs';
import { EXPORTERS, exportAsText } from '../src/lib/export/index.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Toutes les refs pointent vers des ids existants, ids uniques, positions numériques. */
function assertValid(tables) {
  const ids = new Set();
  for (const t of tables) {
    assert.ok(!ids.has(t.id), `id dupliqué ${t.id}`); ids.add(t.id);
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y), `position ${t.name}`);
    assert.ok(t.columns.some((c) => c.pk), `pas de PK dans ${t.name}`);
    for (const c of t.columns) { assert.ok(!ids.has(c.id), `id dupliqué ${c.id}`); ids.add(c.id); }
    for (const i of t.indexes) for (const c of i.columns) assert.ok(t.columns.some((x) => x.id === c), `index ${i.name}`);
  }
  for (const t of tables) for (const c of t.columns) if (c.ref) {
    const tt = tables.find((x) => x.id === c.ref.table);
    assert.ok(tt && tt.columns.some((x) => x.id === c.ref.column), `ref cassée ${t.name}.${c.name}`);
  }
}

const BLOG = {
  name: 'Blog',
  tables: [
    { name: 'users', columns: [{ name: 'id', type: 'bigIncrements', pk: true }, { name: 'email', type: 'varchar', unique: true, length: 190 }] },
    { name: 'posts', comment: 'Articles', columns: [
      { name: 'id', type: 'bigIncrements', pk: true },
      { name: 'user_id', type: 'integer', ref: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'status', type: 'enum', enumValues: ['draft', 'published', 'draft'], default: "'draft'" },
      { name: 'price', type: 'numeric', precision: 8, scale: 2 },
      { name: 'ghost_id', type: 'uuid', ref: { table: 'ghosts', column: 'id' } },
    ], indexes: [{ columns: ['status', 'nope'], unique: false }] },
    { name: 'tags', columns: [{ name: 'label', type: 'string' }] },
    { name: 'Posts', columns: [{ name: 'id', type: 'uuid', pk: true }] },
    { name: 'empty', columns: [] },
  ],
};

test('prompts : types et dialecte présents, taille du prompt bornée', () => {
  assert.match(systemPrompt('mysql'), /bigIncrements/);
  assert.match(systemPrompt('postgres'), /gen_random_uuid/);
  assert.ok(userPrompt('x'.repeat(5000)).length < 2100);
  assert.match(userPrompt('ajoute des avis', SAMPLE_SHOP), /"id":"t_users"/);
});

test('normType : synonymes et inconnus', () => {
  assert.equal(normType('varchar(255)'), 'string');
  assert.equal(normType('BIGINT'), 'bigInteger');
  assert.equal(normType('jsonb'), 'json');
  assert.equal(normType('bigincrements'), 'bigIncrements');
  assert.equal(normType('???'), 'string');
});

test('fromCompact : refs par nom -> ids, types, doublons, tables vides, ref inconnue', () => {
  const { schema, warnings } = fromCompact(JSON.stringify(BLOG), { dialect: 'mysql' });
  const names = schema.tables.map((t) => t.name);
  assert.deepEqual(names, ['users', 'posts', 'tags']);
  layoutTables(schema.tables); assertValid(schema.tables);
  const [users, posts, tags] = schema.tables;
  const uid = posts.columns.find((c) => c.name === 'user_id');
  assert.equal(uid.ref.table, users.id);
  assert.equal(uid.ref.column, users.columns[0].id);
  assert.equal(uid.ref.onDelete, 'cascade');
  assert.equal(uid.type, 'bigInteger', 'FK alignée sur bigIncrements');
  assert.equal(posts.columns.find((c) => c.name === 'ghost_id').ref, null);
  assert.deepEqual(posts.columns.find((c) => c.name === 'status').enumValues, ['draft', 'published']);
  const price = posts.columns.find((c) => c.name === 'price');
  assert.equal(price.type, 'decimal'); assert.equal(price.precision, 8); assert.equal(price.scale, 2);
  assert.equal(users.columns[1].type, 'string'); assert.equal(users.columns[1].length, 190);
  assert.equal(posts.indexes.length, 1); assert.equal(posts.indexes[0].columns.length, 1);
  assert.equal(tags.columns[0].name, 'id', 'PK ajoutée'); assert.equal(tags.columns[0].type, 'bigIncrements');
  assert.ok(warnings.some((w) => /ghosts/.test(w)));
  assert.ok(warnings.some((w) => /Posts/.test(w)));
  assert.equal(schema.dialect, 'mysql');
});

test('fromCompact : entrées invalides', () => {
  assert.throws(() => fromCompact('pas du json'));
  assert.throws(() => fromCompact({ foo: 1 }), /tables/);
  assert.throws(() => fromCompact({ tables: [{ name: '', columns: [] }, null, 3] }), /Aucune table/);
  // tableau nu accepté
  assert.equal(fromCompact([{ name: 'a', columns: [{ name: 'id', type: 'uuid', pk: true }] }]).schema.tables.length, 1);
});

test('fromCompact : auto-référence et cycle de FK', () => {
  const { schema } = fromCompact({ tables: [
    { name: 'a', columns: [{ name: 'id', type: 'uuid', pk: true }, { name: 'b_id', type: 'uuid', ref: { table: 'b', column: 'id' } }, { name: 'parent_id', type: 'uuid', nullable: true, ref: { table: 'a', column: 'id', onDelete: 'set null' } }] },
    { name: 'b', columns: [{ name: 'id', type: 'uuid', pk: true }, { name: 'a_id', type: 'uuid', ref: { table: 'a', column: 'id' } }] },
  ] });
  layoutTables(schema.tables); assertValid(schema.tables);
  for (const e of EXPORTERS) assert.doesNotThrow(() => exportAsText(e.id, schema), e.id);
});

test('aller-retour toCompact -> fromCompact (mode modification) : ids, positions, couleurs conservés', () => {
  const base = clone(SAMPLE_SHOP);
  const compact = toCompact(base);
  compact.tables.push({ name: 'wishlists', columns: [{ name: 'id', type: 'uuid', pk: true }, { name: 'user_id', type: 'uuid', ref: { table: 'users', column: 'id' } }] });
  const { schema } = fromCompact(compact, { base });
  const tables = applyGenerated(base, schema, 'edit');
  assertValid(tables);
  for (const t of base.tables) {
    const n = tables.find((x) => x.id === t.id);
    assert.ok(n, `table ${t.name} conservée`);
    assert.equal(n.x, t.x); assert.equal(n.y, t.y); assert.equal(n.color, t.color);
    assert.deepEqual(n.columns.map((c) => c.id), t.columns.map((c) => c.id));
    for (const c of t.columns) assert.deepEqual(n.columns.find((x) => x.id === c.id).ref?.table ?? null, c.ref?.table ?? null);
  }
  const rev = tables.find((t) => t.name === 'wishlists');
  assert.equal(rev.columns[1].ref.table, 't_users');
  assert.ok(rev.x > Math.max(...base.tables.map((t) => t.x)), 'nouvelle table à droite');
});

test('fromCompact : un id inventé par le modèle n\'est pas repris', () => {
  const { schema } = fromCompact({ tables: [{ id: 't_users', name: 'x', columns: [{ id: 'c_users_id', name: 'id', type: 'uuid', pk: true }] }] }, { base: null });
  assert.notEqual(schema.tables[0].id, 't_users');
  assert.notEqual(schema.tables[0].columns[0].id, 'c_users_id');
});

test('applyGenerated merge : table homonyme non dupliquée, refs redirigées vers l\'existante', () => {
  const base = clone(SAMPLE_SHOP);
  const { schema } = fromCompact({ tables: [
    { name: 'Users', columns: [{ name: 'id', type: 'bigIncrements', pk: true }] },
    { name: 'wishlists', columns: [{ name: 'id', type: 'uuid', pk: true }, { name: 'user_id', type: 'bigInteger', ref: { table: 'users', column: 'id' } }, { name: 'rating', type: 'smallInteger' }], indexes: [{ columns: ['rating'] }] },
  ] });
  const tables = applyGenerated(base, schema, 'merge');
  assertValid(tables);
  assert.equal(tables.length, base.tables.length + 1);
  assert.equal(tables.filter((t) => t.name.toLowerCase() === 'users').length, 1);
  const rev = tables.find((t) => t.name === 'wishlists');
  const fk = rev.columns.find((c) => c.name === 'user_id');
  assert.equal(fk.ref.table, 't_users'); assert.equal(fk.ref.column, 'c_users_id');
  assert.equal(fk.type, 'uuid', 'type aligné sur la PK existante');
  assert.deepEqual(base.tables, clone(SAMPLE_SHOP).tables, 'current non modifié');
});

test('applyGenerated merge : ids en collision renommés partout', () => {
  const base = { tables: [{ id: 't_a', name: 'a', color: '#fff', comment: '', x: 0, y: 0, columns: [{ id: 'c_1', name: 'id', type: 'uuid', pk: true, ref: null }], indexes: [] }] };
  const gen = { tables: [
    { id: 't_a', name: 'b', color: '', comment: '', x: NaN, y: NaN, columns: [{ id: 'c_1', name: 'id', type: 'uuid', pk: true, ref: null }], indexes: [{ id: 'i_1', name: 'x', columns: ['c_1'], unique: false }] },
    { id: 't_c', name: 'c', color: '', comment: '', x: NaN, y: NaN, columns: [{ id: 'c_2', name: 'id', type: 'uuid', pk: true, ref: null }, { id: 'c_3', name: 'b_id', type: 'uuid', ref: { table: 't_a', column: 'c_1', onDelete: 'cascade', onUpdate: 'no action' } }], indexes: [] },
  ] };
  const tables = applyGenerated(base, gen, 'merge');
  assertValid(tables);
  const b = tables.find((t) => t.name === 'b'), c = tables.find((t) => t.name === 'c');
  assert.equal(c.columns[1].ref.table, b.id);
});

test('applyGenerated replace : tout est rangé sans chevauchement', () => {
  const { schema } = fromCompact(toCompact(SAMPLE_SHOP));
  const tables = applyGenerated({ tables: [] }, schema, 'replace');
  assertValid(tables);
  for (let i = 0; i < tables.length; i++) for (let j = i + 1; j < tables.length; j++) {
    const a = tables[i], b = tables[j];
    const ha = 64 + a.columns.length * 30, hb = 64 + b.columns.length * 30;
    assert.ok(!(Math.abs(a.x - b.x) < 280 && a.y < b.y + hb && b.y < a.y + ha), `${a.name} chevauche ${b.name}`);
  }
});

// ------------------------------------------------------------------ runner
let failed = 0;
for (const { name, fn } of tests) {
  try { await fn(); console.log(`ok ${name}`); }
  catch (err) { failed++; console.log(`FAIL ${name}`); console.log(String(err?.stack ?? err).split('\n').map((l) => '    ' + l).join('\n')); }
}
console.log(`\n${tests.length - failed}/${tests.length} tests IA réussis`);
process.exit(failed ? 1 : 0);
