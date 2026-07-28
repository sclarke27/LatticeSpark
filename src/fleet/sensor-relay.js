/**
 * POST JSON to the sensor-service relay API with an abort timeout.
 * timeoutMs must stay below the spoke's 10s socket ack timeout
 * (spoke-agent-service flushQueue) so the hub fails first and spoke
 * retries do not stack on a still-pending relay request.
 */
export async function postJsonToSensorService(baseUrl, path, body, { apiKey = '', timeoutMs = 8000 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Sensor service error ${response.status}: ${text}`);
    }
    // `return await` (not bare return) so a body-read abort is translated by
    // the catch below and the timer covers body streaming, not just headers.
    return await response.json();
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Sensor service timeout after ${timeoutMs}ms (POST ${path})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
