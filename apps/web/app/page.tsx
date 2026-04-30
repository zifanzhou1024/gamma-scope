import { cookies, headers } from "next/headers";
import { LiveDashboard } from "../components/LiveDashboard";
import { ADMIN_COOKIE_NAME, adminLoginAvailable, parseAdminSessionValue } from "../lib/adminSession";
import { loadDashboardSnapshot } from "../lib/serverSnapshotSource";

export default async function Home() {
  const snapshot = await loadDashboardSnapshot({ requestHeaders: await headers() });
  const initialAdminSession = await loadInitialAdminSession();

  return <LiveDashboard initialSnapshot={snapshot} initialAdminSession={initialAdminSession} />;
}

async function loadInitialAdminSession() {
  const isAvailable = adminLoginAvailable();
  const cookieStore = await cookies();
  const sessionValue = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  const session = parseAdminSessionValue(decodeCookieValue(sessionValue));

  return {
    authenticated: Boolean(session),
    csrfToken: session?.csrf_token ?? null,
    isAvailable
  };
}

function decodeCookieValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
