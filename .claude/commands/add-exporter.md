---
description: Ajoute un format d'export à Trame
argument-hint: <nom du format>
---
Ajoute l'exporteur ($ARGUMENTS) : fichier pur dans `src/lib/export/`, enregistrement dans `EXPORTERS` (`index.mjs`), tests dans `test/export.test.mjs` (cas nominal, cycle de FK, clé primaire composite, noms invalides). Lis `docs/MODEL.md` d'abord. Puis `npm test` et `npx tsc --noEmit`.
