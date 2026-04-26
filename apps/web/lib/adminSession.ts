import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE_NAME = "gammascope_admin";

const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const CSRF_HEADER_NAME = "X-GammaScope-CSRF";

export interface AdminSession {
  issued_at: number;
  expires_at: number;
  csrf_token: string;
}

function configuredValue(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function sessionSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  return configuredValue(env.GAMMASCOPE_WEB_ADMIN_SESSION_SECRET)
    ? env.GAMMASCOPE_WEB_ADMIN_SESSION_SECRET
    : null;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isAdminSession(payload: unknown): payload is AdminSession {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<AdminSession>;
  return Number.isFinite(candidate.issued_at)
    && Number.isFinite(candidate.expires_at)
    && typeof candidate.csrf_token === "string"
    && candidate.csrf_token.length > 0;
}

export function adminLoginAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return configuredValue(env.GAMMASCOPE_WEB_ADMIN_USERNAME)
    && configuredValue(env.GAMMASCOPE_WEB_ADMIN_PASSWORD)
    && configuredValue(env.GAMMASCOPE_WEB_ADMIN_SESSION_SECRET);
}

export function verifyAdminCredentials(
  username: string,
  password: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!adminLoginAvailable(env)) {
    return false;
  }

  return secureEqual(username, env.GAMMASCOPE_WEB_ADMIN_USERNAME!)
    && secureEqual(password, env.GAMMASCOPE_WEB_ADMIN_PASSWORD!);
}

export function createAdminSessionValue(now: number = Date.now()): string {
  const secret = sessionSecret();

  if (!secret) {
    throw new Error("Admin session secret is not configured");
  }

  const issuedAt = Math.floor(now / 1000);
  const session: AdminSession = {
    issued_at: issuedAt,
    expires_at: issuedAt + SESSION_LIFETIME_SECONDS,
    csrf_token: randomBytes(32).toString("base64url")
  };
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const signature = sign(payload, secret);

  return `${payload}.${signature}`;
}

export function parseAdminSessionValue(value: string | undefined, now: number = Date.now()): AdminSession | null {
  const secret = sessionSecret();

  if (!value || !secret) {
    return null;
  }

  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) {
    return null;
  }

  if (!secureEqual(signature, sign(payload, secret))) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

    if (!isAdminSession(session) || session.expires_at <= Math.floor(now / 1000)) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

export function verifyCsrf(session: AdminSession | null, request: Request): boolean {
  const csrfHeader = request.headers.get(CSRF_HEADER_NAME);

  return Boolean(session && csrfHeader && secureEqual(csrfHeader, session.csrf_token));
}
