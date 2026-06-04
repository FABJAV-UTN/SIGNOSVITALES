# Etapa 1: Build con Node
FROM node:20-slim AS builder

WORKDIR /app
ENV CI=true

COPY package*.json ./
RUN npm ci --no-audit --no-fund --progress=false

COPY . .
RUN npm run build

# Etapa 2: Servir con Nginx
FROM nginx:alpine

# Copiar build de React
COPY --from=builder /app/dist /usr/share/nginx/html

# Copiar config de nginx
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]