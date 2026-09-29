#!/bin/sh
# Runs once, right after the InfluxDB setup, before any point is written.
# One point per product per day: with the default weekly shards, every shard repeats the ~1M series keys
# (about 200 MB each for Magic + Star Wars Unlimited). Yearly shards store them once a year: ~10x less disk.
set -e
bucket_id=$(influx bucket list --name "${DOCKER_INFLUXDB_INIT_BUCKET}" --hide-headers | cut -f1)
influx bucket update --id "${bucket_id}" --retention 0 --shard-group-duration 52w
