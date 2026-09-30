# Trame — contexte pour Claude Code

Trame est un éditeur visuel de schémas de bases de données (façon DrawSQL) : on dessine des tables et des relations sur un canevas, puis on exporte en image (PNG/JPG/SVG/PDF) ou en code (SQL Postgres/MySQL/SQLite, Prisma, migrations Laravel, entités Doctrine, DBML, JSON).
C'est le 2ᵉ outil d'une « suite » dont Motif (générateur de DESIGN.md) est le 1ᵉʳ : **même DA que Motif** (mêmes jetons, mêmes boutons `.ub`, Geist), accent bleu au lieu de lime. Garder cette cohérence pour tout nouvel outil.

- Interface en **français**. Code et commentaires : français ou anglais.
- Utilisateur : Ibrahim, dev (Next/TS, Laravel, Symfony, Vue/Nuxt, Node). Réponses courtes, droit au but.
- Usage perso pour l'instant (pas de commercialisation), hébergé sur Coolify (Optiplex/Proxmox) derrière un Cloudflare Tunnel.

## Étapes
1. **Éditeur + exports** — fait (cette version, 100 % statique).
2. **IA (Groq)** — fait : décrire son projet (ou une modification) en texte, obtenir le schéma. Petit serveur Node `server/index.mjs`, clé `GROQ_API_KEY` côté serveur uniquement.
3. **Partage + temps réel** (Yjs). Voir `docs/ROADMAP.md`.
Le bouton « Partager » de la barre du haut est un emplacement désactivé en attendant. Le bouton « IA » est désactivé si `/api/health` ne répond pas ou si la clé manque.

## Stack
Vite + React 18 + TypeScript (`strict:false`, `allowJs`), `@xyflow/react` (canevas), `html-to-image` + `jspdf` (export image/PDF). Backend : `server/index.mjs` (Node ≥ 20, **aucune dépendance npm**) sert `dist/` + `/api/*` ; en dev, Vite proxifie `/api` vers `localhost:8787`. État global : `src/store.ts` (`useSyncExternalStore`), persisté dans `localStorage` clé `trame:v1`, avec annulation/rétablissement (100 niveaux).

## Commandes
```bash
npm run dev      # http://localhost:5173
npm run api      # serveur IA sur :8787 (lit .env : GROQ_API_KEY, voir .env.example)
npm test         # exporteurs + IA (node, sans navigateur ni réseau)
npx tsc --noEmit
npm run build    # -> dist/
```
Vérification visuelle : `npx vite --port 5301 &` puis `python3 scripts/shot.py 5301 dark|light /tmp/x.png [largeur] [hauteur]` et regarder l'image. **Ne jamais utiliser `pkill -f` / `killall`** (peut tuer ton propre shell) ; `kill <pid>` précis.

## Structure
```
src/
  App.tsx                barre du haut, liste des tables, raccourcis (Ctrl+Z / Ctrl+Maj+Z)
  store.ts               modèle + toutes les mutations (mutate/checkpoint/undo/redo)
  components/
    Canvas.tsx           React Flow : synchro nœuds <-> store, relations, connexion par glisser
    TableNode.tsx        carte d'une table (poignées par colonne)
    RelationEdge.tsx     lien avec symboles « un » / « plusieurs » (pied de corbeau)
    Inspector.tsx        panneau de droite : table, colonnes, clé étrangère, index, schéma
    Dialogs.tsx          export (code + image), liste des schémas, import JSON, IA (AiDialog)
    bits.tsx             icônes, logo
  lib/
    image.ts             export PNG/JPG/SVG/PDF + viewCenter()
    zip.ts               ZIP sans compression (téléchargement des migrations)
    export/              exporteurs purs .mjs (SQL, Prisma, Laravel, Doctrine, DBML) + sample + types
    ai/schema.mjs        IA pure : prompts, format compact <-> modèle, validation, fusion, layoutTables()
    ai/client.ts         appels /api/health et /api/generate
server/index.mjs         serveur Node : statique dist/ + /api/generate (Groq), limite par IP
docs/MODEL.md            LE modèle de données JSON (à lire avant de toucher aux exports ou au store)
docs/ROADMAP.md          étapes 2 et 3 (IA Groq, temps réel)
test/export.test.mjs     tests des exporteurs
test/ai.test.mjs         tests IA (validation, fusion) sans réseau
scripts/shot.py          capture d'écran Playwright
deploy/Dockerfile        image Node unique (dist/ + API), voir docs/DEPLOY.md
```

## Règles
1. Le modèle est décrit dans `docs/MODEL.md`. Les relations se font par **id** (`column.ref.table` / `.column`), jamais par nom. Champs optionnels lus par les exporteurs : `length`, `precision`, `scale`, `enumValues`.
2. Toute modification du schéma passe par `mutate()` du store (annulation automatique). Pendant un glissement, utiliser `checkpoint()` au début puis `mutate(fn, false)`.
3. Les exporteurs restent **purs** (aucun import React/DOM) et sont testés : ajouter un test dans `test/export.test.mjs` pour toute nouvelle fonction ou tout cas limite (cycles de FK, noms invalides, PK composites).
4. Un nouvel exporteur s'ajoute dans `src/lib/export/` puis dans `EXPORTERS` de `index.mjs` : l'interface le propose automatiquement.
5. Export image : les styles des liens SVG sont figés en attributs pendant la capture (voir `image.ts`) ; ne pas retirer cette étape sinon les liens disparaissent de l'image.
6. Mêmes jetons CSS que Motif (`--bg`, `--panel`, `--fill`, `--acc`…), thème sombre par défaut, thème clair via `data-theme`.
7. Les noms de table/colonne sont libres dans l'éditeur ; chaque exporteur normalise (snake_case, PascalCase…).
8. IA : la clé Groq ne quitte jamais le serveur. Toute réponse du modèle passe par `fromCompact()` (validation) ; l'application au schéma passe par `applyAi()` du store (un seul point d'annulation). Pour tester le serveur sans clé réelle : `GROQ_URL=<faux serveur>`.
