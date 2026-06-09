FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:embed

FROM node:22-alpine AS runtime
WORKDIR /app
ENV PORT=8080
ENV HVY_VIEWER_PUBLIC=/app/public
ENV HVY_VIEWER_SITE=/site
COPY hosted-viewer/server.mjs /app/server.mjs
COPY hosted-viewer/index.html hosted-viewer/viewer.css hosted-viewer/viewer.js /app/public/
COPY --from=build /repo/dist-embed/ /app/public/
RUN cp /app/public/assets/*.css /app/public/hvy-embed.css
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
