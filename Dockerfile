FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:embed
RUN node hosted-viewer/prepare-hosted-viewer-public.mjs /repo/hosted-public /repo/dist-embed

FROM node:22-alpine AS runtime
WORKDIR /app
ENV PORT=8080
ENV HVY_VIEWER_PUBLIC=/app/public
ENV HVY_VIEWER_SITE=/site
COPY hosted-viewer/server.mjs /app/server.mjs
COPY --from=build /repo/hosted-public/ /app/public/
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
