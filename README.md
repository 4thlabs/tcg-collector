# cardmarket-collector

Collecte chaque jour les fichiers publics de Cardmarket pour tous les jeux :

| Fichier | Contenu | Taille (Magic) |
|---|---|---|
| `price_guide_N.json` | prix du jour (low, trend, avg1/7/30, versions foil) | 26 Mo |
| `products_singles_N.json` | catalogue des cartes à l'unité | 20 Mo |
| `products_nonsingles_N.json` | catalogue des autres produits (boosters, boîtes…) | 1 Mo |

`N` est l'identifiant du jeu chez Cardmarket (1 = Magic, 21 = Star Wars Unlimited). Au 2026-09-29, 22 jeux publient des fichiers (1 à 25, sauf 4 et 14) : 165 Mo au total, 17 Mo une fois compressés.

## Ce qui est archivé

Pour chaque fichier, à chaque collecte :

1. **Requête HEAD** : si l'ETag est le même que la dernière fois, le fichier n'a pas été régénéré. Rien n'est téléchargé.
2. Sinon, téléchargement et **empreinte SHA-256 du contenu sans le champ `createdAt`** (Cardmarket le change à chaque régénération, même quand aucune donnée ne bouge).
3. Si l'empreinte est identique à la dernière archive, rien n'est écrit. Sinon, le fichier brut est archivé en gzip.

Les catalogues ne sont donc archivés que lorsqu'ils changent vraiment. Estimation de stockage : moins de 7 Go par an pour tous les jeux.

```
data/
  ledger.json                             dernière version vue de chaque fichier (ETag, empreinte, dates)
  archive/<type>/<jeu>/<AAAA-MM-JJ>.json.gz
```

Pour lire une archive : `gunzip -c data/archive/price_guide/21/2026-09-29.json.gz | jq .`

## Utilisation

Node 22.18 ou plus récent (exécute directement le TypeScript).

```
npm install
node src/cli.ts games                  # jeux disponibles et taille des fichiers
node src/cli.ts collect                # une collecte, tous les jeux
node src/cli.ts collect --games 1,21   # seulement Magic et Star Wars Unlimited
node src/cli.ts schedule --at 12:00    # collecte chaque jour à 12:00 UTC, sans s'arrêter
node src/cli.ts --help
```

Options communes : `--data-dir` (défaut `data`), `--base-url`. Variables d'environnement équivalentes : `DATA_DIR`, `CARDMARKET_BASE_URL`, `GAMES`, `COLLECT_AT`.

L'heure par défaut, 12:00 UTC, vient des heures de publication observées le 2026-09-29 : Price Guide vers 01:00 UTC, catalogues vers 11:30 UTC.

## Docker

```
docker compose up -d --build
docker compose logs -f
```

Le conteneur collecte au démarrage puis chaque jour à `COLLECT_AT` (UTC), et redémarre tout seul. Les archives sont dans `./data` sur l'hôte. Relancer le conteneur ne crée pas de doublon : le registre saute les fichiers déjà archivés.

## Code

```
src/cli.ts                         point d'entrée Commander
src/app.ts                         assemblage des dépendances
src/commands/                      une classe par commande (collect, schedule, games)
src/cardmarket/feed-file.ts        types de fichiers et chemins sur le serveur
src/cardmarket/cardmarket-client.ts  HEAD / GET avec nouvelles tentatives
src/storage/content-fingerprint.ts   empreinte sans createdAt
src/storage/fingerprint-ledger.ts    registre JSON (écriture atomique)
src/storage/snapshot-archive.ts      archives gzip
src/collect/collector.ts           logique de collecte et de déduplication
src/collect/daily-scheduler.ts     exécution quotidienne à heure fixe
```

Tests : `npm test`. Vérification des types : `npm run typecheck`.
