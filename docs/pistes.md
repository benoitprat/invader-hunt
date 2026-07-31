# Pistes explorées

Idées étudiées, avec leur issue et le raisonnement. L'objectif est de ne pas refaire deux fois le même arbitrage — et de savoir à quelles conditions rouvrir un dossier.

---

## En attente d'une décision

### Export d'une rando vers maps.me / Organic Maps

**Idée** : un bouton d'export dans le panneau d'itinéraire produisant un fichier GPX — le tracé de la rando et chaque invader en point de passage nommé, avec identifiant et points. Envoi vers l'app de cartographie hors ligne via le menu de partage iOS.

**Intérêt** : répond d'un coup à trois manques — le hors ligne réel, un calcul d'itinéraire piéton fait sur l'appareil, et une navigation pas à pas que l'app n'a pas. L'utilisateur se sert déjà de maps.me pour ses randonnées personnelles.

**Faisabilité** : bien délimitée, sans dépendance nouvelle — génération d'un fichier texte à partir de l'itinéraire déjà calculé. Organic Maps importe GPX, KML, KMZ et GeoJSON en ouvrant le fichier depuis le menu de partage ([documentation](https://organicmaps.app/faq/bookmarks/how-to-import/)). maps.me utilise historiquement le KML pour ses favoris ; générer les deux formats lève le doute.

**État** : proposé, non tranché.

---

## Écarté

### Page d'aide à la récupération de l'UID

**Idée** : une page annexe expliquant comment capturer son UID FlashInvaders, avec vérification de l'identifiant contre l'API et lien d'installation en un tap.

**Écartée** parce que la partie « capture » revenait à recommander des analyseurs réseau tiers non audités, qui exigent l'installation d'un certificat racine — donc l'accès au trafic chiffré de tout le téléphone. On ne recommande pas cela à la légère.

**Contexte utile si le sujet revient** : l'UID n'est jamais affiché par FlashInvaders, l'obtenir suppose forcément d'observer l'application. Les seules méthodes connues sont mitmproxy (multi-plateforme, libre) et `adb logcat -d | grep api.space-invaders` sur Android. Aucune source consultée n'en propose de plus simple. À noter que l'UID est un identifiant porteur : quiconque l'obtient peut lire la galerie du joueur.

### Système de comptes propre à l'application

**Idée** : remplacer l'import par UID par notre propre suivi des invaders flashés, pour ouvrir l'app à des utilisateurs qui ne savent pas récupérer leur identifiant.

**Analyse** : l'UID n'apporte qu'une seule chose, la liste des invaders déjà flashés. Un marquage local (bouton « flashé » stocké dans le navigateur, fusionné avec l'ensemble `flashed` existant) suffirait techniquement et supprimerait tout l'obstacle. Le compromis est qu'aucune synchronisation avec l'app officielle n'est possible dans un sens ni dans l'autre : il faudrait marquer deux fois.

Un vrai backend avec comptes a été écarté sans hésitation : serveur à payer et maintenir, authentification à sécuriser, et surtout il créerait l'exposition que l'architecture statique évite aujourd'hui.

**Décision** : ne rien changer, l'app reste réservée à ceux qui savent récupérer leur UID. La piste du marquage local reste ouverte si l'app doit un jour être partagée.

### Randos optimisées par points plutôt que par proximité

**Idée** : au lieu d'enchaîner les invaders les plus proches, privilégier le meilleur rapport points / distance parcourue.

**Écartée pour l'instant** : les invaders à 40 points et plus représentent 22 % des cibles parisiennes mais 41 % des points, l'intérêt serait donc réel. Non retenue au profit du filtre d'affichage, plus simple et déjà suffisant à l'usage.

### Boussole pour orienter la carte

**Écartée** au profit de la rotation manuelle, pour préserver la batterie : un capteur d'orientation actif en continu coûte cher, alors que la rotation manuelle n'est que du calcul d'affichage. La boussole aurait aussi souffert de l'imprécision magnétique entre les immeubles.

---

## À rouvrir sous conditions

### Migration vers MapLibre GL et tuiles vectorielles

**Condition de réouverture** : que les noms de rues renversés en rotation gênent réellement à l'usage. C'est le seul défaut concret que la migration corrigerait.

**Gains attendus** : libellés restant droits, rotation et inclinaison natives, suppression de deux bricolages (le greffon de rotation figé depuis 2023 et le report du redessin des marqueurs), et surtout la possibilité d'un hors ligne complet — un fichier de tuiles vectorielles peut être servi depuis un hébergement statique.

**Coûts** : réécriture de toute la couche carte (marqueurs, fiches, tracés, cercles), passage d'environ 57 Ko à 250 Ko de bibliothèque, nécessité d'une source vectorielle (fournisseur avec clé ou fichier auto-hébergé), et **effet inconnu sur la batterie** — un rendu graphique continu peut coûter plus qu'une image statique. À mesurer sur le téléphone avant de décider, pas à supposer.

### Changement de fournisseur de tuiles

Nous consommons les tuiles du serveur communautaire d'OpenStreetMap, dont la politique d'usage vise les projets à faible trafic. À l'échelle de quelques utilisateurs c'est légitime ; une diffusion plus large imposerait un fournisseur dédié — ce qui serait aussi le moment naturel pour passer au vectoriel.

### Sécurité des itinéraires piétons

Le moteur ignore les horaires de fermeture des parcs, la présence de trottoirs et le caractère passant d'une rue (détail dans [choix-techniques.md](choix-techniques.md)). Améliorations envisageables, par ordre de coût : avertir quand un itinéraire traverse un parc après la tombée du jour ; signaler les segments longeant de grands axes en interrogeant Overpass à partir des identifiants de nœuds renvoyés par OSRM ; ou changer de moteur pour un profil favorisant les voies calmes.

---

## Réalisé, pour mémoire

- **Contribution en retour** : une [V06 du jeu de données goguelnikov](https://github.com/goguelnikov/SpaceInvaders/pull/6) a été proposée — 121 ajouts, 191 statuts mis à jour, 90 corrections de coordonnées, toutes les entrées d'origine préservées. En attente de relecture du mainteneur.
- **Relevés de terrain** : les huit derniers invaders parisiens non localisés ont été relevés puis versés dans `data/overrides.json`, complétant la base à 1597 sur 1597. Les positions pourraient être proposées en retour à MapInvaders et au dépôt goguelnikov, qui ne les ont pas.
