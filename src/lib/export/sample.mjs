// Schéma de démonstration (boutique en ligne) conforme à docs/MODEL.md.
// Grille de cartes de ~260 px de large : pas de chevauchement (colonnes à 320 px, lignes à 420 px).

const col = (id, name, type, o = {}) => ({
  id, name, type,
  pk: false, nullable: false, unique: false, autoIncrement: false,
  default: '', comment: '', ref: null,
  ...o,
});
const ref = (table, column, onDelete = 'no action', onUpdate = 'no action') => ({ table, column, onDelete, onUpdate });

export const SAMPLE_SHOP = {
  id: 's_shop',
  name: 'Boutique',
  dialect: 'postgres',
  tables: [
    {
      id: 't_users', name: 'users', color: '#7c9cff', comment: 'Comptes clients et équipe', x: 60, y: 60,
      columns: [
        col('c_users_id', 'id', 'uuid', { pk: true, default: 'gen_random_uuid()' }),
        col('c_users_email', 'email', 'string', { unique: true }),
        col('c_users_password', 'password_hash', 'string'),
        col('c_users_name', 'full_name', 'string', { nullable: true }),
        col('c_users_role', 'role', 'enum', { default: "'customer'", enumValues: ['customer', 'staff', 'admin'] }),
        col('c_users_created', 'created_at', 'timestamp', { nullable: true }),
        col('c_users_updated', 'updated_at', 'timestamp', { nullable: true }),
      ],
      indexes: [],
    },
    {
      id: 't_addresses', name: 'addresses', color: '#5ad1a6', comment: '', x: 380, y: 60,
      columns: [
        col('c_addr_id', 'id', 'bigIncrements', { pk: true }),
        col('c_addr_user', 'user_id', 'uuid', { ref: ref('t_users', 'c_users_id', 'cascade') }),
        col('c_addr_line1', 'line1', 'string'),
        col('c_addr_line2', 'line2', 'string', { nullable: true }),
        col('c_addr_city', 'city', 'string', { length: 120 }),
        col('c_addr_zip', 'postal_code', 'string', { length: 20 }),
        col('c_addr_country', 'country_code', 'string', { length: 2, default: "'FR'" }),
        col('c_addr_default', 'is_default', 'boolean', { default: 'false' }),
      ],
      indexes: [{ id: 'i_addr_user', name: 'addresses_user_id_idx', columns: ['c_addr_user'], unique: false }],
    },
    {
      id: 't_orders', name: 'orders', color: '#f5a65b', comment: 'Commandes passées', x: 700, y: 60,
      columns: [
        col('c_ord_id', 'id', 'bigIncrements', { pk: true }),
        col('c_ord_user', 'user_id', 'uuid', { ref: ref('t_users', 'c_users_id', 'restrict', 'cascade') }),
        col('c_ord_addr', 'shipping_address_id', 'bigInteger', { nullable: true, ref: ref('t_addresses', 'c_addr_id', 'set null') }),
        col('c_ord_status', 'status', 'enum', { default: "'pending'", enumValues: ['pending', 'paid', 'shipped', 'cancelled'] }),
        col('c_ord_total', 'total', 'decimal', { precision: 10, scale: 2, default: '0' }),
        col('c_ord_created', 'created_at', 'timestamp', { default: 'CURRENT_TIMESTAMP' }),
      ],
      indexes: [{ id: 'i_ord_user_status', name: 'orders_user_id_status_idx', columns: ['c_ord_user', 'c_ord_status'], unique: false }],
    },
    {
      id: 't_order_items', name: 'order_items', color: '#e879a8', comment: '', x: 1020, y: 60,
      columns: [
        col('c_oi_id', 'id', 'bigIncrements', { pk: true }),
        col('c_oi_order', 'order_id', 'bigInteger', { ref: ref('t_orders', 'c_ord_id', 'cascade') }),
        col('c_oi_product', 'product_id', 'bigInteger', { ref: ref('t_products', 'c_prod_id', 'restrict') }),
        col('c_oi_qty', 'quantity', 'integer', { default: '1' }),
        col('c_oi_price', 'unit_price', 'decimal', { precision: 10, scale: 2 }),
      ],
      indexes: [{ id: 'i_oi_unique', name: 'order_items_order_product_uniq', columns: ['c_oi_order', 'c_oi_product'], unique: true }],
    },
    {
      id: 't_categories', name: 'categories', color: '#b48cf2', comment: '', x: 60, y: 480,
      columns: [
        col('c_cat_id', 'id', 'bigIncrements', { pk: true }),
        col('c_cat_parent', 'parent_id', 'bigInteger', { nullable: true, ref: ref('t_categories', 'c_cat_id', 'set null') }),
        col('c_cat_name', 'name', 'string'),
        col('c_cat_slug', 'slug', 'string', { unique: true }),
      ],
      indexes: [],
    },
    {
      id: 't_product_categories', name: 'product_categories', color: '#9aa4b8', comment: 'Table pivot produits / catégories', x: 380, y: 480,
      columns: [
        col('c_pc_product', 'product_id', 'bigInteger', { pk: true, ref: ref('t_products', 'c_prod_id', 'cascade') }),
        col('c_pc_category', 'category_id', 'bigInteger', { pk: true, ref: ref('t_categories', 'c_cat_id', 'cascade') }),
      ],
      indexes: [],
    },
    {
      id: 't_products', name: 'products', color: '#4fc3e8', comment: 'Catalogue produits', x: 700, y: 480,
      columns: [
        col('c_prod_id', 'id', 'bigIncrements', { pk: true }),
        col('c_prod_sku', 'sku', 'string', { length: 64, unique: true }),
        col('c_prod_name', 'name', 'string'),
        col('c_prod_desc', 'description', 'text', { nullable: true, comment: 'Description longue (Markdown)' }),
        col('c_prod_price', 'price', 'decimal', { precision: 10, scale: 2 }),
        col('c_prod_stock', 'stock', 'integer', { default: '0' }),
        col('c_prod_active', 'is_active', 'boolean', { default: 'true' }),
        col('c_prod_attrs', 'attributes', 'json', { nullable: true }),
      ],
      indexes: [{ id: 'i_prod_name', name: 'products_name_idx', columns: ['c_prod_name'], unique: false }],
    },
    {
      id: 't_reviews', name: 'reviews', color: '#f2c94c', comment: '', x: 1020, y: 480,
      columns: [
        col('c_rev_id', 'id', 'bigIncrements', { pk: true }),
        col('c_rev_product', 'product_id', 'bigInteger', { ref: ref('t_products', 'c_prod_id', 'cascade') }),
        col('c_rev_user', 'user_id', 'uuid', { nullable: true, ref: ref('t_users', 'c_users_id', 'set null', 'cascade') }),
        col('c_rev_rating', 'rating', 'smallInteger'),
        col('c_rev_body', 'body', 'text', { nullable: true }),
        col('c_rev_created', 'created_at', 'timestamp', { default: 'CURRENT_TIMESTAMP' }),
      ],
      indexes: [],
    },
  ],
};

export const EMPTY_SCHEMA = (name = 'Nouveau schéma') => ({
  id: `s_${Math.random().toString(36).slice(2, 8)}`,
  name,
  dialect: 'postgres',
  tables: [],
});
