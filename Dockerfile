FROM node:24-slim

ENV NODE_ENV=production
ENV DATA_DIR=/data
WORKDIR /app

# Las dependencias primero, para aprovechar la caché de capas.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

RUN mkdir -p /data
VOLUME /data
EXPOSE 4400

CMD ["node", "src/server.js"]
