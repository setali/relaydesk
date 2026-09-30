export function initSettings({ api, state, escape, toast, showLogin, refresh }) {
  const $ = (selector) => document.querySelector(selector);
  let panels = [],
    discovered = [],
    selected = [];
  const form = $('#server-form');
  function values() {
    const result = Object.fromEntries(new FormData(form));
    result.inbounds = [...$('#inbound-options').querySelectorAll('input:checked')].map((input) => {
      const row = discovered.find((i) => i.id === Number(input.value));
      const flow = $(`#flow-${row.id}`)?.value || '';
      return { id: row.id, name: row.name, flow };
    });
    return result;
  }
  function renderInbounds() {
    $('#inbound-options').innerHTML = discovered
      .map(
        (row) =>
          `<div class="inbound-option"><label><input type="checkbox" value="${row.id}" ${selected.some((i) => i.id === row.id) ? 'checked' : ''}> ${escape(row.name)} <small>${escape(row.protocol || 'approved')} · #${row.id}</small></label>${row.protocol === 'vless' || selected.some((i) => i.id === row.id && i.flow) ? `<select id="flow-${row.id}" aria-label="Flow for inbound ${row.id}"><option value="">Standard flow</option><option value="xtls-rprx-vision" ${selected.some((i) => i.id === row.id && i.flow) ? 'selected' : ''}>Vision</option></select>` : ''}</div>`,
      )
      .join('');
  }
  function open(panel) {
    form.reset();
    form.querySelector('.error').textContent = '';
    $('#probe-note').textContent = '';
    for (const field of ['id', 'name', 'baseUrl', 'subscriptionBaseUrl'])
      form.elements[field].value = panel?.[field] || '';
    form.elements.id.readOnly = !!panel;
    form.elements.token.required = !panel;
    selected = panel?.inbounds || [];
    discovered = selected.map((i) => ({ ...i, protocol: i.flow ? 'vless' : 'approved' }));
    renderInbounds();
    $('#server-dialog').showModal();
  }
  async function load() {
    $('#account-form').reset();
    $('#account-form .error').textContent = '';
    $('#account-form').elements.name.value = state.user.name;
    $('#account-form').elements.username.value = state.user.username || state.user.email;
    if (state.user.role !== 'admin') return;
    $('#https-status').textContent = 'Checking the configured public endpoint…';
    api('/https')
      .then((result) => {
        $('#https-status').textContent =
          result.status === 'valid'
            ? `Trusted certificate · expires ${new Date(result.expiresAt).toLocaleDateString()} · ${result.issuer}`
            : result.status === 'demo'
              ? 'Demo workspace — no public certificate is checked.'
              : 'HTTPS could not be verified from this server. Check DNS, certificate trust and gateway logs.';
      })
      .catch(() => {
        $('#https-status').textContent = 'Unable to check HTTPS.';
      });
    const result = await api('/panels');
    panels = result.panels;
    $('#settings-demo-note').hidden = !result.demo;
    $('#add-server').disabled = result.demo;
    $('#server-list').innerHTML = panels.length
      ? panels
          .map(
            (panel) =>
              `<article class="server-card"><strong>${escape(panel.name)}</strong><small>${escape(panel.id)} · ${panel.inbounds.length} approved inbound${panel.inbounds.length === 1 ? '' : 's'}</small><p>${escape(panel.baseUrl || 'In-memory demo adapter')}</p><span class="status">${panel.hasToken ? 'Token configured' : 'Demo'}</span>${result.demo ? '' : `<div class="actions"><button class="secondary" data-edit="${escape(panel.id)}">Edit / rotate token</button><button class="secondary" data-test="${escape(panel.id)}">Test</button><button class="secondary" data-remove="${escape(panel.id)}">Remove</button></div>`}</article>`,
          )
          .join('')
      : '<p class="form-note">No servers connected yet. Add a server to enable client creation.</p>';
  }
  $('#account-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const account = event.currentTarget,
      button = account.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(account));
      if (body.newPassword !== body.confirmPassword) throw new Error('New passwords do not match.');
      await api('/account', 'PATCH', body);
      account.reset();
      showLogin();
      toast('Account updated. Sign in with your new credentials.');
    } catch (error) {
      account.querySelector('.error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  $('#add-server').addEventListener('click', () => open());
  $('#server-dialog').addEventListener('close', () => {
    form.elements.token.value = '';
  });
  $('#probe-server').addEventListener('click', async () => {
    const button = $('#probe-server');
    button.disabled = true;
    form.querySelector('.error').textContent = '';
    try {
      if (!form.reportValidity()) return;
      selected = values().inbounds;
      const result = await api('/panels/probe', 'POST', values());
      discovered = result.inbounds;
      renderInbounds();
      $('#probe-note').textContent = `${result.inbounds.length} supported inbounds. ${result.note}`;
    } catch (error) {
      form.querySelector('.error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      await api('/panels', 'POST', values());
      $('#server-dialog').close();
      await load();
      await refresh();
      toast('Server settings saved.');
    } catch (error) {
      form.querySelector('.error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  $('#server-list').addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const panel = panels.find(
      (p) => p.id === (button.dataset.edit || button.dataset.test || button.dataset.remove),
    );
    if (button.dataset.edit) open(panel);
    if (button.dataset.remove) {
      $('#remove-server-form').dataset.id = panel.id;
      $('#remove-server-form .error').textContent = '';
      $('#remove-server-dialog').showModal();
    }
    if (button.dataset.test) {
      button.disabled = true;
      try {
        const result = await api('/panels/probe', 'POST', panel);
        toast(`Read access verified. ${result.inbounds.length} supported inbounds found.`);
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    }
  });
  $('#remove-server-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const remove = event.currentTarget,
      button = remove.querySelector('[type=submit]');
    button.disabled = true;
    try {
      await api(`/panels/${remove.dataset.id}`, 'DELETE');
      $('#remove-server-dialog').close();
      await load();
      await refresh();
      toast('Server connection removed.');
    } catch (error) {
      remove.querySelector('.error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  return { load };
}
