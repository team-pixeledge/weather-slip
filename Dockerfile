# Production image (AWS Lightsail, `prod` branch). One image, two containers:
# `web` runs the default CMD, `worker` overrides it with `npm run worker`.
# Lightsail runs x86 — build with `--platform linux/amd64` on Apple silicon.
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
# Workspace manifests and the Prisma schema first: `npm ci` needs both (the
# postinstall runs `prisma generate`), and this keeps the install layer cached.
COPY package.json package-lock.json ./
COPY extensions/weather-slip-print/package.json extensions/weather-slip-print/
COPY extensions/weather-slip-print-bulk/package.json extensions/weather-slip-print-bulk/
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx react-router build && npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/build ./build
# The worker runs from source via tsx (scripts/worker.ts → app/lib/*).
COPY --from=build /app/app ./app
COPY --from=build /app/scripts ./scripts
USER node
EXPOSE 3000
CMD ["npm", "run", "docker-start"]
