FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY src/ src/
COPY tsconfig.json .

FROM oven/bun:1-alpine
RUN addgroup -S carapace && adduser -S carapace -G carapace
WORKDIR /app
COPY --from=build /app .
USER carapace
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
