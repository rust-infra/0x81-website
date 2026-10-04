export const GOOGLE_CLOUD_STT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CLOUD_STT_DEFAULT_LOCATION = 'us-central1';
export const GOOGLE_CLOUD_STT_DEFAULT_MODEL = 'chirp_3';

export interface GoogleServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

export interface GoogleCloudSttInput {
  audioBase64: string;
  mimeType: string;
  languageCode: string;
}

export interface GoogleCloudSttOptions {
  serviceAccountJson: string;
  projectId?: string;
  location?: string;
  model?: string;
  recognizer?: string;
}

export interface GoogleCloudTranscriptionResult {
  text: string;
  confidence?: number;
  provider: 'google-cloud';
  model: string;
}

export interface GoogleCloudSttDeps {
  fetchImpl?: typeof fetch;
  signJwt?: (
    header: string,
    payload: string,
    privateKey: string
  ) => string | Promise<string>;
  now?: () => number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export function parseGoogleServiceAccount(raw: string): GoogleServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Google service account must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Google service account must be an object');
  }
  const data = parsed as Record<string, unknown>;
  const projectId = String(data.project_id || '').trim();
  const privateKey = String(data.private_key || '').replace(/\\n/g, '\n').trim();
  const clientEmail = String(data.client_email || '').trim();
  const tokenUri = String(data.token_uri || GOOGLE_CLOUD_STT_TOKEN_URI).trim();
  if (!projectId || !privateKey || !clientEmail) {
    throw new Error('Google service account is missing project_id, private_key, or client_email');
  }
  return {
    project_id: projectId,
    private_key: privateKey,
    client_email: clientEmail,
    token_uri: tokenUri || GOOGLE_CLOUD_STT_TOKEN_URI,
  };
}

async function defaultSignJwt(
  header: string,
  payload: string,
  privateKey: string
): Promise<string> {
  const { KJUR } = (await import('jsrsasign')) as {
    KJUR: {
      jws: {
        JWS: {
          sign: (
            algorithm: string,
            header: string,
            payload: string,
            key: string
          ) => string;
        };
      };
    };
  };
  return KJUR.jws.JWS.sign('RS256', header, payload, privateKey);
}

function serviceAccountClaims(account: GoogleServiceAccount, nowSeconds: number): string {
  return JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: account.token_uri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  });
}

export function buildGoogleCloudSttRequest(input: GoogleCloudSttInput, model: string) {
  return {
    config: {
      autoDecodingConfig: {},
      languageCodes: [input.languageCode || 'en-US'],
      model,
      features: {
        enableAutomaticPunctuation: true,
      },
    },
    content: input.audioBase64,
  };
}

export function parseGoogleCloudSttResponse(
  payload: unknown
): { text: string; confidence?: number } | null {
  if (!payload || typeof payload !== 'object') return null;
  const results = (payload as Record<string, unknown>).results;
  if (!Array.isArray(results)) return null;
  const parts: string[] = [];
  let confidence: number | undefined;
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const alternatives = (result as Record<string, unknown>).alternatives;
    if (!Array.isArray(alternatives)) continue;
    const first = alternatives[0];
    if (!first || typeof first !== 'object') continue;
    const transcript = (first as Record<string, unknown>).transcript;
    if (typeof transcript === 'string' && transcript.trim()) parts.push(transcript.trim());
    const value = (first as Record<string, unknown>).confidence;
    if (typeof value === 'number') confidence = value;
  }
  const text = parts.join(' ').replace(/\s+([,.!?])/g, '$1').trim();
  return text ? { text, confidence } : null;
}

async function accessTokenForServiceAccount(
  account: GoogleServiceAccount,
  fetchImpl: typeof fetch,
  signJwt: (
    header: string,
    payload: string,
    privateKey: string
  ) => string | Promise<string>,
  now: () => number
): Promise<string> {
  const nowMs = now();
  const cacheKey = `${account.client_email}:${account.token_uri}:${account.private_key.slice(-32)}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs + 60_000) return cached.accessToken;

  const header = JSON.stringify({ alg: 'RS256', typ: 'JWT' });
  const claims = serviceAccountClaims(account, Math.floor(nowMs / 1000));
  const assertion = await signJwt(header, claims, account.private_key);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const response = await fetchImpl(account.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error(`Google OAuth failed (${response.status})`);
  }
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
  tokenCache.set(cacheKey, {
    accessToken: payload.access_token,
    expiresAt: nowMs + expiresIn * 1000,
  });
  return payload.access_token;
}

export async function transcribeWithGoogleCloud(
  input: GoogleCloudSttInput,
  options: GoogleCloudSttOptions,
  deps: GoogleCloudSttDeps = {}
): Promise<GoogleCloudTranscriptionResult> {
  const account = parseGoogleServiceAccount(options.serviceAccountJson);
  const projectId = options.projectId?.trim() || account.project_id;
  const location = options.location?.trim() || GOOGLE_CLOUD_STT_DEFAULT_LOCATION;
  const model = options.model?.trim() || GOOGLE_CLOUD_STT_DEFAULT_MODEL;
  const recognizer = options.recognizer?.trim() || '_';
  const fetchImpl = deps.fetchImpl ?? fetch;
  const signJwt = deps.signJwt ?? defaultSignJwt;
  const accessToken = await accessTokenForServiceAccount(
    account,
    fetchImpl,
    signJwt,
    deps.now ?? Date.now
  );
  const endpoint =
    `https://speech.googleapis.com/v2/projects/${encodeURIComponent(projectId)}` +
    `/locations/${encodeURIComponent(location)}/recognizers/${encodeURIComponent(recognizer)}:recognize`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(buildGoogleCloudSttRequest(input, model)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google Cloud STT failed (${response.status})`);
  }
  const parsed = parseGoogleCloudSttResponse(payload);
  if (!parsed) throw new Error('Google Cloud STT returned no transcript');
  return { ...parsed, provider: 'google-cloud', model };
}
