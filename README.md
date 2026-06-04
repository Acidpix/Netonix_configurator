# Netonix Manager

Interface web de gestion multi-switch Netonix pour réseaux WISP.

Récupère et pousse les configurations via l'API REST intégrée des switchs,
avec un proxy Node.js qui gère l'authentification cookie et les certificats SSL auto-signés.

---

## Fonctionnalités

- **Inventaire multi-switch** groupé, indicateur en ligne/hors ligne (polling 30 s)
- **Fetch automatique** de la config dès la sélection d'un switch en ligne
- **Presets de port** : Caméra IP, AP WiFi, Uplink/Trunk, VoIP, Serveur/NAS, Désactivé
- **Sélection multiple** de ports pour appliquer un preset en lot
- **Table VLAN** éditable avec valeurs par défaut prêtes à l'emploi
- **Reset propre** : réécrit la config en conservant l'IP et le nom du switch
- **Config JSON brute** visible et copiable pour le débogage

---

## Structure du projet

```
netonix-manager/
├── src/
│   ├── server.js          # Point d'entrée Express
│   ├── config.js          # Variables d'environnement
│   ├── store.js           # Persistance JSON (inventaire des switchs)
│   ├── netonix.js         # Client API REST Netonix
│   ├── presets.js         # Définition des presets de port
│   └── routes/
│       └── switches.js    # Routes API /api/switches
├── public/
│   ├── index.html         # SPA (shell HTML)
│   ├── css/app.css        # Styles
│   └── js/
│       ├── presets.js     # Presets côté client
│       ├── ui.js          # Helpers UI (toast, tabs, topbar)
│       ├── ports.js       # Grille de ports
│       ├── vlans.js       # Table VLAN
│       └── app.js         # Logique principale
├── systemd/
│   └── netonix-manager.service
├── scripts/
│   └── install.sh         # Installation automatique
├── data/
│   └── .gitkeep           # Dossier versionné, switches.json ignoré
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
| `DATA_FILE` | `data/switches.json` | Chemin vers l'inventaire |
| `SWITCH_TIMEOUT` | `10000` | Timeout requêtes switches (ms) |
| `IGNORE_SSL` | `true` | Accepter les certificats auto-signés |

---

## API backend

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/switches` | Liste l'inventaire |
| `POST` | `/api/switches` | Ajoute un switch |
| `PUT` | `/api/switches/:id` | Modifie un switch |
| `DELETE` | `/api/switches/:id` | Supprime un switch |
| `GET` | `/api/switches/:id/ping` | Test de connectivité |
| `GET` | `/api/switches/:id/config` | Récupère la config JSON |
| `POST` | `/api/switches/:id/config` | Pousse + applique une config |
| `POST` | `/api/switches/:id/ports` | Applique un preset sur des ports |
| `POST` | `/api/switches/:id/reset` | Reset propre (conserve IP/nom) |
| `GET` | `/api/switches/:id/stats/:port` | Stats temps réel d'un port |

---

## API Netonix utilisée

| Méthode | Endpoint | Usage |
|---------|----------|-------|
| `POST` | `/api/v1/login` | Authentification → cookie de session |
| `GET` | `/api/v1/config` | Récupération config JSON complète |
| `POST` | `/api/v1/config` | Sauvegarde config |
| `POST` | `/api/v1/apply` | Application de la config |
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

---

## Sécurité

- Les mots de passe des switchs ne sont jamais renvoyés au frontend
- Le fichier `data/switches.json` est dans `.gitignore`
- Déployez derrière un reverse proxy (nginx) avec HTTPS si exposé hors réseau local

---

## Licence

MIT
