# Cardmarket collector: runs the collection every day at COLLECT_AT (UTC). The same image serves the card page (command serve).
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    COLLECT_AT=12:00 \
    GAMES=all

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY web ./web

# Archives and the ledger live in a volume, outside the image.
# No dedicated user: a folder mounted from the host is often owned by root.
VOLUME ["/app/data"]

# Port of the card page (command serve); the default schedule command opens none.
EXPOSE 8080

# Node runs TypeScript directly (type stripping, Node >= 22.18).
# --run-now: one collection on start; no risk of duplicates thanks to the fingerprint ledger.
CMD ["node", "src/cli.ts", "schedule", "--run-now"]
