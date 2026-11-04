export const API_BASE = 'https://safehouse-api.onrender.com';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_UNAVAILABLE', details, uncertain = false } = {}) {
    super(message); this.name = 'ApiError'; Object.assign(this, { status, code, details, uncertain });
  }
}

// Captures the session/property for the complete request, including refresh/retry.
// Never retries a transport failure: a financial mutation may already have committed.
export function createApiClient({ getState, saveTokens, onExpired, fetchImpl = globalThis.fetch, timeout = 45_000 }) {
  let refreshFlight = null;
  const reads = new Map();

  async function raw(path, options, tokens, propertyId) {
    if (!path.startsWith('/api/')) throw new ApiError('Invalid API path');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout ?? timeout);
    const method = options.method || 'GET';
    try {
      const response = await fetchImpl(API_BASE + path, {
        method, signal: controller.signal, credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(tokens?.accessToken ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
          ...(propertyId ? { 'X-Property-Id': propertyId } : {}) },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      if (response.ok && options.response === 'blob') return response.blob();
      let data;
      try { data = await response.json(); } catch { data = null; }
      if (!response.ok) throw new ApiError(data?.error?.message || `Request failed (${response.status})`, {
        status: response.status, code: data?.error?.code || 'REQUEST_FAILED', details: data?.error?.details,
      });
      if (data === null) throw new ApiError('The server returned an unreadable response.', { uncertain: method !== 'GET' });
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(error.name === 'AbortError' ? 'The server took too long to respond.' : 'Could not connect. Check your internet connection.', { uncertain: method !== 'GET' });
    } finally { clearTimeout(timer); }
  }

  async function request(path, options = {}) {
    const s = getState();
    const snapshot = { tokens: s.tokens, epoch: s.authEpoch, userId: s.user?.id,
      propertyId: !options.public && s.user?.role === 'OWNER' ? s.property?.id : null };
    const key = `${snapshot.epoch}:${snapshot.userId}:${snapshot.propertyId}:${path}`;
    if (!options.method && reads.has(key)) return reads.get(key);
    async function run() {
      try { return await raw(path, options, options.public ? null : snapshot.tokens, snapshot.propertyId); }
      catch (error) {
        if (error.status !== 401 || options.public) throw error;
        // A response from an earlier signed-in user must not clear the new session.
        if (getState().authEpoch !== snapshot.epoch) throw new ApiError('Session changed. Please try again.', { code: 'STALE_SESSION' });
        if (!snapshot.tokens?.refreshToken) { onExpired(); throw error; }
        if (getState().tokens?.accessToken && getState().tokens.accessToken !== snapshot.tokens.accessToken) {
          return raw(path, options, getState().tokens, snapshot.propertyId);
        }
        if (!refreshFlight || refreshFlight.epoch !== snapshot.epoch) {
          const promise = (async () => {
            const result = await raw('/api/auth/refresh', { method: 'POST', body: { refreshToken: snapshot.tokens.refreshToken } }, null, null);
            if (!result.tokens?.accessToken || !result.tokens?.refreshToken) throw new ApiError('Session expired. Sign in again.', { status: 401 });
            if (getState().authEpoch !== snapshot.epoch) throw new ApiError('Session changed.', { code: 'STALE_SESSION' });
            await saveTokens(result.tokens);
            return result.tokens;
          })();
          refreshFlight = { epoch: snapshot.epoch, promise };
          promise.finally(() => { if (refreshFlight?.promise === promise) refreshFlight = null; }).catch(() => {});
        }
        let tokens;
        try { tokens = await refreshFlight.promise; }
        catch (refreshError) {
          if (refreshError.status === 401 && getState().authEpoch === snapshot.epoch) onExpired();
          throw refreshError;
        }
        try { return await raw(path, options, tokens, snapshot.propertyId); }
        catch (retryError) {
          if (retryError.status === 401 && getState().authEpoch === snapshot.epoch) onExpired();
          throw retryError;
        }
      }
    }
    const promise = run();
    if (!options.method) reads.set(key, promise);
    try { return await promise; }
    finally { if (reads.get(key) === promise) reads.delete(key); }
  }
  return request;
}
