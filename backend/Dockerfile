FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src

RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json drizzle.config.ts tsconfig.json tsconfig.build.json vitest.config.ts vitest.integration.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src ./src

EXPOSE 5191
CMD ["node", "dist/main.js"]
