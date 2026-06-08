# Guide d'utilisation — Netonix Manager

Ce guide explique comment utiliser l'interface au quotidien pour gérer vos switchs Netonix.
Pour l'installation et la configuration serveur, voir le [README](README.md).

---

## Sommaire

1. [Premiers pas](#1-premiers-pas)
2. [Vue d'ensemble de l'interface](#2-vue-densemble-de-linterface)
3. [Ajouter des switchs](#3-ajouter-des-switchs)
4. [Sélectionner et lire un switch](#4-sélectionner-et-lire-un-switch)
5. [Configurer les ports](#5-configurer-les-ports)
6. [Le PoE (24V / 48V / 48VH)](#6-le-poe-24v--48v--48vh)
7. [Les ports « HS » verrouillés](#7-les-ports--hs--verrouillés)
8. [Les VLANs](#8-les-vlans)
9. [Appliquer la configuration (Push)](#9-appliquer-la-configuration-push)
10. [Reset et redémarrage](#10-reset-et-redémarrage)
11. [Paramètres](#11-paramètres)
12. [Dépannage](#12-dépannage)

---

## 1. Premiers pas

1. Ouvrez l'application dans votre navigateur (par défaut `http://adresse-du-serveur:3000`).
2. La première fois, l'inventaire est vide : ajoutez un switch manuellement ou lancez un **Scan réseau** (voir [§3](#3-ajouter-des-switchs)).
3. Cliquez sur un switch dans la liste de gauche pour charger sa configuration.

> Le serveur fait office de proxy entre votre navigateur et les switchs : il gère l'authentification et les certificats auto-signés. Vos navigateurs n'ont donc pas besoin d'accéder directement aux switchs.

---

## 2. Vue d'ensemble de l'interface

| Zone | Rôle |
|------|------|
| **Barre latérale (gauche)** | Inventaire des switchs, groupés. Une pastille indique l'état : 🟢 en ligne, 🔴 hors ligne, ⚪ en cours de test (rafraîchi toutes les 30 s). |
| **Barre du haut** | Nom du switch sélectionné + boutons d'action (Sync, Push, Reset…). |
| **Carte d'infos switch** | Nom, localisation, SNMP, IP (lien cliquable), modèle, version de config. |
| **Grille des ports** | Représentation visuelle de chaque port (preset, PoE, lien). |
| **Panneau de détail** | Apparaît quand un port est sélectionné : édition fine du port. |
| **Config brute** | Le JSON complet renvoyé par le switch, copiable (utile pour le débogage). |

Boutons utiles de la barre du haut / barre d'outils :

- **↓ Sync conf** — recharge la configuration depuis le switch.
- **↑ Push conf** — envoie la configuration modifiée au switch.
- **⚠ Factory reset** — remet les ports à zéro (conserve IP + nom).
- **↺ Reset device** — redémarre le switch.
- **Mode : Preset / PoE** — change la couleur des ports (par preset ou par type de PoE).
- **⊞ Grille / ☰ Tableau** — bascule entre la vue grille et la vue tableau.
- **☾ / ☀** — thème sombre / clair.

---

## 3. Ajouter des switchs

### Manuellement

Bouton **+ Ajouter** → renseignez :

- **IP**, **utilisateur**, **mot de passe** (obligatoires),
- **HTTPS** (coché par défaut),
- **Nom**, **Groupe**, **Modèle**, **Localisation**, **SNMP**.

> Astuce : le bouton **⟳ Connexion au switch** interroge le switch pour pré-remplir automatiquement le nom, la localisation et le modèle détecté.

### Par scan réseau

Bouton **Scan** → entrez un sous-réseau au format CIDR (ex. `192.168.1.0/24`) → **Scanner**.

- Les appareils Netonix trouvés s'affichent avec leur IP, le mode HTTP/HTTPS et le modèle détecté.
- Les switchs déjà présents dans l'inventaire sont ignorés.
- Cochez ceux à ajouter, ajustez les noms, puis **Ajouter la sélection**.

Les identifiants utilisés pour le scan se configurent dans **Paramètres → Paramètres scan**.

---

## 4. Sélectionner et lire un switch

Cliquez sur un switch dans la barre latérale :

1. La config est récupérée automatiquement (un **Sync** se déclenche).
2. La grille des ports se remplit : chaque port affiche son **preset détecté**, son **PoE réel** et l'**état du lien**.
3. La carte d'infos et le JSON brut se mettent à jour.

> La détection de preset se base sur le **VLAN** du port (natif + taggés). Le PoE et l'état affichés reflètent toujours la **configuration réelle** du port, même si l'étiquette de preset diffère.

Un rafraîchissement automatique a lieu toutes les 60 s tant qu'un switch est sélectionné.

---

## 5. Configurer les ports

### Sélectionner un port

- **Clic gauche** sur un port → le sélectionne (un seul port à la fois) et ouvre le panneau de détail.
- **Re-clic** sur le même port → le désélectionne.
- **Clic droit** → désélectionne tout.

### Appliquer un preset

Deux méthodes :

1. **Clic** : sélectionnez un port, puis cliquez sur un bouton de preset (Caméra IP, AP WiFi, Uplink…).
2. **Glisser-déposer** : faites glisser un bouton de preset directement sur un port.

Si le port a déjà une configuration, une fenêtre de confirmation récapitule le changement avant application.

### Éditer un port en détail

Le panneau de détail permet d'ajuster, port par port :

- **État** (activé / désactivé),
- **PoE** (OFF / 24V / 48V / 48VH — voir [§6](#6-le-poe-24v--48v--48vh)),
- **VLAN natif (PVID)** et **VLANs taggés**,
- **Description** (nom du port),
- options **Storm-control**, **STP**, **QoS**.

Pour les VLANs taggés, vous pouvez saisir des **listes et des plages**, par exemple `10,20,230-240`. L'affichage est automatiquement condensé (`230-240`).

### Vue grille ou tableau

- **Grille** : vue compacte avec code couleur, idéale pour visualiser d'un coup d'œil.
- **Tableau** : une ligne par port avec preset, VLAN natif, taggés, PoE et lien.

Le bouton **Mode : Preset / PoE** change le code couleur : par type de preset, ou par tension PoE (vert = 48V, jaune = 24V, rouge = 48VH, gris = off).

> ⚠️ Modifier un port dans l'interface **ne l'envoie pas** au switch tout de suite. Il faut cliquer sur **↑ Push conf** (voir [§9](#9-appliquer-la-configuration-push)).

---

## 6. Le PoE (24V / 48V / 48VH)

Tous les ports ne supportent pas tous les types de PoE. Pour éviter d'appliquer une tension qu'un port ne supporte pas, **chaque modèle de switch déclare les ports capables de chaque type** (voir [Paramètres → Modèles](#11-paramètres)).

Quand vous appliquez un PoE non supporté sur un port :

- il est **automatiquement rétrogradé** vers le type inférieur supporté (48VH → 48V → 24V), sinon **Off** ;
- un message vous avertit des ports concernés ;
- dans le panneau de détail, les types non supportés apparaissent grisés (« non supporté »).

Cette protection s'applique aussi **côté serveur** au moment du Push : un type non supporté n'est jamais réellement écrit sur le switch.

**Valeurs par défaut** : 24V et 48V sont supportés sur tous les ports ; 48VH n'est supporté sur aucun port tant que vous ne l'avez pas configuré par modèle.

---

## 7. Les ports « HS » verrouillés

Pour protéger un port hors service, **nommez-le exactement `HS`** (dans sa description).

Un port `HS` devient **verrouillé** :

- il s'affiche avec une bordure ambre et un badge **🔒 HS** ;
- on ne peut **pas** lui appliquer de preset (ni au clic, ni par glisser-déposer) ;
- ses réglages ne sont **pas modifiables** ;
- il est **exclu de tout Push** : une poussée de configuration ne le touche jamais.

Pour le modifier malgré tout : sélectionnez-le, puis cliquez sur **🔓 Déverrouiller ce port** dans le panneau de détail. Le port redevient éditable pour la session en cours. Le verrou se réengage au prochain chargement de la config (ou changement de switch) tant que son nom reste `HS`.

> Pour lever définitivement le verrou : déverrouillez le port, puis changez ou effacez son nom `HS`.

---

## 8. Les VLANs

L'onglet/table **VLANs** liste les VLANs du switch (ID, nom, sous-réseau, description). Vous pouvez les éditer, en ajouter ou en supprimer.

Pour **réorganiser l'ordre** des VLANs, saisissez la poignée **⠿** à gauche d'une ligne et glissez-la à la position voulue. Le même réordonnancement est disponible dans l'éditeur de presets VLAN.

Des **presets VLAN** permettent d'appliquer d'un coup un jeu de VLANs prédéfini (ex. la configuration standard à 6 VLANs : Management, LAN, Serveurs, Caméras, VoIP, IoT). Ils se gèrent dans **Paramètres → Presets VLAN**.

Lors d'un Push, les VLANs renseignés sont créés/mis à jour sur le switch, et la matrice port↔VLAN est recalculée à partir des PVID et des taggés de chaque port.

---

## 9. Appliquer la configuration (Push)

Une fois vos modifications faites, cliquez sur **↑ Push conf**.

Le serveur :

1. fusionne vos changements avec la config existante du switch (les champs non gérés — NTP, SNMP… — sont préservés) ;
2. envoie la config et l'applique ;
3. **confirme l'application** auprès du switch pour empêcher le retour arrière automatique.

### À propos du « revert » automatique

Les switchs Netonix annulent une nouvelle configuration au bout d'environ **60 secondes** si le client ne confirme pas que le lien de management a survécu (sécurité anti-verrouillage). L'application gère cette confirmation automatiquement.

- Si tout va bien, un message vert confirme l'application.
- Si la confirmation échoue (switch injoignable juste après l'apply), un message rouge vous prévient que la config **risque de revenir en arrière** — relancez un Push.

---

## 10. Reset et redémarrage

- **⚠ Factory reset** — réécrit une configuration propre en **conservant** le nom d'hôte, l'IP, le masque et la passerelle. Tout le reste (ports, VLANs) est remis à zéro. Une confirmation est demandée (action irréversible).
- **↺ Reset device** — redémarre le switch (inaccessible quelques secondes).

---

## 11. Paramètres

Accessible via le bouton **Paramètres** (⚙). Quatre onglets :

### Modèles de switch
Liste des modèles (WS-6, WS-8, WS-12, WS-26, WISP-12, WISP-16 + vos modèles custom).
Pour chaque modèle, vous définissez **les ports capables de chaque type de PoE** — `24V`, `48V`, `48VH` — sous forme de plages (ex. `1-4,7`). Vide = aucun port. Ces réglages pilotent la rétrogradation décrite au [§6](#6-le-poe-24v--48v--48vh).
Vous pouvez aussi **ajouter un modèle custom** (clé, label, nombre de ports).

### Presets ports
Création et édition des presets de port (Caméra IP, AP WiFi, etc.) : libellé, VLAN natif, **VLANs taggés (plages acceptées, ex. `10,20,230-240`)**, type de PoE, couleur, et options Storm-control / STP / QoS.

### Presets VLAN
Jeux de VLANs réutilisables (voir [§8](#8-les-vlans)).

### Paramètres scan
Identifiants par défaut (utilisateur / mot de passe) utilisés lors du scan réseau et pré-remplis à l'ajout d'un switch.

---

## 12. Dépannage

| Symptôme | Piste |
|----------|-------|
| Switch affiché hors ligne | Vérifiez l'IP, le mode HTTP/HTTPS et les identifiants. Le serveur doit pouvoir joindre le switch. |
| « Authentification échouée » | Identifiants incorrects pour ce switch (modifiez-le via ✎). |
| La config revient en arrière après ~1 min | La confirmation anti-revert a échoué (lien instable au moment de l'apply). Relancez un Push. |
| Un PoE 48VH n'est pas appliqué | Le port n'est pas déclaré capable de 48VH pour ce modèle → il est rétrogradé. Configurez les ports 48VH dans Paramètres → Modèles. |
| Impossible de modifier un port | Le port est nommé `HS` et verrouillé → déverrouillez-le ([§7](#7-les-ports--hs--verrouillés)). |
| Modèle mal détecté | Le nombre de ports sert de repli pour la détection. Corrigez le modèle du switch via ✎. |
| Un changement n'apparaît pas | Pensez à **Push conf** pour l'envoyer, puis **Sync conf** pour relire l'état réel. |

---

Pour les détails techniques (API, architecture, déploiement), voir le [README](README.md).
