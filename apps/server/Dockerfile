# Production image for the AutoPrint server (API + built web app).
# Build from the repo root so it can copy apps/web/dist too:
#   docker build -f apps/server/Dockerfile -t autoprint-server .
#   docker run -p 4000:4000 --env-file apps/server/.env -v autoprint-data:/data autoprint-server
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/agent/package.json apps/agent/package.json
RUN npm install
COPY . .
RUN npm run build --workspace=apps/web

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/server ./apps/server
COPY --from=build /repo/apps/web/dist ./apps/web/dist
COPY --from=build /repo/node_modules ./node_modules
WORKDIR /app/apps/server
ENV DATABASE_URL="file:/data/autoprint.db"
ENV UPLOAD_DIR="/data/uploads"
VOLUME ["/data"]
EXPOSE 4000
CMD ["node", "src/index.js"]
