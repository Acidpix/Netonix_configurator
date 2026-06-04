# CLAUDE.md — Netonix Manager

Contexte projet pour Claude Code. À lire avant toute modification.

---

## Ce que fait ce projet

Interface web de gestion multi-switch **Netonix WISP** (modèles WS-6, WS-8, WS-12, WS-26, WISP-12, WISP-16 + custom).

Un serveur **Express** tourne en local (Raspberry Pi / NAS / VM) et sert de proxy entre le navigateur et les switchs : il gère l'authentification par cookie, les certificats SSL auto-signés, et expose une API REST propre au frontend.

---

## Stack

- **Backend** : Node.js 16+, Express 4, node-fetch 2 (CommonJS, pas d'ESM)
- **Frontend** : HTML/CSS/JS vanilla, pas de framework, pas de bundler
- **Persistance** : SQLite via `better-sqlite3` (`data/netonix.db`) — module natif, nécessite `python3 make g++` sur le serveur
- **Migration** : si `data/switches.json` existe au premier démarrage, les données sont importées automatiquement dans SQLite

---

## Structure

```
src/
  server.js        # Point d'entrée — Express + routes
  config.js        # Variables d'env (PORT, DB_FILE, SWITCH_TIMEOUT, IGNORE_SSL)
  db.js            # Connexion SQLite + création tables + seed + migration JSON
  store.js         # CRUD SQLite — switches (id, name, ip, username, password, group, model, https, location, snmp_location)
  presetsStore.js  # CRUD SQLite — presets éditables (key, label, pvid, tagged, poe, ...)
  modelsStore.js   # CRUD SQLite — modèles de switch (key, label, port_count, builtin)
  netonix.js       # Client API Netonix — login / getConfig / pushConfig / resetConfig / ping / portStats / detectModel
  presets.js       # toPortConfig() (lit presetsStore) + detectPreset()
  routes/
    switches.js    # Routes /api/switches/* — inclut location/snmp_location, detectModel
    presets.js     # CRUD /api/presets
    models.js      # CRUD /api/models
    scan.js        # POST /api/scan — TCP scan réseau

public/
  index.html       # Shell SPA — charge les JS dans l'ordre ci-dessous
  css/app.css      # Tous les styles (dark theme, CSS variables)
  js/
    presets.js     # PRESETS{} + detectPreset() — miroir client de src/presets.js
    ui.js          # toast() / showTab() / setLoading() / setTopbar() / enableToolbar()
    ports.js       # portStates{} / selectedPorts / renderPortGrid() / applyPreset() / buildPortsPayload()
    vlans.js       # vlans[] / renderVlanTable() / buildVlansPayload() / DEFAULT_VLANS
    app.js         # Orchestration — App{} / selectSwitch() / fetchConfig() / pushConfig() / CRUD modal
```

**Ordre de chargement JS obligatoire** (défini dans index.html) :
`presets.js` → `ui.js` → `ports.js` → `vlans.js` → `app.js`

---

## API Netonix (switchs réels)

Documentée dans `src/netonix.js`. Endpoints utilisés :

| Méthode | URL switch | Description |
|---------|-----------|-------------|
| POST | `/api/v1/login` | Auth → cookie `PHPSESSID` ou `session` |
| GET | `/api/v1/config` | Config JSON complète |
| POST | `/api/v1/config` | Sauvegarde (merge avec l'existante) |
| POST | `/api/v1/apply` | Applique la config sauvegardée |
| GET | `/api/v1/portdetail?port=N` | Stats temps réel |

Les certificats SSL auto-signés sont acceptés via `https.Agent({ rejectUnauthorized: false })`.

---

## API backend (proxy)

Base : `/api/switches`

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Liste (mots de passe masqués) |
| POST | `/` | Ajout — `{ name, ip, username, password, https, group, model }` |
| PUT | `/:id` | Mise à jour |
| DELETE | `/:id` | Suppression |
| GET | `/:id/ping` | Test login → `{ online: bool }` |
| GET | `/:id/config` | Proxy GET `/api/v1/config` |
| POST | `/:id/config` | Merge + POST `/api/v1/config` + POST `/api/v1/apply` |
| POST | `/:id/ports` | `{ ports: [1,2,3], preset: 'cam' }` → applique preset sur ports |
| POST | `/:id/reset` | Reset propre — conserve hostname/ip/netmask/gateway |
| GET | `/:id/stats/:port` | Proxy `/api/v1/portdetail?port=N` |

---

## Presets de port

Définis dans `src/presets.js` (serveur) et `public/js/presets.js` (client, même structure).
**Si tu modifies un preset, modifie les deux fichiers.**

| Clé | VLAN natif | VLANs taggés | PoE | storm_control | stp | qos |
|-----|-----------|--------------|-----|---------------|-----|-----|
| `cam` | 30 | — | ✓ | ✓ | ✓ | ✗ |
| `ap` | 10 | 10,20,30,40,50 | ✓ | ✗ | ✓ | ✗ |
| `uplink` | 1 | 1,10,20,30,40,50 | ✗ | ✗ | ✗ | ✗ |
| `voip` | 40 | 10 | ✓ | ✗ | ✓ | ✓ |
| `server` | 20 | — | ✗ | ✗ | ✗ | ✗ |
| `disabled` | 1 | — | ✗ | ✗ | ✗ | ✗ |

---

## VLANs par défaut

| ID | Nom | Subnet | Usage |
|----|-----|--------|-------|
| 1 | Management | 192.168.1.0/24 | Gestion switches |
| 10 | LAN | 10.0.10.0/24 | Réseau local |
| 20 | Serveurs | 10.0.20.0/24 | Infra / NAS |
| 30 | Cameras | 10.0.30.0/24 | Vidéosurveillance |
| 40 | VoIP | 10.0.40.0/24 | Téléphonie IP |
| 50 | IoT | 10.0.50.0/24 | Objets connectés |

---

## Conventions de code

- **CommonJS partout** (`require` / `module.exports`), pas d'`import`/`export`
- `'use strict'` en tête de chaque fichier JS
- Pas de TypeScript, pas de transpilation, pas de bundler
- Le frontend est du **JS global pur** — les fonctions sont exposées sur `window` implicitement
- `window.App` est l'objet d'état global : `{ switches[], currentId, currentSw }`
- Les erreurs réseau sont toujours catchées et affichées via `toast(msg, 'err')`
- Les mots de passe ne sortent jamais du backend (filtrés dans `store.js` → `sanitize()`)

---

## Points d'attention

- **node-fetch v2** (CommonJS) — ne pas upgrader en v3 (ESM only)
- `detectPreset()` est une heuristique — elle peut se tromper sur des configs custom
- Le `pushConfig()` backend fait un **merge** avec la config existante du switch pour ne pas écraser les champs non gérés (NTP, SNMP, etc.)
- Le `resetConfig()` ne garde que `hostname / ip / netmask / gateway` — tout le reste est réécrit
- `data/switches.json` est dans `.gitignore` — ne jamais le commiter (contient les credentials)

---

## Lancer en dev

```bash
npm start          # node src/server.js
# ou avec watch (Node 18+)
npm run dev        # node --watch src/server.js
```

Pas de hot-reload frontend — F5 suffit, pas de bundler.
