# Multi-stage build for the frontend
# Stage 1: build the Vite app
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY tsconfig*.json ./
COPY vite.config.ts ./
COPY postcss.config.js ./
COPY tailwind.config.js ./
COPY index.html ./
COPY public ./public
COPY src ./src
# Accept Vite-related build args, so the API URLs can be embedded at build-time
ARG VITE_PROD_BACKEND_HOST=localhost
ARG VITE_PROD_BACKEND_PORT=8000
ARG VITE_PROD_BACKEND_URL=
ARG VITE_PROD_BACKEND_WS=

# Install deps, write a .env.production for Vite using the build args, then build
RUN npm ci \
	&& echo "VITE_PROD_BACKEND_HOST=${VITE_PROD_BACKEND_HOST}" > .env.production \
	&& echo "VITE_PROD_BACKEND_PORT=${VITE_PROD_BACKEND_PORT}" >> .env.production \
	&& if [ -n "${VITE_PROD_BACKEND_URL}" ]; then echo "VITE_PROD_BACKEND_URL=${VITE_PROD_BACKEND_URL}" >> .env.production; fi \
	&& if [ -n "${VITE_PROD_BACKEND_WS}" ]; then echo "VITE_PROD_BACKEND_WS=${VITE_PROD_BACKEND_WS}" >> .env.production; fi \
	&& npm run build

# Stage 2: serve with nginx
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Copy the runtime entrypoint script which will generate runtime-config.js inside the served HTML dir
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
# Remove default nginx conf and add a simple one to allow SPA routing
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
