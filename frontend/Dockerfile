# Build the UI, then serve the static bundle with nginx.
#
# VITE_API_BASE is baked in at build time (Vite inlines env vars), so the image
# is tied to the backend URL it was built for - pass it as a build arg.
FROM node:22-alpine AS build

ARG VITE_API_BASE=http://localhost:8100
ENV VITE_API_BASE=$VITE_API_BASE

WORKDIR /app
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
