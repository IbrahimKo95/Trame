# Déploiement sur Coolify

Depuis l'étape 2, Trame est **un seul conteneur Node** (`server/index.mjs`, aucune dépendance npm à l'exécution) qui sert `dist/` et l'API IA (`/api/health`, `/api/generate`).

## Dockerfile (recommandé)
1. Coolify → la ressource Trame (ou **New Resource** → repo GitHub).
2. **Build Pack** : `Dockerfile`, **Dockerfile Location** : `/deploy/Dockerfile`.
3. **Ports Exposes** : `3000`.
4. **Environment Variables** :
   - `GROQ_API_KEY` = ta clé Groq (https://console.groq.com/keys) — **obligatoire pour l'IA**, jamais exposée au navigateur.
   - `GROQ_MODEL` (facultatif, défaut `openai/gpt-oss-120b`) — tout modèle Groq qui gère `response_format: json_object`.
   - `RATE_LIMIT` (facultatif, défaut `12`) — générations autorisées par IP et par tranche de 10 min.
5. Domaine + **Deploy**. Healthcheck intégré sur `/api/health`.

Sans `GROQ_API_KEY`, l'app fonctionne normalement ; le bouton « IA » est simplement désactivé.

Derrière le Cloudflare Tunnel, l'IP du client est lue dans `cf-connecting-ip` (limite de débit par personne, pas par tunnel).

## Ancienne option statique (sans IA)
Nixpacks « static » (`npm ci`, `npm run build`, publier `/dist`, SPA) marche toujours, mais sans `/api` : le bouton « IA » reste désactivé.

## Données
Les schémas sont stockés dans le `localStorage` du navigateur (clé `trame:v1`) : rien côté serveur, donc rien à sauvegarder. Le serveur IA ne conserve ni les descriptions ni les schémas. Un schéma créé sur un appareil n'apparaît pas sur un autre : passer par l'export JSON puis « Importer du JSON » (la synchronisation viendra avec l'étape 3).
