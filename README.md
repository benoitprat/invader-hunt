# Invader Hunt 👾

PWA personnelle pour chasser les mosaïques de l'artiste **Invader** : elle affiche sur une carte les invaders que je n'ai pas encore flashés, et calcule des itinéraires piétons qui en capturent un maximum sans s'écarter de plus de **200 m** du chemin direct.

## Fonctionnement

- **Mes flashs** : récupérés en direct depuis l'API FlashInvaders (`api/gallery?uid=…`), mis en cache 6 h dans le navigateur. UID modifiable dans ⚙️ Réglages.
- **Localisation des mosaïques** : dataset communautaire [goguelnikov/SpaceInvaders](https://github.com/goguelnikov/SpaceInvaders) (4142 invaders géolocalisés avec statut), nettoyé dans `data/invaders.json`.
- **Carte** : Leaflet + tuiles OpenStreetMap. Violet = à flasher, orange = à flasher mais endommagé, gris = déjà flashé, rouge = détruit/caché (masqués par défaut, et jamais proposés dans les itinéraires).
- **Itinéraires** : OSRM piéton (instance FOSSGIS `routing.openstreetmap.de`). L'app calcule le trajet direct, cherche les invaders non flashés dans un corridor de 200 m, les ordonne le long du trajet et recalcule l'itinéraire en passant par eux (max 60 étapes ; au-delà, priorité aux plus proches du chemin).
- **Adresses** : géocodage Nominatim (OpenStreetMap).

## Utilisation

- 📍 : se géolocaliser (nécessite HTTPS sur iPhone).
- Champ de recherche : taper une adresse → l'itinéraire optimisé se calcule depuis la position courante.
- Appui long (mobile) / clic droit (desktop) sur la carte : poser un départ 🚩 ou une destination 🎯 manuellement.
- 🥾 : générer une **rando par arrondissement** — choix de l'arrondissement (avec compteur d'invaders restants), distance visée (3 à 12 km), boucle ou traverse. La tournée est optimisée par OSRM (service `trip`) ; le départ est votre position si elle est proche, sinon le cœur de l'arrondissement.
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

Quand le dataset publie une nouvelle version (V06…) :

```bash
curl -sL "https://raw.githubusercontent.com/goguelnikov/SpaceInvaders/main/world_space_invaders_V06.json" -o data/world_space_invaders_V06.json
# puis relancer le script de nettoyage (voir git log / demander à Claude)
```

## Limites connues

- Le dataset V05 s'arrête à `PA_1528` : les invaders posés récemment (PA_1529+) n'apparaissent pas.
- Orléans (ORLN) absent du dataset.
- La contrainte des 200 m s'applique aux invaders choisis comme étapes ; le chemin entre deux étapes suit les rues et peut très ponctuellement déborder du corridor.

## Déploiement

Site 100 % statique : n'importe quel hébergeur fait l'affaire (GitHub Pages, Netlify…). **HTTPS obligatoire** pour la géolocalisation et le service worker sur iPhone. Ensuite : Safari → Partager → « Sur l'écran d'accueil ».
