#
# example-image-miniapp: static SPA served by nginx, proxying /service to the
# image-service backend.
#   docker build -f example-image-miniapp/Dockerfile -t serviceconstructor-image-miniapp:latest example-image-miniapp/
#
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
