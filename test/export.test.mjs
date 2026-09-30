// Tests des exporteurs : node test/export.test.mjs
import assert from 'node:assert/strict';
import { EXPORTERS, exportAsText, toSql, toPrisma, toLaravel, toLaravelSingle, toDoctrine, toDbml } from '../src/lib/export/index.mjs';
import { topoSort, TYPES, ACTIONS, tableById, columnById } from '../src/lib/export/types.mjs';
import { SAMPLE_SHOP, EMPTY_SCHEMA } from '../src/lib/export/sample.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const clone = (o) => JSON.parse(JSON.stringify(o));

const col = (id, name, type, o = {}) => ({
  id, name, type, pk: false, nullable: false, unique: false, autoIncrement: false, default: '', comment: '', ref: null, ...o,
});
const tbl = (id, name, columns, o = {}) => ({ id, name, color: '#888', comment: '', x: 0, y: 0, columns, indexes: [], ...o });
const mk = (tables, dialect = 'postgres') => ({ id: 's_t', name: 'T', dialect, tables });

// ------------------------------------------------------------------ helpers

test('types : TYPES / ACTIONS / lookups', () => {
  assert.equal(TYPES.length, 18);
  assert.ok(TYPES.every((t) => t.id && t.label && 'hasLength' in t && 'hasPrecision' in t));
  assert.ok(ACTIONS.includes('cascade') && ACTIONS.includes('set null'));
  assert.equal(tableById(SAMPLE_SHOP, 't_users').name, 'users');
  assert.equal(columnById(tableById(SAMPLE_SHOP, 't_users'), 'c_users_email').name, 'email');
  assert.equal(tableById(SAMPLE_SHOP, 'nope'), null);
});

test('sample : ids uniques, refs valides, pas de chevauchement de cartes', () => {
  const ids = new Set();
  for (const t of SAMPLE_SHOP.tables) {
    assert.ok(!ids.has(t.id)); ids.add(t.id);
    for (const c of t.columns) {
      assert.ok(!ids.has(c.id), `id dupliqué ${c.id}`); ids.add(c.id);
      if (c.ref) assert.ok(columnById(tableById(SAMPLE_SHOP, c.ref.table), c.ref.column), `ref cassée ${c.id}`);
    }
  }
  const T = SAMPLE_SHOP.tables;
  for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) {
    const overlapX = Math.abs(T[i].x - T[j].x) < 260;
    const overlapY = Math.abs(T[i].y - T[j].y) < 300;
    assert.ok(!(overlapX && overlapY), `${T[i].name} chevauche ${T[j].name}`);
  }
});

test('topoSort : tables référencées avant les autres', () => {
  const order = topoSort(SAMPLE_SHOP).map((t) => t.id);
  const pos = (id) => order.indexOf(id);
  assert.equal(order.length, SAMPLE_SHOP.tables.length);
  for (const t of SAMPLE_SHOP.tables) for (const c of t.columns) {
    if (c.ref && c.ref.table !== t.id) assert.ok(pos(c.ref.table) < pos(t.id), `${c.ref.table} avant ${t.id}`);
  }
});

// ------------------------------------------------------------------ tous les exporteurs

for (const e of EXPORTERS) {
  test(`exporteur ${e.id} tourne sur SAMPLE_SHOP`, () => {
    const res = e.run(SAMPLE_SHOP);
    assert.ok(typeof res === 'string' || Array.isArray(res));
    const text = exportAsText(e.id, SAMPLE_SHOP);
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 100);
    assert.ok(!/undefined|\[object Object\]|NaN/.test(text), `valeur suspecte dans ${e.id}`);
  });
  test(`exporteur ${e.id} tourne sur un schéma vide`, () => {
    const text = exportAsText(e.id, EMPTY_SCHEMA('Vide'));
    assert.equal(typeof text, 'string');
  });
}

test('exportAsText : id inconnu -> erreur', () => {
  assert.throws(() => exportAsText('nope', SAMPLE_SHOP), /inconnu/);
});

test('json : aller-retour', () => {
  assert.deepEqual(JSON.parse(exportAsText('json', SAMPLE_SHOP)), SAMPLE_SHOP);
});

// ------------------------------------------------------------------ SQL

test('sql postgres : FK, tables dans un ordre valide', () => {
  const sql = toSql(SAMPLE_SHOP, 'postgres');
  assert.match(sql, /FOREIGN KEY \("user_id"\) REFERENCES "users" \("id"\) ON DELETE CASCADE/);
  assert.match(sql, /FOREIGN KEY \("user_id"\) REFERENCES "users" \("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.match(sql, /ON DELETE SET NULL/);
  assert.match(sql, /PRIMARY KEY \("product_id", "category_id"\)/);
  assert.match(sql, /CREATE UNIQUE INDEX "order_items_order_product_uniq"/);
  assert.match(sql, /COMMENT ON TABLE "products" IS 'Catalogue produits';/);
  assert.ok(!/ALTER TABLE/.test(sql), 'pas de cycle -> pas d\'ALTER');
  const create = (n) => sql.indexOf(`CREATE TABLE "${n}"`);
  for (const t of SAMPLE_SHOP.tables) for (const c of t.columns) {
    if (!c.ref || c.ref.table === t.id) continue;
    const target = tableById(SAMPLE_SHOP, c.ref.table).name;
    assert.ok(create(target) >= 0 && create(target) < create(t.name), `${target} doit précéder ${t.name}`);
  }
});

test('sql : auto-incrément par dialecte', () => {
  const s = mk([tbl('t', 'items', [col('c', 'id', 'bigIncrements', { pk: true }), col('d', 'n', 'increments', { unique: true })])]);
  const pg = toSql(s, 'postgres');
  const my = toSql(s, 'mysql');
  const lite = toSql(s, 'sqlite');
  assert.match(pg, /"id" BIGSERIAL NOT NULL/);
  assert.match(pg, /"n" SERIAL NOT NULL/);
  assert.match(my, /`id` BIGINT NOT NULL AUTO_INCREMENT/);
  assert.match(my, /PRIMARY KEY \(`id`\)/);
  assert.match(lite, /"id" INTEGER PRIMARY KEY AUTOINCREMENT/);
  assert.ok(!/PRIMARY KEY \("id"\)/.test(lite), 'sqlite : PK inline uniquement');
  // integer + autoIncrement: true
  const s2 = mk([tbl('t', 'x', [col('c', 'id', 'integer', { pk: true, autoIncrement: true })])]);
  assert.match(toSql(s2, 'postgres'), /"id" SERIAL/);
  assert.match(toSql(s2, 'mysql'), /`id` INT NOT NULL AUTO_INCREMENT/);
  assert.match(toSql(s2, 'sqlite'), /"id" INTEGER PRIMARY KEY AUTOINCREMENT/);
});

test('sql : quoting par dialecte, dialecte par défaut = schema.dialect', () => {
  const s = mk([tbl('t', 'Order Items', [col('c', 'Unit "Price"', 'integer')])], 'mysql');
  assert.match(toSql(s), /CREATE TABLE `Order Items`/);
  assert.match(toSql(s, 'postgres'), /CREATE TABLE "Order Items" \(\n {2}"Unit ""Price""" INTEGER NOT NULL/);
  assert.throws(() => toSql(s, 'oracle'), /inconnu/);
});

test('sql mysql / sqlite : défauts et commentaires', () => {
  const s = mk([tbl('t', 'p', [
    col('a', 'id', 'uuid', { pk: true, default: 'uuid()', comment: "l'id" }),
    col('b', 'at', 'timestamp', { default: 'now()' }),
  ], { comment: 'Table p' })]);
  const my = toSql(s, 'mysql');
  assert.match(my, /DEFAULT \(UUID\(\)\)/);
  assert.match(my, /COMMENT 'l''id'/);
  assert.match(my, /\) ENGINE=InnoDB COMMENT='Table p';/);
  const lite = toSql(s, 'sqlite');
  assert.match(lite, /DEFAULT CURRENT_TIMESTAMP/);
  assert.match(lite, /DEFAULT \(lower\(hex\(randomblob\(16\)\)\)\)/);
});

test('sql : cycle A<->B -> FK en ALTER TABLE (postgres/mysql), inline en sqlite', () => {
  const s = mk([
    tbl('a', 'a', [col('a_id', 'id', 'integer', { pk: true }), col('a_b', 'b_id', 'integer', { nullable: true, ref: { table: 'b', column: 'b_id', onDelete: 'set null', onUpdate: 'no action' } })]),
    tbl('b', 'b', [col('b_id', 'id', 'integer', { pk: true }), col('b_a', 'a_id', 'integer', { nullable: true, ref: { table: 'a', column: 'a_id', onDelete: 'cascade', onUpdate: 'no action' } })]),
  ]);
  const sql = toSql(s, 'postgres');
  assert.match(sql, /ALTER TABLE "a" ADD CONSTRAINT "fk_a_b_id" FOREIGN KEY \("b_id"\) REFERENCES "b" \("id"\) ON DELETE SET NULL;/);
  // b (créée après a) garde sa FK vers a inline ; seule la FK a->b est différée
  assert.match(sql, /CREATE TABLE "b" \([^;]*FOREIGN KEY \("a_id"\) REFERENCES "a"/);
  assert.equal((sql.match(/ALTER TABLE/g) ?? []).length, 1);
  assert.ok(sql.indexOf('CREATE TABLE "b"') < sql.indexOf('ALTER TABLE'));
  assert.match(toSql(s, 'mysql'), /ALTER TABLE `a` ADD CONSTRAINT/);
  assert.ok(!/ALTER TABLE/.test(toSql(s, 'sqlite')));
  // les autres exporteurs survivent au cycle
  for (const e of EXPORTERS) assert.doesNotThrow(() => exportAsText(e.id, s), e.id);
});

test('sql : auto-référence, FK vers cible inexistante, cycle à 3 tables', () => {
  const self = mk([tbl('c', 'cat', [col('i', 'id', 'integer', { pk: true }), col('p', 'parent_id', 'integer', { nullable: true, ref: { table: 'c', column: 'i', onDelete: 'cascade', onUpdate: 'no action' } })])]);
  const sql = toSql(self, 'postgres');
  assert.ok(!/ALTER TABLE/.test(sql));
  assert.match(sql, /FOREIGN KEY \("parent_id"\) REFERENCES "cat" \("id"\)/);
  const dangling = mk([tbl('x', 'x', [col('i', 'id', 'integer', { pk: true }), col('j', 'y_id', 'integer', { ref: { table: 'ghost', column: 'nope', onDelete: 'cascade', onUpdate: 'no action' } })])]);
  assert.ok(!/FOREIGN KEY/.test(toSql(dangling, 'postgres')));
  const r = (t, c) => ({ table: t, column: c, onDelete: 'no action', onUpdate: 'no action' });
  const tri = mk([
    tbl('a', 'a', [col('ai', 'id', 'integer', { pk: true }), col('ab', 'b_id', 'integer', { ref: r('b', 'bi') })]),
    tbl('b', 'b', [col('bi', 'id', 'integer', { pk: true }), col('bc', 'c_id', 'integer', { ref: r('c', 'ci') })]),
    tbl('c', 'c', [col('ci', 'id', 'integer', { pk: true }), col('ca', 'a_id', 'integer', { ref: r('a', 'ai') })]),
  ]);
  assert.equal(topoSort(tri).length, 3);
  assert.equal((toSql(tri, 'postgres').match(/ALTER TABLE/g) ?? []).length, 1);
});

test('sql : table sans colonne, colonne enum, PK composite + auto en sqlite', () => {
  const s = mk([
    tbl('e', 'empty', []),
    tbl('r', 'roles', [col('i', 'kind', 'enum', { enumValues: ['a', "b'c"], default: "'a'" })]),
  ]);
  assert.match(toSql(s, 'postgres'), /CREATE TABLE "empty" \(\);/);
  assert.match(toSql(s, 'sqlite'), /ignorée : aucune colonne/);
  assert.match(toSql(s, 'postgres'), /CHECK \("kind" IN \('a', 'b''c'\)\)/);
  assert.match(toSql(s, 'mysql'), /ENUM\('a', 'b''c'\)/);
});

// ------------------------------------------------------------------ Prisma

test('prisma : relations inverses, @id composite, maps', () => {
  const p = toPrisma(SAMPLE_SHOP);
  assert.match(p, /provider = "postgresql"/);
  assert.match(p, /model User \{/);
  assert.match(p, /@@map\("users"\)/);
  assert.match(p, /orders\s+Order\[\]/);                        // inverse côté User
  assert.match(p, /addresses\s+Address\[\]/);
  assert.match(p, /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Restrict, onUpdate: Cascade\)/);
  assert.match(p, /shippingAddress\s+Address\?\s+@relation\(fields: \[shippingAddressId\], references: \[id\], onDelete: SetNull/);
  assert.match(p, /userId\s+String\s+@map\("user_id"\)\s+@db\.Uuid/);
  assert.match(p, /@@id\(\[productId, categoryId\]\)/);
  assert.match(p, /id\s+String\s+@id @default\(uuid\(\)\) @db\.Uuid/);
  assert.match(p, /id\s+BigInt\s+@id @default\(autoincrement\(\)\)/);
  assert.match(p, /email\s+String\s+@unique/);
  assert.match(p, /@@index\(\[userId, status\], map: "orders_user_id_status_idx"\)/);
  assert.match(p, /@@unique\(\[orderId, productId\], map: "order_items_order_product_uniq"\)/);
  assert.match(p, /@default\(now\(\)\)/);
  assert.match(p, /role\s+UserRole\s+@default\(customer\)/);
  assert.match(p, /enum UserRole \{\n {2}customer\n {2}staff\n {2}admin\n\}/);
  // auto-relation : relation nommée des deux côtés
  assert.match(p, /parent\s+Category\?\s+@relation\("Category_parent", fields: \[parentId\]/);
  assert.match(p, /@relation\("Category_parent"\)/);
  // accolades équilibrées
  assert.equal((p.match(/\{/g) ?? []).length, (p.match(/\}/g) ?? []).length);
});

test('prisma : mysql / sqlite et deux FK vers la même table', () => {
  const r = (t, c) => ({ table: t, column: c, onDelete: 'cascade', onUpdate: 'no action' });
  const s = mk([
    tbl('u', 'users', [col('ui', 'id', 'integer', { pk: true, autoIncrement: true })]),
    tbl('m', 'messages', [
      col('mi', 'id', 'integer', { pk: true, autoIncrement: true }),
      col('ms', 'sender_id', 'integer', { ref: r('u', 'ui') }),
      col('mr', 'recipient_id', 'integer', { ref: r('u', 'ui') }),
    ]),
  ], 'sqlite');
  const p = toPrisma(s);
  assert.match(p, /provider = "sqlite"/);
  assert.match(p, /@relation\("Message_sender", fields: \[senderId\]/);
  assert.match(p, /@relation\("Message_recipient", fields: \[recipientId\]/);
  assert.match(p, /messagesAsSender\s+Message\[\]\s+@relation\("Message_sender"\)/);
  assert.match(p, /messagesAsRecipient\s+Message\[\]\s+@relation\("Message_recipient"\)/);
  assert.ok(!/@db\./.test(p), 'pas de types natifs en sqlite');
  const pm = toPrisma({ ...SAMPLE_SHOP, dialect: 'mysql' });
  assert.match(pm, /provider = "mysql"/);
  assert.match(pm, /@db\.Char\(36\)/);
  assert.ok(!/@db\.Uuid/.test(pm));
});

test('prisma : FK 1-1 -> relation inverse optionnelle', () => {
  const s = mk([
    tbl('u', 'users', [col('ui', 'id', 'integer', { pk: true, autoIncrement: true })]),
    tbl('p', 'profiles', [col('pi', 'user_id', 'integer', { pk: true, ref: { table: 'u', column: 'ui', onDelete: 'cascade', onUpdate: 'no action' } })]),
  ]);
  const p = toPrisma(s);
  assert.match(p, /profile\s+Profile\?/);
  assert.match(p, /userId\s+Int\s+@id @map\("user_id"\)/);
});

// ------------------------------------------------------------------ Laravel

test('laravel : une migration par table, noms triés dans l\'ordre topologique', () => {
  const files = toLaravel(SAMPLE_SHOP);
  assert.equal(files.length, SAMPLE_SHOP.tables.length);
  const names = files.map((f) => f.filename);
  assert.deepEqual([...names].sort(), names, 'noms triés');
  assert.match(names[0], /^2024_01_01_000001_create_\w+_table\.php$/);
  const order = topoSort(SAMPLE_SHOP).map((t) => t.name);
  order.forEach((n, i) => assert.ok(names[i].endsWith(`_create_${n}_table.php`), `${names[i]} devrait être create_${n}`));
  const users = files.find((f) => f.filename.endsWith('create_users_table.php')).content;
  assert.match(users, /return new class extends Migration/);
  assert.match(users, /\$table->uuid\('id'\)->default\(DB::raw\('gen_random_uuid\(\)'\)\)->primary\(\);|\$table->uuid\('id'\)->primary\(\)->default\(DB::raw\('gen_random_uuid\(\)'\)\);/);
  assert.match(users, /use Illuminate\\Support\\Facades\\DB;/);
  assert.match(users, /\$table->timestamps\(\);/);
  assert.ok(!/created_at/.test(users));
  assert.match(users, /\$table->enum\('role', \['customer', 'staff', 'admin'\]\)->default\('customer'\);/);
  assert.match(users, /\$table->string\('email'\)->unique\(\);/);
  const addr = files.find((f) => f.filename.endsWith('create_addresses_table.php')).content;
  assert.match(addr, /\$table->id\(\);/);
  assert.match(addr, /\$table->foreignUuid\('user_id'\)->constrained\('users'\)->cascadeOnDelete\(\);/);
  assert.match(addr, /\$table->string\('postal_code', 20\);/);
  assert.match(addr, /\$table->boolean\('is_default'\)->default\(false\);/);
  assert.match(addr, /\$table->index\('user_id', 'addresses_user_id_idx'\);/);
  const orders = files.find((f) => f.filename.endsWith('create_orders_table.php')).content;
  assert.match(orders, /foreignUuid\('user_id'\)->constrained\('users'\)->restrictOnDelete\(\)->cascadeOnUpdate\(\);/);
  assert.match(orders, /foreignId\('shipping_address_id'\)->nullable\(\)->constrained\('addresses'\)->nullOnDelete\(\);/);
  assert.match(orders, /->useCurrent\(\)/);
  assert.match(orders, /\$table->decimal\('total', 10, 2\)->default\(0\);/);
  const pc = files.find((f) => f.filename.endsWith('create_product_categories_table.php')).content;
  assert.match(pc, /\$table->primary\(\['product_id', 'category_id'\]\);/);
  assert.match(pc, /foreignId\('product_id'\)->constrained\('products'\)->cascadeOnDelete\(\);/);
  assert.ok(!/->primary\(\)/.test(pc));
  const single = toLaravelSingle(SAMPLE_SHOP);
  for (const n of names) assert.ok(single.includes(`// ===== ${n} =====`));
});

test('laravel : FK vers une colonne autre que id -> foreign()->references()->on()', () => {
  const s = mk([
    tbl('c', 'countries', [col('ci', 'code', 'string', { pk: true, length: 2 })]),
    tbl('u', 'users', [col('ui', 'id', 'bigIncrements', { pk: true }), col('uc', 'country_code', 'string', { length: 2, ref: { table: 'c', column: 'ci', onDelete: 'cascade', onUpdate: 'no action' } })]),
  ]);
  const u = toLaravel(s).find((f) => f.filename.includes('users')).content;
  assert.match(u, /\$table->string\('country_code', 2\);/);
  assert.match(u, /\$table->foreign\('country_code'\)->references\('code'\)->on\('countries'\)->cascadeOnDelete\(\);/);
});

test('laravel : cycle -> FK dans une migration séparée à la fin', () => {
  const r = (t, c) => ({ table: t, column: c, onDelete: 'cascade', onUpdate: 'no action' });
  const s = mk([
    tbl('a', 'a', [col('ai', 'id', 'bigIncrements', { pk: true }), col('ab', 'b_id', 'bigInteger', { nullable: true, ref: r('b', 'bi') })]),
    tbl('b', 'b', [col('bi', 'id', 'bigIncrements', { pk: true }), col('ba', 'a_id', 'bigInteger', { nullable: true, ref: r('a', 'ai') })]),
  ]);
  const files = toLaravel(s);
  assert.equal(files.length, 3);
  assert.match(files[2].filename, /^2024_01_01_000003_add_foreign_keys\.php$/);
  assert.match(files[2].content, /Schema::table\('a'/);
  assert.match(files[2].content, /\$table->foreign\('b_id'\)->references\('id'\)->on\('b'\)->cascadeOnDelete\(\);/);
  assert.match(files[2].content, /dropForeign\(\['b_id'\]\)/);
  assert.match(files[0].content, /unsignedBigInteger\('b_id'\)->nullable\(\)/);
  assert.ok(!/->foreign\(|constrained/.test(files[0].content), 'la table créée en premier n\'a pas de FK inline');
});

// ------------------------------------------------------------------ Doctrine / DBML

test('doctrine : entités, associations et inverses', () => {
  const files = toDoctrine(SAMPLE_SHOP);
  assert.equal(files.length, SAMPLE_SHOP.tables.length);
  const get = (n) => files.find((f) => f.filename === n)?.content ?? assert.fail(`fichier ${n} manquant`);
  const user = get('User.php');
  assert.match(user, /#\[ORM\\Entity\]/);
  assert.match(user, /#\[ORM\\Table\(name: 'users'\)\]/);
  assert.match(user, /#\[ORM\\Id\]/);
  assert.match(user, /#\[ORM\\OneToMany\(targetEntity: Order::class, mappedBy: 'user'\)\]/);
  assert.match(user, /private Collection \$orders;/);
  assert.match(user, /\$this->orders = new ArrayCollection\(\);/);
  const order = get('Order.php');
  assert.match(order, /#\[ORM\\ManyToOne\(targetEntity: User::class, inversedBy: 'orders'\)\]/);
  assert.match(order, /#\[ORM\\JoinColumn\(name: 'user_id', referencedColumnName: 'id', nullable: false, onDelete: 'RESTRICT'\)\]/);
  assert.match(order, /#\[ORM\\Id\]\s*\n\s*#\[ORM\\GeneratedValue\]/);
  assert.match(order, /name: 'created_at'/);
  const pc = get('ProductCategory.php');
  assert.equal((pc.match(/#\[ORM\\Id\]/g) ?? []).length, 2);
  assert.ok(!/GeneratedValue/.test(pc));
  assert.match(pc, /#\[ORM\\ManyToOne\(targetEntity: Product::class/);
  const cat = get('Category.php');
  assert.match(cat, /mappedBy: 'parent'/);
  for (const f of files) assert.equal((f.content.match(/\{/g) ?? []).length, (f.content.match(/\}/g) ?? []).length, f.filename);
});

test('dbml : Table, Ref, indexes, Note', () => {
  const d = toDbml(SAMPLE_SHOP);
  assert.match(d, /Table users \[headercolor: #7c9cff\] \{/);
  assert.match(d, /id uuid \[pk, not null, default: `gen_random_uuid\(\)`\]/);
  assert.match(d, /id bigint \[pk, increment, not null\]/);
  assert.match(d, /Ref: orders\.user_id > users\.id \[delete: restrict, update: cascade\]/);
  assert.match(d, /indexes \{\n {4}\(user_id, status\) \[name: 'orders_user_id_status_idx'\]/);
  assert.match(d, /\(product_id, category_id\) \[pk\]/);
  assert.match(d, /Note: 'Catalogue produits'/);
  assert.match(d, /Enum users_role \{/);
});

// ------------------------------------------------------------------ robustesse

test('schéma vide : aucun exporteur ne plante', () => {
  const s = EMPTY_SCHEMA('Vide');
  assert.match(toSql(s), /aucune table/);
  assert.doesNotThrow(() => toPrisma(s));
  assert.deepEqual(toLaravel(s), []);
  assert.deepEqual(toDoctrine(s), []);
  assert.doesNotThrow(() => toDbml(s));
  assert.equal(typeof toLaravelSingle(s), 'string');
  assert.doesNotThrow(() => exportAsText('laravel', s));
});

test('noms avec majuscules / espaces : snake_case Laravel, PascalCase Prisma/Doctrine', () => {
  const s = mk([
    tbl('t1', 'Order Items', [col('c1', 'id', 'bigIncrements', { pk: true }), col('c2', 'Unit Price', 'decimal')]),
    tbl('t2', 'UserProfiles', [col('d1', 'id', 'bigIncrements', { pk: true }), col('d2', 'item', 'bigInteger', { ref: { table: 't1', column: 'c1', onDelete: 'cascade', onUpdate: 'no action' } })]),
  ]);
  const lv = toLaravel(s);
  assert.match(lv[0].filename, /_create_order_items_table\.php$/);
  assert.match(lv[1].filename, /_create_user_profiles_table\.php$/);
  assert.match(lv[0].content, /Schema::create\('order_items'/);
  assert.match(lv[0].content, /\$table->decimal\('unit_price', 10, 2\);/);
  const p = toPrisma(s);
  assert.match(p, /model OrderItem \{/);
  assert.match(p, /model UserProfile \{/);
  assert.match(p, /@@map\("Order Items"\)/);
  assert.match(p, /unitPrice\s+Decimal\s+@map\("Unit Price"\)/);
  const d = toDoctrine(s);
  assert.deepEqual(d.map((f) => f.filename).sort(), ['OrderItem.php', 'UserProfile.php']);
  assert.match(d[0].content, /#\[ORM\\Table\(name: 'Order Items'\)\]/);
  assert.match(d.find((f) => f.filename === 'OrderItem.php').content, /name: 'Unit Price'/);
  assert.match(toDbml(s), /Table "Order Items" \[headercolor: #888\] \{/);
});

test('noms dupliqués / vides / chiffres : pas de plantage, identifiants uniques', () => {
  const s = mk([
    tbl('a', 'item', [col('a1', 'id', 'integer', { pk: true })]),
    tbl('b', 'items', [col('b1', 'id', 'integer', { pk: true }), col('b2', '2fa', 'string'), col('b3', '', 'string')]),
    tbl('c', '', [col('c1', 'id', 'integer', { pk: true })]),
  ]);
  for (const e of EXPORTERS) assert.doesNotThrow(() => exportAsText(e.id, s), e.id);
  const p = toPrisma(s);
  assert.match(p, /model Item \{/);
  assert.match(p, /model Item2 \{/);
  assert.match(p, /_2fa\s+String/);
});

// ------------------------------------------------------------------ runner

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}`);
    console.log(String(err?.stack ?? err).split('\n').map((l) => '    ' + l).join('\n'));
  }
}
console.log(`\n${tests.length - failed}/${tests.length} tests réussis`);
process.exit(failed ? 1 : 0);
