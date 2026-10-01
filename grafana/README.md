# Grafana dashboard

`card.json`: prices of one card. Pick the game, type part of the card name in **Search**, then pick the card in **Card** (name · date added to Cardmarket, newest first, 200 at most). The dashboard shows the card image, the latest prices and the daily prices; days without an archived price guide repeat the previous value. Foil prices are hidden when Cardmarket gives 0.

Images come from [Scryfall](https://scryfall.com/docs/api/cards/cardmarket), which finds Magic cards by Cardmarket idProduct. Other games have no image yet.

## Import

1. Add an **InfluxDB** datasource with query language **SQL**: URL `http://<host>:8181`, database `cardmarket`, token `TCG_COLLECTOR_INFLUX_TOKEN` (from `.env`), and **Insecure Connection** enabled (InfluxDB 3 Core of the compose file has no TLS).
2. Dashboards > New > Import, upload `card.json`, and pick that datasource for "Cardmarket".

Tested with Grafana 13.2.
