/**
 * Shared API key extraction and Express auth middleware.
 */

/**
 * Extract API key from request headers.
 * Checks x-api-key, x-latticespark-api-key, and Authorization: Bearer.
 *
 * @param {import('express').Request} req
 * @returns {string} The API key, or empty string if not found
 */
export function getApiKey(req) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice('Bearer '.length)
    : null;
  return req.headers['x-api-key'] || req.headers['x-latticespark-api-key'] || bearer || '';
}

/**
 * Create Express middleware that requires a matching API key.
 * When apiKey is falsy (dev mode), all requests pass through.
 *
 * @param {string} apiKey - Expected API key
 * @returns {import('express').RequestHandler}
 */
export function requireApiKey(apiKey) {
  return (req, res, next) => {
    if (!apiKey) return next();
    if (getApiKey(req) === apiKey) return next();
    res.status(401).json({ error: 'unauthorized' });
  };
}

/**
 * Create Express middleware that requires an admin token.
 * Falls back to apiKey if adminToken is not set.
 *
 * @param {string} adminToken - Expected admin token
 * @param {string} apiKey - Fallback API key
 * @returns {import('express').RequestHandler}
 */
export function requireAdminToken(adminToken, apiKey) {
  return (req, res, next) => {
    if (!adminToken) return next();
    const token = req.headers['x-admin-token']
      || req.headers['x-latticespark-admin']
      || getApiKey(req);
    if (token === adminToken) return next();
    res.status(403).json({ error: 'admin token required' });
  };
}

/**
 * Build auth headers object for outbound requests.
 *
 * @param {string} apiKey
 * @returns {Object} Headers object with X-API-Key, or empty object if no key
 */
export function authHeaders(apiKey) {
  return apiKey ? { 'X-API-Key': apiKey } : {};
}
