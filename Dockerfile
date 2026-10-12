# SwamiJet: app + API server in one image. Build from the repo root.
FROM node:22-alpine
ENV NODE_ENV=production APP_DIR=/app PORT=8080
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev && npm cache clean --force
COPY server/src server/src
COPY server/db server/db
COPY server/scripts server/scripts
COPY index.html sw.js manifest.json version.json icon-192.png icon-512.png icon-maskable-512.png ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server/src/server.js"]
