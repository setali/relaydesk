import { HttpError } from './security.js';
const GiB = 1024 ** 3;

// Adapter contract: the 3x-ui v2 inbound-scoped API. v3 is deliberately not inferred.
export class ThreeXUI {
  constructor(panel) {
    this.panel = panel;
  }
  async request(path, data) {
    const url = `${this.panel.baseUrl.replace(/\/$/, '')}/panel/api/inbounds${path}`;
    const response = await fetch(url, {
      method: data ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${this.panel.token}`,
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (!response.ok)
      throw new HttpError(502, 'Panel request failed. Check connectivity and credentials.');
    const body = await response.json();
    if (body.success !== true)
      throw new HttpError(502, 'Panel rejected the request. Check the configured API version.');
    return body.obj;
  }
  async snapshot() {
    const rows = await this.request('/list');
    if (!Array.isArray(rows))
      throw new HttpError(502, 'Unsupported panel response. Expected an inbound list.');
    return rows
      .filter((row) => !this.panel.inbounds || this.panel.inbounds.some((i) => i.id === row.id))
      .map((row) => {
        const settings = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
        if (!Array.isArray(settings?.clients))
          throw new HttpError(502, 'Unsupported inbound settings.');
        if (row.clientStats != null && !Array.isArray(row.clientStats))
          throw new HttpError(502, 'Unsupported traffic response.');
        return {
          id: row.id,
          protocol: row.protocol,
          clients: settings.clients,
          traffic: row.clientStats || [],
        };
      });
  }
  async discover() {
    const rows = await this.request('/list');
    if (!Array.isArray(rows))
      throw new HttpError(502, 'Unsupported panel API. Expected the v2 inbound list.');
    const ids = new Set();
    for (const row of rows) {
      if (!Number.isSafeInteger(row?.id) || row.id < 1 || ids.has(row.id))
        throw new HttpError(502, 'Unsupported inbound identifier.');
      ids.add(row.id);
    }
    return rows
      .filter((row) => ['vless', 'vmess'].includes(row.protocol))
      .map((row) => {
        const settings = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
        if (!Array.isArray(settings?.clients))
          throw new HttpError(502, 'Unsupported inbound schema.');
        return {
          id: row.id,
          name: String(row.remark || `Inbound ${row.id}`).slice(0, 80),
          protocol: row.protocol,
        };
      });
  }
  payload(client) {
    return {
      id: client.uuid,
      email: client.remote_email,
      enable: !!client.enabled,
      totalGB: client.quota_gb * GiB,
      expiryTime: client.expires_at,
      subId: client.sub_id,
      limitIp: 0,
      tgId: '',
      reset: 0,
      flow: this.panel.inbounds?.find((i) => i.id === client.inbound_id)?.flow || '',
    };
  }
  async create(client) {
    const rows = await this.snapshot();
    const inbound = rows.find((r) => r.id === client.inbound_id);
    if (!inbound || !['vless', 'vmess'].includes(inbound.protocol))
      throw new HttpError(502, 'This release supports VLESS and VMess inbounds only.');
    return this.request('/addClient', {
      id: client.inbound_id,
      settings: JSON.stringify({ clients: [this.payload(client)] }),
    });
  }
  async remove(client) {
    return this.request(`/${client.inbound_id}/delClient/${encodeURIComponent(client.uuid)}`, {});
  }
}
export class DemoPanel {
  constructor() {
    this.clients = new Map();
  }
  async create(client) {
    this.clients.set(client.uuid, { ...client });
  }
  async remove(client) {
    this.clients.delete(client.uuid);
  }
  async snapshot() {
    return [1, 2].map((id) => ({
      id,
      protocol: 'vless',
      clients: [...this.clients.values()]
        .filter((c) => c.inbound_id === id)
        .map((c) => ({ id: c.uuid, email: c.remote_email })),
      traffic: [...this.clients.values()]
        .filter((c) => c.inbound_id === id)
        .map((c) => ({
          email: c.remote_email,
          up: c.up || 0,
          down: c.down || 0,
          enable: !!c.enabled,
        })),
    }));
  }
}
