#!/bin/sh
set -e

# Define a porta do container (usa $PORT do Render/Cloud Run ou padrão 80)
export PORT_NUMBER="${PORT:-80}"
echo "Iniciando EduHorarios na porta $PORT_NUMBER..."

# Gera a configuração do Nginx substituindo apenas $PORT_NUMBER
envsubst '$PORT_NUMBER' < /etc/nginx/templates/nginx.conf.template > /etc/nginx/http.d/default.conf

# Inicia o PHP-FPM em segundo plano
php-fpm -D

# Inicia o Nginx em primeiro plano
exec nginx -g "daemon off;"
