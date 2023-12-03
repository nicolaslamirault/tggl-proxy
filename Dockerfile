FROM node:18.15-alpine
WORKDIR /usr/src/app
COPY package.json .
COPY package-lock.json .
RUN npm ci
COPY tsconfig.json .
COPY src/ src
RUN npm run build
EXPOSE 3000
CMD [ "node", "lib/server.js"]
