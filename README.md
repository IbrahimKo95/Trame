# Trame

Éditeur de schémas de bases de données : dessine tes tables et relations, exporte en image/PDF ou en code (SQL, Prisma, Laravel, Doctrine, DBML).

Génération et modification du schéma par IA (Groq) : décris ton projet, Trame propose les tables.

React 18 + TypeScript + Vite + React Flow ; petit serveur Node sans dépendance pour l'IA.

```bash
npm install
cp .env.example .env   # renseigner GROQ_API_KEY
npm run api     # serveur IA :8787
npm run dev     # http://localhost:5173 (proxy /api)
npm test
npm run build && npm start   # prod locale : http://localhost:8787
```

Déploiement : Coolify, Dockerfile `deploy/Dockerfile` (port 3000, variable `GROQ_API_KEY`) — voir [docs/DEPLOY.md](docs/DEPLOY.md). Contexte pour Claude Code : [CLAUDE.md](CLAUDE.md).
