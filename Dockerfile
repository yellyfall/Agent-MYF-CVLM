# Backend uniquement : aucun build du frontend sur Hetzner.
FROM node:24.15.0-bookworm-slim
ENV NODE_ENV=production API_ONLY=true
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node server.js ./
COPY --chown=node:node src ./src
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["npm","start"]
