# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Làng Nghề Số contributors
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY *.js ./
COPY migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "server.js"]
