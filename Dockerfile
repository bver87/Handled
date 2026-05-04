FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_FILE=/data/handled.json

COPY package.json server.js ./
COPY public ./public

RUN mkdir -p /data

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "server.js"]
