# Invader Hunt 👾

PWA personnelle pour chasser les mosaïques de l'artiste **Invader** : elle affiche sur une carte les invaders que je n'ai pas encore flashés, et calcule des itinéraires piétons qui en capturent un maximum sans s'écarter de plus de **200 m** du chemin direct.

> Ce fichier décrit l'usage et l'exploitation. Pour les décisions d'architecture et leurs raisons, voir [docs/choix-techniques.md](docs/choix-techniques.md) ; pour les idées étudiées, écartées ou en attente, voir [docs/pistes.md](docs/pistes.md).

## Fonctionnement

- **Mes flashs** : récupérés en direct depuis l'API FlashInvaders (`api/gallery?uid=…`), mis en cache 6 h dans le navigateur. UID modifiable dans ⚙️ Réglages.
- **Localisation des mosaïques** : sources de [MapInvaders](https://chborel.ch/mapinvaders/) (statuts à jour, réactivations comprises), importées dans `data/invaders.json` par `tools/import_mapinvaders.py`. Base actuelle : 4343 invaders localisés, dont **Paris complet à 1597 sur 1597** référencés. Les points manquants sont comblés par un second jeu invader-spotter, sans jamais écraser une valeur déjà connue (55 invaders restent sans points, aucun à Paris). (Historique : le projet utilisait initialement [goguelnikov/SpaceInvaders](https://github.com/goguelnikov/SpaceInvaders), moins à jour.)
- **Carte** : Leaflet + tuiles OpenStreetMap, rotation manuelle à deux doigts. Deux modes de couleur au choix, par statut ou par valeur en points ; les détruits et les cachés sont masqués par défaut et ne sont jamais proposés dans les itinéraires.
- **Itinéraires** : OSRM piéton (instance FOSSGIS `routing.openstreetmap.de`). L'app calcule le trajet direct, cherche les invaders non flashés dans un corridor de 200 m, les ordonne le long du trajet et recalcule l'itinéraire en passant par eux (max 60 étapes ; au-delà, priorité aux plus proches du chemin).
- **Adresses** : géocodage Nominatim (OpenStreetMap).

## Utilisation

- 📍 : se géolocaliser (nécessite HTTPS sur iPhone).
- Champ de recherche : taper une adresse → l'itinéraire optimisé se calcule depuis la position courante.
- Appui long (mobile) / clic droit (desktop) sur la carte : poser un départ 🚩 ou une destination 🎯 manuellement.
- 🥾 : générer une **rando** — deux types de zone : par **arrondissement** (avec compteur d'invaders restants) ou **autour d'un point** (rayon de 250 m à 2 km ; centre = départ manuel 🚩, sinon ma position, sinon le centre de la carte, cercle affiché sur la carte). Dans les deux cas : distance visée (3 à 12 km), boucle ou traverse, tournée optimisée par OSRM (service `trip`).
- 📷 : chaque invader (popup et liste d'étapes) pointe vers la recherche Instagram `#PA_<n°>` pour voir des visuels de la mosaïque.
- 👾 : couches affichées, **filtre de valeur minimale**, et bascule des **couleurs** entre deux modes mémorisés dans le navigateur :
  - *statut* — violet à flasher, orange endommagé, gris flashé, rouge détruit, noir caché ;
  - *valeur en points* — échelle chaude du jaune (10 pts) au rouge sombre cerclé d'or (100 pts) pour les cibles, vert clair pour les flashés, noir pour les détruits, gris pour les cachés.

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

### Relevés de terrain

Le « mode relevé » (⚙️, décoché par défaut) ouvre deux gestes de terrain :

- **Noter un invader absent de la base**, par appui long sur la carte : identifiant pré-rempli avec le prochain numéro parisien référencé mais non localisé, position prise sur la carte, arrondissement déduit de l'invader connu le plus proche.
- **Signaler un changement d'état**, depuis la fiche d'un invader : « Signaler détruit » le retire aussitôt des cibles et des randos ; sur un invader déjà marqué détruit ou caché, le bouton devient « Signaler présent » et le fait revenir dans les cibles.

**Ces relevés ne quittent pas le téléphone** : ils sont stockés dans le `localStorage` du navigateur et fusionnés à l'affichage. Le site étant statique, aucun visiteur ne peut écrire dans la base commune — la seule voie d'entrée est un commit dans ce dépôt. Le bouton « Copier » produit le fragment JSON à coller dans `data/overrides.json`.

`data/overrides.json` contient les observations faites sur le terrain (invader trouvé alors qu'il était marqué détruit, ou constaté détruit) ; l'import les applique en dernier, donc elles survivent aux mises à jour de MapInvaders. Une entrée peut être supprimée quand la source a rattrapé l'information.

Le panneau ⚙️ compare la base locale au décompte officiel renvoyé par l'API FlashInvaders (`cities[].si_count`), ce qui indique combien d'invaders parisiens référencés ne sont pas encore localisés par la source communautaire.

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
