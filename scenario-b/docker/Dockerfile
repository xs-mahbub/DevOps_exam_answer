# Stage 1: Dependencies & Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY scenario-b/app/package*.json ./
RUN npm install

# Stage 2: Minimal Production Runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# শুধুমাত্র প্রোডাকশন ডিপেনডেন্সি ইনস্টল
COPY scenario-b/app/package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# সোর্স কোড কপি
COPY scenario-b/app/ .

# নন-রুট ইউজার নির্বাচন
USER node

EXPOSE 3000

# বিল্ট-ইন হেলথচেক
HEALTHCHECK --interval=5s --timeout=3s --start-period=3s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
