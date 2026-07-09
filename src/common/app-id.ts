export const APP_ID_HEADER = 'x-evd-app-id';

export const EVD_APP_IDS = ['dashboard'] as const;

export type EvdAppId = (typeof EVD_APP_IDS)[number];
export type RequestAppId = EvdAppId | 'unknown';

interface AppIdRequest {
  get(name: string): string | undefined;
}

export function getRequestAppId(request: AppIdRequest): RequestAppId {
  const appId = request.get(APP_ID_HEADER)?.trim();
  return isEvdAppId(appId) ? appId : 'unknown';
}

export function getRequestAppIdFromHeaders(
  headers: Headers | undefined | null,
): RequestAppId {
  if (!headers?.get(APP_ID_HEADER)) return 'unknown';
  return getRequestAppId({
    get: (name) => headers.get(name) ?? undefined,
  });
}

function isEvdAppId(appId: string | undefined): appId is EvdAppId {
  return EVD_APP_IDS.includes(appId as EvdAppId);
}
