FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js iot.js access.js migrations.js devices.js ./
COPY migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "server.js"]
