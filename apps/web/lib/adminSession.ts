import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE_NAME = "gammascope_admin";
export const CSRF_HEADER_NAME = "X-GammaScope-CSRF";

const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const MIN_SESSION_SECRET_LENGTH = 32;
const MAX_FAILED_LOGIN_ATTEMPTS = 3;
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;

type AdminRequestFailureReason = "unavailable" | "unauthenticated" | "invalid_csrf";

export interface AdminSession {
  issued_at: number;
  expires_at: number;
  csrf_token: string;
}

export interface AdminRequestVerification {
  ok: boolean;
  reason: AdminRequestFailureReason | null;
  session: AdminSession | null;
}

interface LoginAttemptState {
  failures: number;
  locked_until: number;
}

const loginAttempts = new Map<string, LoginAttemptState>();

function configuredValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function configuredSessionSecret(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length >= MIN_SESSION_SECRET_LENGTH;
}

function sessionSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  return configuredSessionSecret(env.GAMMASCOPE_WEB_ADMIN_SESSION_SECRET)
    ? env.GAMMASCOPE_WEB_ADMIN_SESSION_SECRET.trim()
    : null;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function digestCredential(value: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function secureBufferEqual(left: Buffer, right: Buffer): boolean {
  return timingSafeEqual(left, right);
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
    && configuredSessionSecret(env.GAMMASCOPE_WEB_ADMIN_SESSION_SECRET);
}

export function verifyAdminCredentials(
  username: string,
  password: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!adminLoginAvailable(env)) {
    return false;
  }

  const secret = sessionSecret(env)!;
  const usernameMatches = secureBufferEqual(
    digestCredential(username, secret),
    digestCredential(env.GAMMASCOPE_WEB_ADMIN_USERNAME!, secret)
  );
  const passwordMatches = secureBufferEqual(
    digestCredential(password, secret),
    digestCredential(env.GAMMASCOPE_WEB_ADMIN_PASSWORD!, secret)
  );

  return usernameMatches && passwordMatches;
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

export function parseAdminSessionFromRequest(request: Request, now?: number): AdminSession | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [cookieName, ...valueParts] = cookie.trim().split("=");
    if (cookieName === ADMIN_COOKIE_NAME) {
      try {
        return parseAdminSessionValue(decodeURIComponent(valueParts.join("=")), now);
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function verifyCsrf(session: AdminSession | null, request: Request): boolean {
  const csrfHeader = request.headers.get(CSRF_HEADER_NAME);

  return Boolean(session && csrfHeader && secureEqual(csrfHeader, session.csrf_token));
}

export function verifyAdminRequest(
  request: Request,
  options: { csrf?: boolean; now?: number } = {}
): AdminRequestVerification {
  if (!adminLoginAvailable()) {
    return {
      ok: false,
      reason: "unavailable",
      session: null
    };
  }

  const session = parseAdminSessionFromRequest(request, options.now);
  if (!session) {
    return {
      ok: false,
      reason: "unauthenticated",
      session: null
    };
  }

  if (options.csrf && !verifyCsrf(session, request)) {
    return {
      ok: false,
      reason: "invalid_csrf",
      session
    };
  }

  return {
    ok: true,
    reason: null,
    session
  };
}

export function adminLoginAttemptAllowed(key: string, now: number = Date.now()): boolean {
  const attempt = loginAttempts.get(key);

  return !attempt || attempt.locked_until <= now;
}

export function recordAdminLoginFailure(key: string, now: number = Date.now()): void {
  const attempt = loginAttempts.get(key) ?? { failures: 0, locked_until: 0 };
  const failures = attempt.failures + 1;
  loginAttempts.set(key, {
    failures,
    locked_until: failures >= MAX_FAILED_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : attempt.locked_until
  });
}

export function recordAdminLoginSuccess(key: string): void {
  loginAttempts.delete(key);
}

export function resetAdminLoginAttempts(): void {
  loginAttempts.clear();
}
