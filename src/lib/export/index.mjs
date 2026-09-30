// Registre des exporteurs.
import { toSql } from './sql.mjs';
import { toPrisma } from './prisma.mjs';
import { toLaravel, toLaravelSingle } from './laravel.mjs';
import { toDoctrine } from './doctrine.mjs';
import { toDbml } from './dbml.mjs';

export { toSql, toPrisma, toLaravel, toLaravelSingle, toDoctrine, toDbml };
export { TYPES, ACTIONS, tableById, columnById, topoSort } from './types.mjs';
export { SAMPLE_SHOP, EMPTY_SCHEMA } from './sample.mjs';

export const EXPORTERS = [
  { id: 'sql-postgres', label: 'SQL (PostgreSQL)', ext: 'sql', lang: 'sql', run: (s) => toSql(s, 'postgres') },
  { id: 'sql-mysql', label: 'SQL (MySQL)', ext: 'sql', lang: 'sql', run: (s) => toSql(s, 'mysql') },
  { id: 'sql-sqlite', label: 'SQL (SQLite)', ext: 'sql', lang: 'sql', run: (s) => toSql(s, 'sqlite') },
  { id: 'prisma', label: 'Prisma', ext: 'prisma', lang: 'prisma', run: (s) => toPrisma(s) },
  { id: 'laravel', label: 'Laravel (migrations)', ext: 'php', lang: 'php', run: (s) => toLaravel(s) },
  { id: 'doctrine', label: 'Doctrine (entités)', ext: 'php', lang: 'php', run: (s) => toDoctrine(s) },
  { id: 'dbml', label: 'DBML (dbdiagram.io)', ext: 'dbml', lang: 'dbml', run: (s) => toDbml(s) },
  { id: 'json', label: 'JSON (Trame)', ext: 'json', lang: 'json', run: (s) => JSON.stringify(s, null, 2) + '\n' },
];

/** Lance un exporteur et renvoie toujours une chaîne (multi-fichiers concaténés avec en-têtes). */
export function exportAsText(id, schema) {
  const exp = EXPORTERS.find((e) => e.id === id);
  if (!exp) throw new Error(`Exporteur inconnu : ${id}`);
  const res = exp.run(schema);
  if (typeof res === 'string') return res;
  if (!res.length) return '// (aucun fichier)\n';
  return res.map((f) => `// ===== ${f.filename} =====\n${f.content}`).join('\n');
}
