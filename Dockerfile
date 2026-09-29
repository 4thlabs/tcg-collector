# Collecteur Cardmarket : lance la collecte tous les jours à COLLECT_AT (UTC).
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    COLLECT_AT=12:00 \
    GAMES=all

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Les archives et le registre vivent dans un volume, hors de l'image.
# Pas d'utilisateur dédié : un dossier monté depuis l'hôte appartient souvent à root.
VOLUME ["/app/data"]

# Node exécute directement le TypeScript (suppression des types, Node >= 22.18).
# --run-now : une collecte au démarrage ; sans risque de doublon grâce au registre des empreintes.
CMD ["node", "src/cli.ts", "schedule", "--run-now"]
