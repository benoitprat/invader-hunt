# Choix techniques

Décisions structurantes du projet et raisons qui les motivent. À lire avant de proposer un changement d'architecture : plusieurs de ces choix ont été pesés contre des alternatives explicites, documentées dans [pistes.md](pistes.md).

---

## Application web statique, sans serveur

L'app est une PWA entièrement statique hébergée sur GitHub Pages. Aucun serveur applicatif, aucune base de données, aucune route d'écriture.

**Conséquence de sécurité, volontaire** : aucun visiteur ne peut modifier quoi que ce soit. Le JavaScript ne fait que des lectures vers trois API externes (FlashInvaders, OSRM, Nominatim). La seule voie d'entrée dans les données communes est un commit dans ce dépôt, protégé par le compte GitHub. C'est cette propriété qui rend inutile tout contrôle d'accès côté client.

Corollaire : toute fonctionnalité de contribution est nécessairement locale au navigateur (voir les relevés de terrain) ou passe par un commit.

## Discipline de build et de cache

`tools/bump_build.py` estampille un numéro de build dans `version.js` **et** dans le nom du cache du service worker.

**À lancer avant chaque commit destiné au déploiement.** Sans ce changement de nom de cache, les PWA déjà installées continuent de servir indéfiniment l'ancienne version. Le numéro est affiché dans ⚙️ pour vérifier depuis le téléphone quelle version tourne réellement. Sur iOS, la bascule se fait au deuxième lancement suivant le déploiement.

---

## Cartographie : Leaflet

Leaflet 1.9.4, tuiles raster d'OpenStreetMap, marqueurs rendus sur canvas.

Poids mesuré (compressé) : Leaflet 42 Ko, greffon de rotation 15 Ko, code applicatif 12 Ko, base des invaders 60 Ko.

### Pourquoi pas une bibliothèque vectorielle

La ligne de partage n'est pas la bibliothèque mais le type de tuiles. Une tuile raster est une image où les noms de rues sont déjà peints ; une tuile vectorielle contient les données et laisse le rendu au processeur graphique.

| Solution | Nature | Points forts | Limites |
|---|---|---|---|
| **Leaflet** (retenu) | Raster | Léger, API simple, écosystème de greffons, marche partout | Pas de rotation ni d'inclinaison native, pas de vectoriel |
| MapLibre GL | Vectoriel, WebGL | Rotation et inclinaison natives, libellés restant droits, style modifiable en direct, libre | ~250 Ko, exige une source vectorielle, consommation graphique à valider |
| OpenLayers | Raster + vectoriel | Le plus complet (projections, formats SIG), rotation native | API verbeuse, surdimensionné ici |
| Mapbox GL | Vectoriel | Très abouti | Propriétaire depuis la v2, compte et facturation |
| Google Maps | Raster + vectoriel | Données de lieux inégalées | Clé et facturation, mise en cache hors ligne interdite par les conditions |
| Apple MapKit JS | Vectoriel | Esthétique iOS, palier gratuit | Compte développeur Apple, jetons signés |

**Décision** : rester sur Leaflet tant que le seul défaut concret constaté (voir ci-dessous) ne gêne pas à l'usage. Le rapport poids / fonctions couvertes reste très favorable.

### Rotation de la carte

Ajoutée via le greffon `leaflet-rotate` 0.2.8 (dernière version publiée en juillet 2023), embarqué localement comme le reste.

- Rotation **manuelle à deux doigts uniquement**. La boussole du plugin est explicitement désactivée (`compassBearing: false`) : un capteur actif en permanence coûte de la batterie, ce qui est un critère du projet.
- **Défaut assumé** : les tuiles étant des images, les noms de rues tournent avec la carte et deviennent illisibles au-delà d'environ 120°. Seul le vectoriel corrigerait cela.
- **Correctif de fluidité** : le calque canvas vit à l'intérieur du pane qui pivote, il suit donc la rotation par la même transformation graphique. Le redessiner à chaque événement de rotation faisait décrocher les marqueurs, car ils étaient repeints par JavaScript pendant que la carte était transformée par le compositeur — deux pipelines qui ne peuvent pas rester synchronisés. Le redessin est donc différé de 150 ms après le dernier mouvement, et la marge du canvas portée à 0.5 pour couvrir les coins que la rotation amène dans le champ.

Vérifié : les pastilles numérotées des étapes restent droites quel que soit l'angle, et l'orientation survit à la génération d'une rando.

---

## Itinéraires : OSRM, profil piéton

Instance publique FOSSGIS (`routing.openstreetmap.de/routed-foot`), service `route` pour les trajets et `trip` pour les tournées optimisées.

### Ce que le profil garantit

Vérifié sur le terrain de test : le profil piéton emprunte un chemin différent de celui du profil voiture sur le périphérique, il n'envoie donc pas sur les voies rapides, et il respecte les interdictions d'accès piéton présentes dans OpenStreetMap. Chaque segment renvoyé est marqué `mode: walking`.

### Ce qu'il ignore — limites connues

- **Aucune notion de l'heure** : un itinéraire traversera le jardin du Luxembourg ou les Buttes-Chaumont de nuit, grilles fermées. C'est le piège le plus concret pour une balade en soirée.
- **Pas de trottoirs** : à Paris les rues sont modélisées par leur axe. Le moteur ignore de quel côté marcher et la qualité des traversées.
- Ne distingue pas un boulevard bruyant d'une ruelle calme, ignore l'éclairage, ne signale pas les escaliers.
- Optimise le trajet le plus court, jamais le plus sûr ni le plus agréable.

Les métadonnées disponibles par étape se limitent au nom de la voie, au mode et aux manœuvres. Obtenir les attributs OpenStreetMap (revêtement, type de voie, horaires) supposerait une requête Overpass supplémentaire à partir des identifiants de nœuds renvoyés dans `annotation.nodes`.

### Contrainte des 200 m

Le corridor est calculé par projection des invaders sur la géométrie du trajet direct. La contrainte s'applique aux invaders retenus comme étapes ; le chemin entre deux étapes suit les rues et peut ponctuellement déborder. Au-delà de 60 points de passage, priorité aux plus proches du trajet.

### Ajout manuel d'une étape

L'itinéraire affiché est conservé en mémoire (`currentTrip` : départ, étapes, boucle ou non, arrivée imposée éventuelle) pour qu'on puisse y ajouter une cible et relancer le calcul. L'ajout passe systématiquement par le service `trip`, y compris en mode « Y aller » qui utilise `route` au premier calcul : c'est le seul service qui réordonne les points, et un invader ajouté depuis le panneau n'a aucune raison de se trouver au bon rang dans la liste existante.

Ce qui est laissé libre et ce qui ne l'est pas :

| Contexte | Départ | Arrivée | Milieu |
|---|---|---|---|
| Rando en boucle | `source=first` | retour au départ (`roundtrip=true`) | réordonné |
| Rando en traverse | `source=first` | `destination=last` — dernière étape courante, préservée en insérant les ajouts avant elle | réordonné |
| « Y aller » | `source=first` | `destination=last` — la destination choisie | réordonné |

Contrainte volontairement levée : la **distance visée** n'est plus opposable après coup. Elle sert à composer la rando initiale ; un ajout manuel est une décision explicite, la refuser au nom du budget serait absurde. Le dépassement est simplement rappelé dans le résumé. Le plafond de 60 étapes, lui, reste opposable — c'est une limite du moteur, pas une préférence.

Un échec de routage laisse l'itinéraire précédent intact : l'étape n'est retenue que si le recalcul aboutit.

---

## Données

### Sources

| Donnée | Source | Remarque |
|---|---|---|
| Invaders flashés | API FlashInvaders (`gallery?uid=`) | Nécessite l'UID du joueur, mis en cache 6 h |
| Décompte officiel par ville | Même réponse, `cities[].si_count` | Sert à mesurer la couverture de la base |
| Positions | [MapInvaders](https://chborel.ch/mapinvaders/) | Plus à jour que le dépôt goguelnikov utilisé au départ |
| Points | Jeux invader-spotter | Le second jeu, plus complet, comble les manquants |
| Arrondissements | opendata.paris.fr | Précalculés dans le champ `arr` |

### Priorité et reproductibilité

L'import (`tools/import_mapinvaders.py`) est rejouable et applique les sources dans cet ordre, du moins au plus prioritaire : positions MapInvaders, points invader-spotter, puis **observations de terrain** (`data/overrides.json`).

Les observations de terrain sont donc appliquées en dernier et **survivent aux rafraîchissements de source**. Une entrée peut corriger un invader existant (statut, position, points) ou en **créer un** que la source ne localise pas encore, si elle porte `lat` et `lng`. Un point laissé à 0 est complété depuis les sources quand elles le connaissent.

À élaguer au fil du temps : quand MapInvaders rattrape une information, l'entrée correspondante devient inutile.

### État

Paris est complet : 1597 invaders sur 1597 référencés, les huit derniers ayant été relevés sur le terrain le 30 juillet 2026. À l'échelle mondiale, 4343 localisés sur 4411 référencés.

### Validation d'une source avant adoption

Méthode appliquée lors de l'ajout du second jeu invader-spotter, à reprendre pour toute nouvelle source : croiser les valeurs déjà connues et mesurer le taux d'accord avant d'intégrer. En l'occurrence 4147 accords contre 7 écarts, et 28 concordances sur 28 avec l'API officielle. La source n'a été utilisée qu'**en comblement**, jamais en écrasement d'une valeur existante.

---

## Hors ligne

Le service worker met en cache l'app, la base des invaders et les tuiles déjà consultées (2500 au maximum, purge des plus anciennes).

**Limite structurelle** : le calcul d'itinéraire et le géocodage exigent le réseau. Préparer la balade en wifi met la zone en cache, mais une rando ne peut pas être générée hors ligne. Un vrai hors ligne supposerait des tuiles vectorielles embarquées et un routage sur l'appareil — voir [pistes.md](pistes.md).

---

## Interface

- **Deux modes de couleur**, mémorisés par navigateur : par statut (violet à flasher, orange endommagé, gris flashé, rouge détruit, noir caché) ou par valeur (échelle chaude du jaune au rouge sombre cerclé d'or, flashés en vert clair, détruits en noir, cachés en gris).
  Le mode valeur a été retenu après maquette sur la carte réelle : un dégradé du clair au foncé rendait les cibles à 10 et 20 points confondables avec le gris des flashés. La réattribution des couleurs de statut supprime le conflit à la racine.
- **Filtre de valeur minimale** : agit sur l'affichage seulement, pas sur la génération des randos — un réglage d'affichage ne doit pas modifier discrètement un comportement.
- **Panneaux** : tout panneau se ferme par son bouton dédié, par son icône, ou par un appui sur la carte. Sur iOS, le focus laissé sur un `<select>` après le sélecteur natif fait avaler l'appui suivant : il est explicitement relâché au changement.
