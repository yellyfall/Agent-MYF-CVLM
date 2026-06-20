FROM php:8.2-cli

WORKDIR /app

COPY . .

EXPOSE 10000

CMD ["bash", "start.sh"]
