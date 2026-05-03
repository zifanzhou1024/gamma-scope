FROM node:22-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/contracts packages/contracts

ARG NEXT_PUBLIC_GAMMASCOPE_WS_URL=http://127.0.0.1:8000
ENV NEXT_PUBLIC_GAMMASCOPE_WS_URL=$NEXT_PUBLIC_GAMMASCOPE_WS_URL

RUN pnpm --filter @gammascope/web build

EXPOSE 3000

CMD ["pnpm", "--filter", "@gammascope/web", "exec", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
