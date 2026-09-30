# Feuille de route

## Étape 2 — IA (Groq) — fait
Implémenté : `server/index.mjs` (Node sans dépendance, `/api/health` + `/api/generate`, relance si JSON invalide, limite par IP), `src/lib/ai/schema.mjs` (format compact, validation, fusion, placement ; testé dans `test/ai.test.mjs`), dialogue « IA » (`AiDialog` dans `Dialogs.tsx`) avec les modes Nouveau schéma / Remplacer / Ajouter / Modifier.
Écart assumé : le modèle ne produit pas le JSON complet de MODEL.md mais un **format compact** (refs par nom, sans positions ni couleurs), plus fiable ; `fromCompact()` le convertit en schéma Trame valide. En mode « modifier », les `id` existants sont transmis et recopiés par le modèle pour garder positions et couleurs.

Plan initial :
But : l'utilisateur décrit son projet (« une boutique avec clients, commandes, produits et avis »), Trame génère le schéma, modifiable ensuite.
- **La clé Groq ne doit jamais être dans le navigateur.** Un petit serveur Node expose `POST /api/generate` qui appelle l'API Groq (endpoint compatible OpenAI, `https://api.groq.com/openai/v1/chat/completions`), clé dans la variable d'environnement `GROQ_API_KEY` (Coolify).
- Demander au modèle un **JSON strict** conforme à `docs/MODEL.md` (mode JSON de l'API), puis **valider côté serveur** : types connus, ids uniques, `ref` qui pointent vers des ids existants, sinon corriger ou refuser.
- Côté client : dialogue « Décrire mon projet » → aperçu → « Ajouter au schéma » (fusion) ou « Remplacer ». Le positionnement des tables passe par `autoLayout()` du store.
- Variante : « modifier avec l'IA » (envoyer le schéma actuel + une instruction, recevoir le schéma mis à jour).
- Limiter le débit par IP et la taille du prompt.

## Étape 3 — Partage et temps réel
- Serveur Node + **Yjs** (`y-websocket`) : le schéma devient un document partagé (`Y.Map` des tables, `Y.Array` des colonnes), le store local est alimenté par le document.
- Stockage des schémas partagés : SQLite (fichier monté en volume sur Coolify).
- Lien de partage `/s/<id>` avec droits lecture/édition ; curseurs des autres personnes via l'awareness Yjs.
- Annulation : utiliser `Y.UndoManager` (remplace l'historique local pour les schémas partagés).
- Déploiement : un seul conteneur Node qui sert aussi `dist/`.
