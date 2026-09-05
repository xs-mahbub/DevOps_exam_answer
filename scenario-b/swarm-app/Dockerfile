FROM node:18-alpine
WORKDIR /app
COPY server.js .
HEALTHCHECK --interval=3s --timeout=2s --retries=2 --start-period=2s \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/healthz || exit 1
EXPOSE 3000
CMD ["node", "server.js"]
COPY nonexistent-file-xyz /app/
