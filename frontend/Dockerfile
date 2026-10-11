FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV SHARDS_BACKEND_ORIGIN=http://api:5199
RUN npm run build
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production SHARDS_BACKEND_ORIGIN=http://api:5199
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
USER node
EXPOSE 5198
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "5198"]
