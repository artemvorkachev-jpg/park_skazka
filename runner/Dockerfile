# Бэкенд чата Баюна: runner.js (агент pi-coding-agent) + HTTP/SSE-адаптер runner/chat/server.js.
# Сборка: docker build -t park-skazka-bayun .   (из папки runner/)
FROM node:22-alpine
WORKDIR /app

# Зависимости агента (pi-coding-agent) — по lock-файлу
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Код и системный промпт Баюна
COPY runner.js system-prompt.md ./
COPY chat ./chat
COPY agent ./agent
# auth.json в репозиторий не входит (секреты) — в образе создаём пустой
RUN [ -f agent/auth.json ] || printf '{}' > agent/auth.json

ENV CHAT_PORT=8130
EXPOSE 8130

CMD ["node", "chat/server.js"]
