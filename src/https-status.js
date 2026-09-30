import { connect } from 'node:tls';
import { isIP } from 'node:net';

export function managedDomain(origin) {
  const url = new URL(origin);
  const host = url.hostname;
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    isIP(host) ||
    host.length > 253 ||
    !host.includes('.') ||
    host.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
    /\.(local|localhost|internal|test|invalid|example)$|\.home\.arpa$|\.ts\.net$/i.test(host)
  ) {
    throw new Error(
      'Managed HTTPS needs a public DNS hostname on port 443, matching the configured HTTPS origin.',
    );
  }
  return host;
}

// No browser-supplied destinations; only the operator-configured public origin.
export function inspectCertificate(origin, connector = connect) {
  const url = new URL(origin);
  if (url.protocol !== 'https:') return Promise.resolve({ status: 'disabled', origin });
  return new Promise((resolve) => {
    let done = false;
    let socket;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      socket?.destroy();
      resolve({ origin, checkedAt: Date.now(), ...result });
    };
    const deadline = setTimeout(() => finish({ status: 'unavailable' }), 5000);
    try {
      socket = connector({
        host: url.hostname,
        port: Number(url.port || 443),
        servername: isIP(url.hostname) ? undefined : url.hostname,
        rejectUnauthorized: true,
      });
      socket.once('error', () => finish({ status: 'unavailable' }));
      socket.once('secureConnect', () => {
        const cert = socket.getPeerCertificate();
        const expires = Date.parse(cert.valid_to);
        if (!socket.authorized || !Number.isFinite(expires))
          return finish({ status: 'unavailable' });
        finish({
          status: 'valid',
          expiresAt: expires,
          issuer: cert.issuer?.O || cert.issuer?.CN || 'Unknown',
        });
      });
    } catch {
      finish({ status: 'unavailable' });
    }
  });
}

export function certificateStatus(origin, demo, inspect = inspectCertificate) {
  let cached,
    pending,
    until = 0;
  return async () => {
    if (demo) return { status: 'demo', origin };
    if (cached && Date.now() < until) return cached;
    if (!pending)
      pending = inspect(origin)
        .then((result) => {
          cached = result;
          until = Date.now() + 60000;
          return result;
        })
        .finally(() => {
          pending = null;
        });
    return pending;
  };
}
