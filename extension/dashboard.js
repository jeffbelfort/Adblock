// dashboard.js - External script for dashboard.html

const API = 'http://localhost:9001/api';

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toast(msg, error = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (error ? ' error' : '');
  setTimeout(() => t.className = 'toast', 2500);
}

// ── Navigation ─────────────────────────────────────
function showPage(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  if (el) el.classList.add('active');
  if (id === 'logs') fetchLogs();
  if (id === 'filters') fetchFilterLists();
  if (id === 'whitelist') fetchWhitelist();
  if (id === 'custom') loadCustomFilters();
  if (id === 'settings') loadSettings();
}

// Wire up nav items
document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', () => showPage(item.dataset.page, item));
});

// Check hash on load
function checkHash() {
  const hash = location.hash.slice(1);
  if (hash) {
    const navItem = document.querySelector(`.nav-item[data-page="${hash}"]`);
    if (navItem) showPage(hash, navItem);
  }
}

// ── Overview ───────────────────────────────────────
async function fetchOverview() {
  chrome.runtime.sendMessage({ type: 'GET_STATS' }, (stats) => {
    if (stats) {
      document.getElementById('stat-today').textContent = (stats.today || 0).toLocaleString();
      document.getElementById('stat-total').textContent = (stats.total || 0).toLocaleString();
    }
  });

  chrome.runtime.sendMessage({ type: 'GET_FILTER_LISTS' }, (lists) => {
    document.getElementById('stat-lists').textContent = (lists || []).length;
  });

  chrome.declarativeNetRequest.getDynamicRules((rules) => {
    document.getElementById('stat-rules').textContent = (rules || []).length.toLocaleString();
  });

  try {
    const r = await fetch(API + '/status', { signal: AbortSignal.timeout(2000) });
    const d = await r.json();
    const running = d.dns_running;
    document.getElementById('dns-dot').className = 'dot' + (running ? '' : ' red');
    document.getElementById('dns-label').textContent = 'DNS: ' + (running ? 'running' : 'stopped');
    const badge = document.getElementById('dns-badge');
    if (badge) { badge.textContent = running ? 'active' : 'stopped'; badge.className = 'badge ' + (running ? 'green' : 'red'); }
    const statusText = document.getElementById('dns-status-text');
    if (statusText) statusText.textContent = running ? 'Running on 127.0.0.1:53' : 'Stopped';
  } catch {
    document.getElementById('dns-dot').className = 'dot red';
    document.getElementById('dns-label').textContent = 'DNS: unavailable';
  }
}

async function dnsAction(action) {
  try {
    const r = await fetch(API + '/dns/' + action, { method: 'POST' });
    const d = await r.json();
    if (d.ok) { toast('DNS ' + action + 'ed'); fetchOverview(); }
    else toast('Failed: ' + d.error, true);
  } catch { toast('Dashboard API not reachable', true); }
}

const btnDnsStart = document.getElementById('btn-dns-start');
const btnDnsStop = document.getElementById('btn-dns-stop');
if (btnDnsStart) btnDnsStart.addEventListener('click', () => dnsAction('start'));
if (btnDnsStop) btnDnsStop.addEventListener('click', () => dnsAction('stop'));

// ── Filter lists ───────────────────────────────────
async function fetchFilterLists() {
  chrome.runtime.sendMessage({ type: 'GET_FILTER_LISTS' }, (lists) => {
    const el = document.getElementById('filter-list-items');
    if (!el) return;
    if (!lists || !lists.length) {
      el.innerHTML = '<div class="log-empty">No filter lists subscribed yet.</div>';
      return;
    }
    el.innerHTML = lists.map(l => `
      <div class="filter-list-item">
        <div class="filter-list-info">
          <div class="filter-list-name">${esc(l.name)}</div>
          <div class="filter-list-meta">${esc(l.url)} · Last synced: ${l.lastSync ? new Date(l.lastSync).toLocaleString() : 'never'}</div>
        </div>
        <div class="filter-list-count">${(l.networkCount || 0).toLocaleString()} rules · ${(l.cosmeticCount || 0).toLocaleString()} cosmetic</div>
        <div class="filter-list-actions">
          <button class="btn sm" data-sync-id="${esc(l.id)}">Sync</button>
          <button class="btn sm danger" data-remove-id="${esc(l.id)}">Remove</button>
        </div>
      </div>`).join('');

    // Wire sync/remove buttons
    el.querySelectorAll('[data-sync-id]').forEach(btn => {
      btn.addEventListener('click', () => syncList(btn.dataset.syncId));
    });
    el.querySelectorAll('[data-remove-id]').forEach(btn => {
      btn.addEventListener('click', () => removeList(btn.dataset.removeId));
    });
  });
}

async function addFilterList() {
  const input = document.getElementById('filter-url-input');
  const url = input.value.trim();
  if (!url) return;
  toast('Subscribing...');
  chrome.runtime.sendMessage({ type: 'SYNC_FILTER_LIST', url }, (result) => {
    if (result && result.ok) {
      toast(`Added: ${result.meta.name} (${result.meta.networkCount} rules)`);
      input.value = '';
      fetchFilterLists();
      fetchOverview();
    } else {
      toast('Failed: ' + (result && result.error), true);
    }
  });
}

function addPreset(url) {
  const input = document.getElementById('filter-url-input');
  if (input) { input.value = url; addFilterList(); }
}

function syncList(id) {
  chrome.runtime.sendMessage({ type: 'GET_FILTER_LISTS' }, (lists) => {
    const list = (lists || []).find(l => l.id === id);
    if (!list) return;
    toast('Syncing...');
    chrome.runtime.sendMessage({ type: 'SYNC_FILTER_LIST', url: list.url, id }, (result) => {
      if (result && result.ok) { toast('Synced: ' + result.meta.name); fetchFilterLists(); }
      else toast('Sync failed: ' + (result && result.error), true);
    });
  });
}

function removeList(id) {
  chrome.runtime.sendMessage({ type: 'REMOVE_FILTER_LIST', id }, () => {
    toast('Removed'); fetchFilterLists(); fetchOverview();
  });
}

const btnAddFilter = document.getElementById('btn-add-filter');
if (btnAddFilter) btnAddFilter.addEventListener('click', addFilterList);

// Preset buttons
document.querySelectorAll('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => addPreset(btn.dataset.preset));
});

// ── Custom filters ─────────────────────────────────
function loadCustomFilters() {
  chrome.runtime.sendMessage({ type: 'GET_CUSTOM_FILTERS' }, (text) => {
    const el = document.getElementById('custom-filter-editor');
    if (el) el.value = text || '';
  });
}

function saveCustomFilters() {
  const el = document.getElementById('custom-filter-editor');
  if (!el) return;
  chrome.runtime.sendMessage({ type: 'SAVE_CUSTOM_FILTERS', text: el.value }, (result) => {
    if (result && result.ok) toast('Filters applied');
    else toast('Failed to apply filters', true);
  });
}

const btnRevert = document.getElementById('btn-revert');
const btnSaveFilters = document.getElementById('btn-save-filters');
if (btnRevert) btnRevert.addEventListener('click', loadCustomFilters);
if (btnSaveFilters) btnSaveFilters.addEventListener('click', saveCustomFilters);

// ── Logs ───────────────────────────────────────────
async function fetchLogs() {
  const el = document.getElementById('log-list');
  if (!el) return;
  try {
    const r = await fetch(API + '/dns/logs', { signal: AbortSignal.timeout(3000) });
    const logs = await r.json();
    if (!logs.length) { el.innerHTML = '<div class="log-empty">No blocks recorded yet</div>'; return; }
    el.innerHTML = [...logs].reverse().map(l => `
      <div class="log-item">
        <span class="log-domain">${esc(l.domain)}</span>
        <span class="log-source">DNS</span>
        <span class="log-time">${esc(l.time)}</span>
      </div>`).join('');
  } catch {
    el.innerHTML = '<div class="log-empty">Dashboard API not reachable</div>';
  }
}

const btnRefreshLogs = document.getElementById('btn-refresh-logs');
if (btnRefreshLogs) btnRefreshLogs.addEventListener('click', fetchLogs);

// ── Whitelist ──────────────────────────────────────
function fetchWhitelist() {
  chrome.runtime.sendMessage({ type: 'GET_WHITELIST' }, (whitelist) => {
    const el = document.getElementById('whitelist-items');
    if (!el) return;
    if (!whitelist || !whitelist.length) {
      el.innerHTML = '<div class="log-empty">No sites whitelisted</div>';
      return;
    }
    el.innerHTML = whitelist.map(domain => `
      <div class="whitelist-item">
        <span class="whitelist-domain">${esc(domain)}</span>
        <button class="btn sm danger" data-remove-domain="${esc(domain)}">Remove</button>
      </div>`).join('');

    el.querySelectorAll('[data-remove-domain]').forEach(btn => {
      btn.addEventListener('click', () => removeWhitelist(btn.dataset.removeDomain));
    });
  });
}

async function addWhitelist() {
  const input = document.getElementById('whitelist-input');
  if (!input) return;
  const domain = input.value.trim().replace(/^https?:\/\//, '').split('/')[0];
  if (!domain) return;
  const { whitelist = [] } = await chrome.storage.local.get('whitelist');
  if (!whitelist.includes(domain)) { whitelist.push(domain); await chrome.storage.local.set({ whitelist }); }
  input.value = '';
  fetchWhitelist();
  toast(domain + ' whitelisted');
}

async function removeWhitelist(domain) {
  const { whitelist = [] } = await chrome.storage.local.get('whitelist');
  await chrome.storage.local.set({ whitelist: whitelist.filter(d => d !== domain) });
  fetchWhitelist();
  toast(domain + ' removed');
}

const btnAddWhitelist = document.getElementById('btn-add-whitelist');
if (btnAddWhitelist) btnAddWhitelist.addEventListener('click', addWhitelist);

// ── Settings ───────────────────────────────────────
async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const defaults = { requests: true, cosmetic: true, youtube: true, itvx: true, soundcloud: true, autosync: true };
  const merged = { ...defaults, ...settings };
  for (const [key, val] of Object.entries(merged)) {
    const el = document.getElementById('setting-' + key);
    if (el) el.className = 'toggle' + (val !== false ? ' on' : '');
  }
}

async function toggleSetting(key, el) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const defaults = { requests: true, cosmetic: true, youtube: true, itvx: true, soundcloud: true, autosync: true };
  const current = key in settings ? settings[key] : defaults[key];
  settings[key] = !current;
  el.className = 'toggle' + (settings[key] ? ' on' : '');
  await chrome.storage.local.set({ settings });
  toast('Setting saved');
}

document.querySelectorAll('[data-setting]').forEach(el => {
  el.addEventListener('click', () => toggleSetting(el.dataset.setting, el));
});

async function syncAllNow() {
  toast('Syncing all lists...');
  const { filterLists = [] } = await chrome.storage.local.get('filterLists');
  let done = 0;
  for (const list of filterLists.filter(l => l.enabled !== false)) {
    await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'SYNC_FILTER_LIST', url: list.url, id: list.id }, () => { done++; resolve(); });
    });
  }
  toast(`Synced ${done} list${done !== 1 ? 's' : ''}`);
  fetchFilterLists();
}

const btnSyncAll = document.getElementById('btn-sync-all');
if (btnSyncAll) btnSyncAll.addEventListener('click', syncAllNow);

// ── Init ───────────────────────────────────────────
fetchOverview();
setInterval(fetchOverview, 10000);
checkHash();
