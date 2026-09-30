import { initSettings } from './settings.js';
const $ = (selector) => document.querySelector(selector);
const state = {
  user: null,
  csrf: null,
  view: 'overview',
  clients: [],
  users: [],
  templates: [],
  events: [],
  demo: false,
};
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const gib = (bytes) => (bytes / 1024 ** 3).toLocaleString('en', { maximumFractionDigits: 1 });
const number = (n) => n.toLocaleString('en', { maximumFractionDigits: 1 });
const date = (value) =>
  new Date(value).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
let toastTimer;
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 6500);
}
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.csrf ? { 'X-CSRF-Token': state.csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') showLogin();
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}
function showLogin() {
  state.user = null;
  state.csrf = null;
  state.clients = [];
  state.users = [];
  state.events = [];
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  $('#client-rows').replaceChildren();
  $('#reseller-cards').replaceChildren();
  $('#activity-list').replaceChildren();
  $('#workspace').hidden = true;
  $('#login').hidden = false;
}
async function enter(session) {
  Object.assign(state, session);
  await refresh();
  $('#login').hidden = true;
  $('#workspace').hidden = false;
  $('#profile-name').textContent = state.user.name;
  $('#profile-role').textContent = state.user.role === 'admin' ? 'Workspace owner' : 'Team member';
  $('#avatar').textContent = state.user.name.slice(0, 1).toUpperCase();
  $('#demo-badge').hidden = !state.demo;
  $('#mode-label').textContent = state.demo ? 'Demo · sample data' : 'Workspace ready';
  document
    .querySelectorAll('.admin-only')
    .forEach((el) => (el.hidden = state.user.role !== 'admin'));
  $('#today').textContent = date(Date.now());
  changeView('overview');
}
async function refresh() {
  Object.assign(state, await api('/workspace'));
  render();
}
function status(client) {
  if (client.status !== 'active')
    return [client.status === 'review' ? 'Needs review' : 'Pending', 'review'];
  if (client.expires_at <= Date.now()) return ['Expired', 'expired'];
  if (client.up + client.down >= client.quota_gb * 1024 ** 3) return ['Quota used', 'depleted'];
  if (!client.enabled) return ['Disabled', 'depleted'];
  return ['Enabled', 'active'];
}
function render() {
  const clients = state.clients,
    used = clients.reduce((sum, c) => sum + c.up + c.down, 0),
    quota = clients.reduce((sum, c) => sum + c.quota_gb, 0);
  const up = clients.reduce((sum, c) => sum + c.up, 0),
    down = used - up;
  const percent = quota ? Math.min(100, (used / (quota * 1024 ** 3)) * 100) : 0;
  $('#stat-clients').textContent = clients.length;
  $('#stat-active').textContent =
    `${clients.filter((c) => status(c)[1] === 'active').length} enabled · ${clients.filter((c) => c.status === 'review').length} need review`;
  $('#stat-usage').innerHTML = `${gib(used)} <em>GiB</em>`;
  $('#stat-quota').innerHTML = `${number(quota)} <em>GiB</em>`;
  $('#stat-expiring').textContent = clients.filter(
    (c) => c.expires_at > Date.now() && c.expires_at < Date.now() + 7 * 86400000,
  ).length;
  $('#usage-percent').textContent = `${percent.toFixed(1)}%`;
  $('#download-value').textContent = `${gib(down)} GiB`;
  $('#upload-value').textContent = `${gib(up)} GiB`;
  $('#usage-bar').innerHTML = Array.from(
    { length: 48 },
    (_, i) =>
      `<span class="segment ${i < Math.round((percent / 100) * 48) ? (i < Math.round((((down / Math.max(1, used)) * percent) / 100) * 48) ? 'used' : 'up') : ''}"></span>`,
  ).join('');
  const synced = clients.filter((c) => c.synced_at);
  $('#usage-freshness').textContent =
    clients.length && synced.length === clients.length
      ? `Oldest sync: ${new Date(Math.min(...synced.map((c) => c.synced_at))).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}`
      : 'Some clients are awaiting usage data';
  $('#nav-count').textContent = clients.length;
  $('#table-count').textContent = clients.length;
  $('#new-client').disabled = !state.templates.length;
  $('#new-client').title = state.templates.length
    ? ''
    : 'Configure an approved panel template first.';
  renderClients();
  renderResellers();
  renderActivity();
}
function renderClients() {
  const search = $('#search').value.toLowerCase();
  const clients = state.clients.filter((c) =>
    `${c.name} ${state.users.find((u) => u.id === c.owner_id)?.name || ''}`
      .toLowerCase()
      .includes(search),
  );
  $('#empty-clients').hidden = clients.length > 0;
  $('#client-rows').innerHTML = clients
    .map((c) => {
      const [label, kind] = status(c),
        used = c.up + c.down,
        owner = state.users.find((u) => u.id === c.owner_id);
      return `<tr><td><div class="client-cell"><span class="client-avatar">${escape(c.name.slice(0, 1).toUpperCase())}</span><div><strong>${escape(c.name)}</strong><small>${escape(owner?.name || 'Account')}</small></div></div></td><td><span class="template-label">${escape(c.template)}</span></td><td><div class="usage-label">${gib(used)} <span>/ ${number(c.quota_gb)} GiB</span></div><progress class="mini-progress" max="100" value="${Math.min(100, (used / (c.quota_gb * 1024 ** 3)) * 100)}" aria-label="${escape(c.name)} traffic allowance"></progress></td><td>${date(c.expires_at)}</td><td><span class="status ${kind}">${label}</span></td><td><div class="row-actions">${c.subscriptionUrl ? `<button data-copy="${escape(c.id)}" aria-label="Copy subscription for ${escape(c.name)}">Copy link</button>` : ''}<button data-delete="${escape(c.id)}" aria-label="Remove ${escape(c.name)}">Remove</button></div></td></tr>`;
    })
    .join('');
  $('#table-summary').textContent =
    `${clients.length} connection${clients.length === 1 ? '' : 's'}`;
}
function renderResellers() {
  const resellers = state.users.filter((u) => u.role === 'reseller');
  $('#reseller-cards').innerHTML = resellers.length
    ? resellers
        .map((u) => {
          const clients = state.clients.filter((c) => c.owner_id === u.id);
          return `<article class="reseller-card"><span class="avatar">${escape(u.name.slice(0, 1).toUpperCase())}</span><h2>${escape(u.name)}</h2><p>${escape(u.email)}</p><dl><dt>Client slots</dt><dd>${clients.length} / ${number(u.max_clients)}</dd><dt>Allocated</dt><dd>${number(clients.reduce((s, c) => s + c.quota_gb, 0))} / ${number(u.quota_gb)} GiB</dd><dt>Recorded usage</dt><dd>${gib(clients.reduce((s, c) => s + c.up + c.down, 0))} GiB</dd></dl></article>`;
        })
        .join('')
    : '<div class="empty"><strong>A place for your first team member.</strong><p>Create an account with its own client slots and allocation budget.</p></div>';
}
function renderActivity() {
  const labels = {
    'client.created': 'Created a client',
    'client.deleted': 'Removed a client',
    'client.needs_review': 'Client operation needs review',
    'reseller.created': 'Created a member account',
    'session.created': 'Signed in',
    'usage.synced': 'Requested a usage sync',
  };
  $('#activity-list').innerHTML =
    state.events
      .map(
        (e) =>
          `<div class="activity-row"><div><strong>${escape(labels[e.action] || e.action)}</strong><small>${escape(e.actor)}</small></div><time datetime="${new Date(e.created_at).toISOString()}">${date(e.created_at)} · ${new Date(e.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</time></div>`,
      )
      .join('') || '<div class="empty">Your workspace activity will appear here.</div>';
}
const settings = initSettings({ api, state, escape, toast, showLogin, refresh });
function changeView(view) {
  if (view === 'resellers' && state.user?.role !== 'admin') return;
  state.view = view;
  const copy = {
    overview: [
      'THE BIG PICTURE',
      'A little clarity. A lot of control.',
      'Your connections and the people behind them, all in one place.',
    ],
    clients: [
      'YOUR CONNECTIONS',
      'Every connection has a home.',
      'Create and manage clients within the limits of each account.',
    ],
    resellers: [
      'YOUR PEOPLE',
      'Give your people room to grow.',
      'Independent accounts with their own clients and allocation budgets.',
    ],
    activity: [
      'THE PAPER TRAIL',
      'Know what happened.',
      'A record of the changes made in your workspace.',
    ],
    settings: [
      'WORKSPACE SETTINGS',
      'Everything in its place.',
      'Manage your login and the servers behind your connections.',
    ],
  }[view];
  $('#breadcrumb').textContent = view[0].toUpperCase() + view.slice(1);
  [
    $('#page-eyebrow').textContent,
    $('#page-title').textContent,
    $('#page-description').textContent,
  ] = copy;
  $('#overview-panel').hidden = view !== 'overview';
  $('#clients-panel').hidden = !['overview', 'clients'].includes(view);
  $('#resellers-panel').hidden = view !== 'resellers';
  $('#activity-panel').hidden = view !== 'activity';
  $('#settings-panel').hidden = view !== 'settings';
  if (view === 'settings') settings.load().catch((error) => toast(error.message));
  document
    .querySelectorAll('[data-view]')
    .forEach((el) => el.classList.toggle('active', el.dataset.view === view));
}
document
  .querySelectorAll('[data-view]')
  .forEach((el) => el.addEventListener('click', () => changeView(el.dataset.view)));
$('#reseller-shortcut').addEventListener('click', () => changeView('resellers'));
$('#search').addEventListener('input', renderClients);
document
  .querySelectorAll('.close')
  .forEach((el) => el.addEventListener('click', () => el.closest('dialog').close()));
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    button = form.querySelector('button');
  button.disabled = true;
  $('#login-error').textContent = '';
  try {
    await enter(await api('/login', 'POST', Object.fromEntries(new FormData(form))));
    form.reset();
  } catch (error) {
    $('#login-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
async function logout() {
  try {
    await api('/logout', 'POST', {});
    showLogin();
  } catch (error) {
    toast(error.message);
  }
}
$('#logout').addEventListener('click', logout);
$('#logout-mobile').addEventListener('click', logout);
$('#sync').addEventListener('click', async () => {
  const button = $('#sync');
  button.disabled = true;
  try {
    const { results } = await api('/sync', 'POST', {});
    await refresh();
    toast(
      results.some((r) => !r.ok)
        ? 'Some panels could not be reached. Previous usage is preserved.'
        : state.demo
          ? 'Sample usage refreshed. This is a demo workspace.'
          : 'Usage refreshed from your panels.',
    );
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
$('#new-client').addEventListener('click', () => {
  const form = $('#client-form');
  form.reset();
  form.querySelector('.error').textContent = '';
  form.dataset.requestId = crypto.randomUUID();
  $('#owner-options').innerHTML = state.users
    .map((u) => `<option value="${escape(u.id)}">${escape(u.name)}</option>`)
    .join('');
  $('#template-options').innerHTML = state.templates
    .map((t, i) => `<option value="${i}">${escape(t.name)}</option>`)
    .join('');
  $('#client-dialog').showModal();
});
$('#new-reseller').addEventListener('click', () => {
  $('#reseller-form').reset();
  $('#reseller-form .error').textContent = '';
  $('#reseller-dialog').showModal();
});
$('#client-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    button = form.querySelector('[type=submit]');
  button.disabled = true;
  const values = Object.fromEntries(new FormData(form)),
    template = state.templates[Number(values.template)];
  try {
    const result = await api('/clients', 'POST', {
      name: values.name,
      ownerId: values.ownerId,
      quotaGB: Number(values.quotaGB),
      days: Number(values.days),
      panelId: template.panelId,
      inboundId: template.inboundId,
      requestId: form.dataset.requestId,
    });
    $('#client-dialog').close();
    await refresh();
    toast(
      result.client.status === 'active'
        ? 'Client created. You’re connected.'
        : 'This request is already recorded. Sync to review its state.',
    );
  } catch (error) {
    form.querySelector('.error').textContent = error.message;
    await refresh().catch(() => {});
  } finally {
    button.disabled = false;
  }
});
$('#reseller-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    button = form.querySelector('[type=submit]');
  button.disabled = true;
  const values = Object.fromEntries(new FormData(form));
  try {
    await api('/resellers', 'POST', {
      ...values,
      maxClients: Number(values.maxClients),
      quotaGB: Number(values.quotaGB),
    });
    form.reset();
    $('#reseller-dialog').close();
    await refresh();
    toast('Member workspace created.');
  } catch (error) {
    form.querySelector('.error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$('#client-rows').addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.copy) {
    const client = state.clients.find((c) => c.id === button.dataset.copy);
    try {
      await navigator.clipboard.writeText(client.subscriptionUrl);
      toast('Subscription link copied. Treat it as a password.');
    } catch {
      toast('Clipboard unavailable. Use an HTTPS connection.');
    }
  }
  if (button.dataset.delete) {
    $('#delete-form').dataset.id = button.dataset.delete;
    $('#delete-form .error').textContent = '';
    $('#delete-dialog').showModal();
  }
});
$('#delete-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    button = form.querySelector('[type=submit]');
  button.disabled = true;
  try {
    await api(`/clients/${form.dataset.id}`, 'DELETE');
    $('#delete-dialog').close();
    await refresh();
    toast('Client removed. Allocation released.');
  } catch (error) {
    form.querySelector('.error').textContent = error.message;
    await refresh().catch(() => {});
  } finally {
    button.disabled = false;
  }
});
try {
  await enter(await api('/me'));
} catch (error) {
  showLogin();
  if (error.message !== 'Sign in to continue.') $('#login-error').textContent = error.message;
}
