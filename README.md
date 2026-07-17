# Invader Hunt 👾

PWA personnelle pour chasser les mosaïques de l'artiste **Invader** : elle affiche sur une carte les invaders que je n'ai pas encore flashés, et calcule des itinéraires piétons qui en capturent un maximum sans s'écarter de plus de **200 m** du chemin direct.

## Fonctionnement

- **Mes flashs** : récupérés en direct depuis l'API FlashInvaders (`api/gallery?uid=…`), mis en cache 6 h dans le navigateur. UID modifiable dans ⚙️ Réglages.
- **Localisation des mosaïques** : sources de [MapInvaders](https://chborel.ch/mapinvaders/) (4335 invaders géolocalisés, statuts à jour dont les réactivations), importées dans `data/invaders.json` par `tools/import_mapinvaders.py`. (Historique : le projet utilisait initialement [goguelnikov/SpaceInvaders](https://github.com/goguelnikov/SpaceInvaders), moins à jour.)
- **Carte** : Leaflet + tuiles OpenStreetMap. Violet = à flasher, orange = à flasher mais endommagé, gris = déjà flashé, rouge = détruit/caché (masqués par défaut, et jamais proposés dans les itinéraires).
- **Itinéraires** : OSRM piéton (instance FOSSGIS `routing.openstreetmap.de`). L'app calcule le trajet direct, cherche les invaders non flashés dans un corridor de 200 m, les ordonne le long du trajet et recalcule l'itinéraire en passant par eux (max 60 étapes ; au-delà, priorité aux plus proches du chemin).
- **Adresses** : géocodage Nominatim (OpenStreetMap).

## Utilisation

- 📍 : se géolocaliser (nécessite HTTPS sur iPhone).
- Champ de recherche : taper une adresse → l'itinéraire optimisé se calcule depuis la position courante.
- Appui long (mobile) / clic droit (desktop) sur la carte : poser un départ 🚩 ou une destination 🎯 manuellement.
- 🥾 : générer une **rando** — deux types de zone : par **arrondissement** (avec compteur d'invaders restants) ou **autour d'un point** (rayon de 250 m à 2 km ; centre = départ manuel 🚩, sinon ma position, sinon le centre de la carte, cercle affiché sur la carte). Dans les deux cas : distance visée (3 à 12 km), boucle ou traverse, tournée optimisée par OSRM (service `trip`).
- 📷 : chaque invader (popup et liste d'étapes) pointe vers la recherche Instagram `#PA_<n°>` pour voir des visuels de la mosaïque.
- 👾 : afficher/masquer les flashés et les détruits.

## Hors ligne

Le service worker met en cache l'app, la base des invaders et les **tuiles de carte déjà consultées** (max ~2500 tuiles, les plus anciennes sont purgées). Préparez votre balade en wifi : la zone parcourue à l'écran restera disponible hors ligne. Le calcul d'itinéraire et le géocodage nécessitent en revanche du réseau.

L'attribution des arrondissements est précalculée par `tools/add_arrondissements.py` (polygones officiels opendata.paris.fr, champ `arr` dans `data/invaders.json`).

## Développement local

```bash
node serve.js   # http://127.0.0.1:8788
```

## Mise à jour des données

```bash
python3 tools/import_mapinvaders.py    # re-télécharge les sources MapInvaders
python3 tools/add_arrondissements.py   # réattribue les arrondissements
python3 tools/bump_build.py            # nouveau build
git commit -am "maj données" && git push
```

## Limites connues

- `SPACE2ISS` (l'invader de la Station spatiale internationale) n'est pas sur la carte.
- Les invaders trop récents pour MapInvaders n'apparaissent qu'après leur prochaine mise à jour (relancer l'import).
- La contrainte des 200 m s'applique aux invaders choisis comme étapes ; le chemin entre deux étapes suit les rues et peut très ponctuellement déborder du corridor.

## Déploiement

Hébergé sur GitHub Pages (branche `main`, racine) : https://benoitprat.github.io/invader-hunt/ — chaque push déploie. Sur iPhone : Safari → Partager → « Sur l'écran d'accueil ».

**Avant chaque commit à déployer, lancer :**

```bash
python3 tools/bump_build.py
```

Ce script stampe un numéro de build (`AAAA-MM-JJ.HHMM`) dans `version.js` (affiché dans ⚙️ Réglages) et dans le nom de cache de `sw.js`. Sans ce bump, les PWA installées continuent de servir l'ancienne version depuis leur cache. Côté iPhone, la mise à jour arrive au 2ᵉ lancement après le déploiement ; le numéro de build dans ⚙️ permet de vérifier quelle version tourne.
