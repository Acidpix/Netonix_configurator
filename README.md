# Netonix Manager

Interface web de gestion multi-switch Netonix pour réseaux WISP.

Récupère et pousse les configurations via l'API REST intégrée des switchs,
avec un proxy Node.js qui gère l'authentification cookie et les certificats SSL auto-signés.

> 📖 **Guide d'utilisation pas à pas : [GUIDE.md](GUIDE.md)**

---

## Fonctionnalités

- **Inventaire multi-switch** groupé, indicateur en ligne/hors ligne (polling 30 s)
- **Scan réseau** pour découvrir et ajouter automatiquement les switchs d'un sous-réseau
- **Fetch automatique** de la config dès la sélection d'un switch en ligne
- **Presets de port** éditables : Caméra IP, AP WiFi, Uplink/Trunk, VoIP, Serveur/NAS, Désactivé
- **PoE par type et par modèle** : ports capables de 24V / 48V / 48VH, avec rétrogradation automatique
- **Ports « HS » verrouillés** : protection contre toute modification accidentelle
- **VLANs taggés en plages** (`10,20,230-240`) et presets VLAN réutilisables
- **Confirmation anti-revert** : empêche le retour arrière automatique du switch après application
- **Vue grille ou tableau**, code couleur par preset ou par tension PoE
- **Reset propre** : réécrit la config en conservant l'IP et le nom du switch
- **Config JSON brute** visible et copiable pour le débogage

---

## Stack & persistance

- **Backend** : Node.js 16+, Express 4, node-fetch 2 (CommonJS)
- **Frontend** : HTML/CSS/JS vanilla, sans framework ni bundler
- **Persistance** : SQLite via `better-sqlite3` (`data/netonix.db`)
- **Migration** : si un ancien `data/switches.json` existe au premier démarrage, son contenu est importé dans SQLite puis le fichier est renommé en `.bak`

---

## Structure du projet

```
netonix-manager/
├── src/
│   ├── server.js            # Point d'entrée Express + montage des routes
│   ├── config.js            # Variables d'environnement
│   ├── db.js                # Connexion SQLite, tables, seed, migration JSON
│   ├── store.js             # CRUD switchs (SQLite)
│   ├── presetsStore.js      # CRUD presets de port
│   ├── modelsStore.js       # CRUD modèles de switch (+ capacités PoE)
│   ├── vlanPresetsStore.js  # CRUD presets VLAN
│   ├── settingsStore.js     # CRUD paramètres (identifiants de scan…)
│   ├── netonix.js           # Client API REST Netonix (login, config, apply, confirm…)
│   ├── presets.js           # toPortConfig() / detectPreset()
│   ├── ranges.js            # parseRanges()/formatRanges() — plages "10,20,230-240"
│   └── routes/
│       ├── switches.js      # /api/switches
│       ├── presets.js       # /api/presets
│       ├── vlanPresets.js   # /api/vlan-presets
│       ├── models.js        # /api/models
│       ├── settings.js      # /api/settings
│       └── scan.js          # /api/scan
├── public/
│   ├── index.html           # SPA (shell HTML)
│   ├── css/app.css          # Styles
│   └── js/
│       ├── ranges.js        # Miroir client de src/ranges.js (chargé en 1er)
│       ├── presets.js       # Presets côté client
│       ├── ui.js            # Helpers UI (toast, tabs, topbar)
│       ├── ports.js         # Grille/tableau de ports, presets, verrou HS
│       ├── vlans.js         # Table VLAN
│       ├── vlanPresets.js   # Presets VLAN côté client
│       └── app.js           # Orchestration (sélection, fetch, push, modales)
├── systemd/
│   └── netonix-manager.service
├── scripts/
│   └── install.sh           # Installation automatique
├── data/
│   └── netonix.db           # Base SQLite (ignorée par git)
├── .env.example
├── .gitignore
└── package.json
```

---

## Installation

### Développement (démarrage rapide)

```bash
git clone https://github.com/votre-org/netonix-manager
cd netonix-manager
cp .env.example .env
npm install
npm start
# → http://localhost:3000
```

### Production (Raspberry Pi / NAS / VM Linux)

```bash
git clone https://github.com/votre-org/netonix-manager
cd netonix-manager
sudo bash scripts/install.sh --user pi --port 3000 --dir /opt/netonix-manager
```

Le script installe les dépendances, crée un service systemd et le démarre.

### Mise à jour

```bash
cd /opt/netonix-manager
git pull
npm install --omit=dev
sudo systemctl restart netonix-manager
```

---

## Configuration (.env)

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3000` | Port d'écoute du serveur |
| `DB_FILE` | `data/netonix.db` | Chemin vers la base SQLite |
| `DATA_FILE` | `data/switches.json` | Ancien inventaire JSON (importé puis renommé `.bak`) |
| `SWITCH_TIMEOUT` | `10000` | Timeout requêtes switches (ms) |
| `IGNORE_SSL` | `true` | Accepter les certificats auto-signés |
| `DEFAULT_USERNAME` | `admin` | Identifiant de scan par défaut (au 1er démarrage) |
| `DEFAULT_PASSWORD` | `netonix` | Mot de passe de scan par défaut (au 1er démarrage) |

---

## API backend

### Switchs — `/api/switches`

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/switches` | Liste l'inventaire (mots de passe masqués) |
| `POST` | `/api/switches` | Ajoute un switch |
| `PUT` | `/api/switches/:id` | Modifie un switch |
| `DELETE` | `/api/switches/:id` | Supprime un switch |
| `GET` | `/api/switches/:id/ping` | Test de connectivité |
| `GET` | `/api/switches/:id/config` | Récupère la config JSON (+ modèle détecté) |
| `POST` | `/api/switches/:id/config` | Pousse + applique + confirme une config |
| `POST` | `/api/switches/:id/ports` | Applique un preset sur des ports |
| `POST` | `/api/switches/:id/reset` | Reset propre (conserve IP/nom) |
| `POST` | `/api/switches/:id/reboot` | Redémarre le switch |
| `GET` | `/api/switches/:id/stats/:port` | Stats temps réel d'un port |

### Presets de port — `/api/presets`

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` / `POST` | `/api/presets` | Liste / crée un preset |
| `PUT` / `DELETE` | `/api/presets/:key` | Modifie / supprime un preset |

### Modèles — `/api/models`

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` / `POST` | `/api/models` | Liste / ajoute un modèle |
| `PUT` | `/api/models/:key` | Met à jour les ports capables par type de PoE |
| `DELETE` | `/api/models/:key` | Supprime un modèle custom |

### Presets VLAN — `/api/vlan-presets`

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` / `POST` | `/api/vlan-presets` | Liste / crée un preset VLAN |
| `PUT` / `DELETE` | `/api/vlan-presets/:key` | Modifie / supprime un preset VLAN |

### Paramètres & scan

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/settings` | Tous les paramètres |
| `PUT` | `/api/settings/:key` | Modifie un paramètre (ex. identifiants de scan) |
| `POST` | `/api/scan` | Scan TCP d'un sous-réseau CIDR |
| `POST` | `/api/scan/probe` | Interroge un switch unique pour pré-remplir ses infos |

---

## API Netonix utilisée

| Méthode | Endpoint | Usage |
|---------|----------|-------|
| `POST` | `/api/v1/login` | Authentification → cookie de session |
| `GET` | `/api/v1/config` | Récupération config JSON complète |
| `POST` | `/api/v1/config` | Sauvegarde config |
| `POST` | `/api/v1/apply` | Application de la config (arme le revert timer) |
| `GET` | `/api/v1/applystatus` | Confirmation post-apply (anti-revert ~60 s) |
| `POST` | `/api/v1/reboot` | Redémarrage du switch |
| `GET` | `/api/v1/portdetail?port=N` | Stats temps réel d'un port |

---

## Presets de port

| Preset | VLAN natif | VLANs taggés | PoE | Spécificités |
|--------|-----------|--------------|-----|--------------|
| Caméra IP | 30 | — | ✓ | Storm-control, STP portfast |
| AP WiFi | 10 | 10,20,30,40,50 | ✓ | Trunk multi-VLAN, STP portfast |
| Uplink / Trunk | 1 | 1,10,20,30,40,50 | ✗ | Trunk complet |
| VoIP | 40 | 10 | ✓ | QoS DSCP, STP portfast |
| Serveur / NAS | 20 | — | ✗ | Access simple |
| Désactivé | — | — | ✗ | Shutdown administratif |

Ces presets sont **éditables** (et de nouveaux peuvent être créés) via **Paramètres → Presets ports**.
Le type de PoE réellement appliqué dépend des **ports capables déclarés par modèle** (voir le [guide](GUIDE.md#6-le-poe-24v--48v--48vh)).

---

## Sécurité

- Les mots de passe des switchs ne sont jamais renvoyés au frontend (masqués dans `store.js`)
- La base `data/netonix.db` (qui contient les identifiants) est dans `.gitignore`
- Déployez derrière un reverse proxy (nginx) avec HTTPS si exposé hors réseau local

---

## Licence

MIT
