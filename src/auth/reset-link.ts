import type { RequestAppId } from '../common/app-id.js';

function cleanBaseUrl(url: string | undefined): string | null {
  const trimmed = url?.trim().replace(/\/$/, '');
  return trimmed ? trimmed : null;
}

export function resolveResetPasswordBaseUrl(appId: RequestAppId): string {
  const dashboardUrl =
    cleanBaseUrl(process.env.DASHBOARD_APP_URL) ||
    cleanBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    'http://localhost:3000';

  const appUrls: Record<RequestAppId, string> = {
    dashboard: dashboardUrl,
    unknown: dashboardUrl,
  };

  return appUrls[appId];
}

export function buildResetPasswordUrl(params: {
  appId: RequestAppId;
  token: string;
}): string {
  const url = new URL(
    '/reset-password',
    resolveResetPasswordBaseUrl(params.appId),
  );
  url.searchParams.set('token', params.token);
  return url.toString();
}
