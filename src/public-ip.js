import { isIP } from 'node:net';
import { managedDomain } from './https-status.js';

export function publicIPv4(value) {
  if (typeof value !== 'string' || isIP(value.trim()) !== 4) return '';
  const ip = value.trim();
  try {
    managedDomain(`https://${ip}`);
    return ip;
  } catch {
    return '';
  }
}

// Only used by the interactive setup command, never by the running application.
export async function detectPublicIPv4(fetcher = fetch) {
  try {
    const response = await fetcher('https://api.ipify.org', {
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok || !response.body) return '';
    const reader = response.body.getReader();
    let value = '';
    try {
      for (;;) {
        const { done, value: bytes } = await reader.read();
        if (done) break;
        if (value.length + bytes.length > 64) return '';
        value += new TextDecoder().decode(bytes);
      }
      return publicIPv4(value);
    } finally {
      await reader.cancel();
    }
  } catch {
    return '';
  }
}
