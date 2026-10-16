// dashboard.js - Extension dashboard UI
const API = 'http://localhost:9001/api';
const DEFAULT_SETTINGS = {
  requests: true,
  cosmetic: true,
  youtube: true,
  itvx: true,
  soundcloud: true,
  autosync: true
};

let latestLogs = [];
let overviewTimer = null;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toast(message, error = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

function setBadge(id, text, tone = 'green') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `badge ${tone}`;
}

function setToggle(key, enabled) {
  const el = document.getElementById('setting-' + key);
  if (!el) return;
  el.className = 'toggle' + (enabled ? ' on' : '');
  el.setAttribute('aria-pressed', enabled ? 'true' : 'false');
}

function formatRelativeDate(timestamp) {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString();
}

function showPage(id, updateHash = true) {
  const page = document.getElementById('page-' + id);
  const nav = document.querySelector(`.nav-item[data-page="${id}"]`);
  if (!page || !nav) return;

  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  page.classList.add('active');
  nav.classList.add('active');

  if (updateHash && location.hash !== '#' + id) history.replaceState(null, '', '#' + id);

  if (id === 'filters') fetchFilterLists();
  if (id === 'custom') loadCustomFilters();
  if (id === 'sites') fetchWhitelist();
  if (id === 'logs') fetchLogs();
  if (id === 'protection' || id === 'settings') loadSettings();
  if (id === 'health') refreshHealth();
}

function initNavigation() {
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => showPage(item.dataset.page));
  });
  document.querySelectorAll('[data-go-page]').forEach(item => {
    item.addEventListener('click', () => showPage(item.dataset.goPage));
  });
  const requested = location.hash.slice(1);
  if (requested && document.getElementById('page-' + requested)) showPage(requested, false);
}

function getFilterLists(callback) {
  chrome.runtime.sendMessage({ type: 'GET_FILTER_LISTS' }, lists => callback(Array.isArray(lists) ? lists : []));
}

function getDynamicRules(callback) {
  chrome.declarativeNetRequest.getDynamicRules(rules => callback(Array.isArray(rules) ? rules : []));
}

async function fetchDashboardStatus() {
  const response = await fetch(API + '/status', { signal: AbortSignal.timeout(2200) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchOverview() {
  chrome.runtime.sendMessage({ type: 'GET_STATS' }, stats => {
    const today = document.getElementById('stat-today');
    const total = document.getElementById('stat-total');
    if (today) today.textContent = Number(stats?.today || 0).toLocaleString();
    if (total) total.textContent = Number(stats?.total || 0).toLocaleString();
  });

  getFilterLists(lists => {
    const count = lists.length;
    document.getElementById('stat-lists').textContent = count.toLocaleString();
    document.getElementById('nav-list-count').textContent = String(count);
    const summary = document.getElementById('filters-summary');
    if (summary) summary.textContent = `${count} list${count === 1 ? '' : 's'}`;
  });

  getDynamicRules(rules => {
    document.getElementById('stat-rules').textContent = rules.length.toLocaleString();
  });

  const { settings = {} } = await chrome.storage.local.get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  setBadge('requests-badge', merged.requests === false ? 'Paused' : 'Active', merged.requests === false ? 'red' : 'green');
  setBadge('cosmetic-badge', merged.cosmetic === false ? 'Paused' : 'Active', merged.cosmetic === false ? 'red' : 'green');

  try {
    const status = await fetchDashboardStatus();
    applyDnsStatus(Boolean(status.dns_running), true);
  } catch {
    applyDnsStatus(false, false);
  }

  fetchRecentOverviewActivity();
}

function applyDnsStatus(running, apiReachable) {
  const dot = document.getElementById('dns-dot');
  if (dot) dot.className = 'health-dot' + (running && apiReachable ? '' : ' red');
  const label = document.getElementById('dns-label');
  if (label) label.textContent = !apiReachable ? 'Dashboard offline' : (running ? 'DNS running' : 'DNS stopped');

  const statusText = document.getElementById('dns-status-text');
  if (statusText) statusText.textContent = !apiReachable ? 'Dashboard API unavailable' : (running ? 'Running on 127.0.0.1:53' : 'Local resolver is stopped');
  setBadge('dns-badge', !apiReachable ? 'Offline' : (running ? 'Active' : 'Stopped'), !apiReachable || !running ? 'red' : 'green');
  setBadge('dns-badge-protection', !apiReachable ? 'API offline' : (running ? 'Running' : 'Stopped'), !apiReachable || !running ? 'red' : 'green');

  const state = document.getElementById('protection-state');
  const copy = document.getElementById('protection-copy');
  const overviewBadge = document.getElementById('overview-protection-badge');
  if (!apiReachable) {
    if (state) state.textContent = 'Protection partially available';
    if (copy) copy.textContent = 'Browser protection is loaded, but the local dashboard API is not responding.';
    if (overviewBadge) { overviewBadge.textContent = 'Local service offline'; overviewBadge.className = 'badge red'; }
  } else if (!running) {
    if (state) state.textContent = 'DNS protection paused';
    if (copy) copy.textContent = 'Browser protection remains available while the local DNS resolver is stopped.';
    if (overviewBadge) { overviewBadge.textContent = 'DNS paused'; overviewBadge.className = 'badge yellow'; }
  } else {
    if (state) state.textContent = 'Protection active';
    if (copy) copy.textContent = 'Browser and local DNS protection layers are responding normally.';
    if (overviewBadge) { overviewBadge.innerHTML = '<span class="mini-dot"></span>Protected'; overviewBadge.className = 'badge green'; }
  }
}

async function fetchRecentOverviewActivity() {
  const container = document.getElementById('overview-activity');
  if (!container) return;
  try {
    const response = await fetch(API + '/dns/logs', { signal: AbortSignal.timeout(2600) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const logs = await response.json();
    const rows = (Array.isArray(logs) ? logs : []).slice(-6).reverse();
    if (!rows.length) {
      container.innerHTML = '<div class="empty">No recent DNS blocks.</div>';
      return;
    }
    container.innerHTML = rows.map(row => `
      <div class="activity-row">
        <div class="activity-domain">${esc(row.domain)}</div>
        <div class="activity-source">DNS</div>
        <div class="activity-time">${esc(row.time)}</div>
      </div>`).join('');
  } catch {
    container.innerHTML = '<div class="empty">DNS activity unavailable.</div>';
  }
}

async function dnsAction(action) {
  try {
    const response = await fetch(`${API}/dns/${action}`, { method: 'POST' });
    const data = await response.json();
    if (data.ok) {
      toast(`DNS ${action === 'start' ? 'started' : 'stopped'}`);
      fetchOverview();
      refreshHealth();
    } else {
      toast('Failed: ' + (data.error || 'unknown error'), true);
    }
  } catch {
    toast('DNS control is not authorised or the dashboard API is unavailable', true);
  }
}

function fetchFilterLists() {
  getFilterLists(lists => {
    const container = document.getElementById('filter-list-items');
    if (!container) return;
    document.getElementById('nav-list-count').textContent = String(lists.length);
    const summary = document.getElementById('filters-summary');
    if (summary) summary.textContent = `${lists.length} list${lists.length === 1 ? '' : 's'}`;

    if (!lists.length) {
      container.innerHTML = '<div class="empty">No filter lists subscribed yet.</div>';
      return;
    }

    container.innerHTML = lists.map(list => `
      <div class="filter-list-item">
        <div>
          <div class="filter-list-name">${esc(list.name || 'Unnamed list')}</div>
          <div class="filter-list-meta">${esc(list.url)} · Last synced ${esc(formatRelativeDate(list.lastSync))}</div>
        </div>
        <div class="filter-counts">
          <span>${Number(list.networkCount || 0).toLocaleString()} network</span>
          <span>${Number(list.cosmeticCount || 0).toLocaleString()} cosmetic</span>
        </div>
        <div class="filter-list-actions">
          <button class="btn sm" data-sync-id="${esc(list.id)}">Sync</button>
          <button class="btn sm danger" data-remove-id="${esc(list.id)}">Remove</button>
        </div>
      </div>`).join('');

    container.querySelectorAll('[data-sync-id]').forEach(btn => btn.addEventListener('click', () => syncList(btn.dataset.syncId)));
    container.querySelectorAll('[data-remove-id]').forEach(btn => btn.addEventListener('click', () => removeList(btn.dataset.removeId)));
  });
}

function addFilterList() {
  const input = document.getElementById('filter-url-input');
  const url = input?.value.trim();
  if (!url) return;
  toast('Subscribing…');
  chrome.runtime.sendMessage({ type: 'SYNC_FILTER_LIST', url }, result => {
    if (result?.ok) {
      toast(`Added ${result.meta?.name || 'filter list'}`);
      input.value = '';
      fetchFilterLists();
      fetchOverview();
    } else {
      toast('Failed: ' + (result?.error || 'unknown error'), true);
    }
  });
}

function addPreset(url) {
  const input = document.getElementById('filter-url-input');
  if (!input) return;
  input.value = url;
  addFilterList();
}

function syncList(id) {
  getFilterLists(lists => {
    const list = lists.find(item => String(item.id) === String(id));
    if (!list) return;
    toast('Syncing…');
    chrome.runtime.sendMessage({ type: 'SYNC_FILTER_LIST', url: list.url, id: list.id }, result => {
      if (result?.ok) {
        toast(`Synced ${result.meta?.name || list.name || 'list'}`);
        fetchFilterLists();
        fetchOverview();
      } else {
        toast('Sync failed: ' + (result?.error || 'unknown error'), true);
      }
    });
  });
}

function removeList(id) {
  chrome.runtime.sendMessage({ type: 'REMOVE_FILTER_LIST', id }, () => {
    toast('Filter list removed');
    fetchFilterLists();
    fetchOverview();
  });
}

async function syncAllNow() {
  toast('Syncing all lists…');
  const { filterLists = [] } = await chrome.storage.local.get('filterLists');
  let completed = 0;
  for (const list of filterLists.filter(item => item.enabled !== false)) {
    await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'SYNC_FILTER_LIST', url: list.url, id: list.id }, () => {
        completed += 1;
        resolve();
      });
    });
  }
  toast(`Synced ${completed} list${completed === 1 ? '' : 's'}`);
  fetchFilterLists();
  fetchOverview();
}

function loadCustomFilters() {
  chrome.runtime.sendMessage({ type: 'GET_CUSTOM_FILTERS' }, text => {
    const editor = document.getElementById('custom-filter-editor');
    if (editor) editor.value = text || '';
  });
}

function saveCustomFilters() {
  const editor = document.getElementById('custom-filter-editor');
  if (!editor) return;
  chrome.runtime.sendMessage({ type: 'SAVE_CUSTOM_FILTERS', text: editor.value }, result => {
    if (result?.ok) toast('Custom filters applied');
    else toast('Failed to apply custom filters', true);
  });
}

function renderLogs() {
  const container = document.getElementById('log-list');
  if (!container) return;
  const query = (document.getElementById('log-search')?.value || '').trim().toLowerCase();
  const visible = latestLogs.filter(row => !query || String(row.domain || '').toLowerCase().includes(query));
  const count = document.getElementById('log-count');
  if (count) count.textContent = query ? `${visible.length} matching of ${latestLogs.length}` : `${latestLogs.length} recent entr${latestLogs.length === 1 ? 'y' : 'ies'}`;

  if (!visible.length) {
    container.innerHTML = `<div class="empty">${query ? 'No blocked domains match your search.' : 'No blocked requests recorded yet.'}</div>`;
    return;
  }

  container.innerHTML = [...visible].reverse().map(row => `
    <div class="log-item">
      <span class="log-domain">${esc(row.domain)}</span>
      <span class="log-source">DNS blocked</span>
      <span class="log-time">${esc(row.time)}</span>
    </div>`).join('');
}

async function fetchLogs() {
  const container = document.getElementById('log-list');
  if (!container) return;
  try {
    const response = await fetch(API + '/dns/logs', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    latestLogs = Array.isArray(data) ? data : [];
    renderLogs();
  } catch {
    latestLogs = [];
    container.innerHTML = '<div class="empty">Dashboard API not reachable.</div>';
    const count = document.getElementById('log-count');
    if (count) count.textContent = 'Activity unavailable';
  }
}

function fetchWhitelist() {
  chrome.runtime.sendMessage({ type: 'GET_WHITELIST' }, whitelist => {
    const list = Array.isArray(whitelist) ? whitelist : [];
    const container = document.getElementById('whitelist-items');
    const count = document.getElementById('whitelist-count');
    if (count) count.textContent = `${list.length} site${list.length === 1 ? '' : 's'}`;
    if (!container) return;
    if (!list.length) {
      container.innerHTML = '<div class="empty">No sites whitelisted.</div>';
      return;
    }
    container.innerHTML = list.map(domain => `
      <div class="whitelist-item"><span class="whitelist-domain">${esc(domain)}</span><button class="btn sm danger" data-remove-domain="${esc(domain)}">Remove</button></div>`).join('');
    container.querySelectorAll('[data-remove-domain]').forEach(btn => btn.addEventListener('click', () => removeWhitelist(btn.dataset.removeDomain)));
  });
}

async function addWhitelist() {
  const input = document.getElementById('whitelist-input');
  if (!input) return;
  const domain = input.value.trim().replace(/^https?:\/\//i, '').split('/')[0];
  if (!domain) return;
  const { whitelist = [] } = await chrome.storage.local.get('whitelist');
  if (!whitelist.includes(domain)) {
    whitelist.push(domain);
    await chrome.storage.local.set({ whitelist });
  }
  input.value = '';
  fetchWhitelist();
  toast(`${domain} added to site exceptions`);
}

async function removeWhitelist(domain) {
  const { whitelist = [] } = await chrome.storage.local.get('whitelist');
  await chrome.storage.local.set({ whitelist: whitelist.filter(item => item !== domain) });
  fetchWhitelist();
  toast(`${domain} removed`);
}

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  Object.entries(merged).forEach(([key, enabled]) => setToggle(key, enabled !== false));
}

async function toggleSetting(key) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const current = key in settings ? settings[key] : DEFAULT_SETTINGS[key];
  settings[key] = !current;
  await chrome.storage.local.set({ settings });
  setToggle(key, settings[key]);
  toast(`${key.charAt(0).toUpperCase() + key.slice(1)} ${settings[key] ? 'enabled' : 'disabled'}`);
  fetchOverview();
}

async function refreshHealth() {
  const manifest = chrome.runtime.getManifest();
  document.getElementById('info-version').textContent = manifest.version || 'Unknown';
  document.getElementById('health-extension-value').textContent = 'Active';
  document.getElementById('health-extension-sub').textContent = `Manifest ${manifest.manifest_version || 3} · version ${manifest.version || 'unknown'}`;

  getDynamicRules(rules => {
    document.getElementById('health-rules-value').textContent = rules.length.toLocaleString();
  });

  getFilterLists(lists => {
    document.getElementById('health-lists-value').textContent = lists.length.toLocaleString();
    const syncs = lists.map(list => new Date(list.lastSync || 0).getTime()).filter(Number.isFinite).filter(Boolean);
    const latest = syncs.length ? Math.max(...syncs) : 0;
    document.getElementById('health-sync-value').textContent = latest ? formatRelativeDate(latest) : 'Never';
  });

  try {
    const status = await fetchDashboardStatus();
    document.getElementById('health-api-value').textContent = 'Online';
    setBadge('health-api-badge', 'Online', 'green');
    document.getElementById('health-dns-value').textContent = status.dns_running ? 'Running' : 'Stopped';
    setBadge('health-dns-badge', status.dns_running ? 'Healthy' : 'Stopped', status.dns_running ? 'green' : 'red');
    applyDnsStatus(Boolean(status.dns_running), true);
  } catch {
    document.getElementById('health-api-value').textContent = 'Offline';
    setBadge('health-api-badge', 'Offline', 'red');
    document.getElementById('health-dns-value').textContent = 'Unknown';
    setBadge('health-dns-badge', 'Unknown', 'red');
    applyDnsStatus(false, false);
  }
}

function bindControls() {
  document.getElementById('btn-dns-start')?.addEventListener('click', () => dnsAction('start'));
  document.getElementById('btn-dns-stop')?.addEventListener('click', () => dnsAction('stop'));
  document.getElementById('btn-add-filter')?.addEventListener('click', addFilterList);
  document.getElementById('filter-url-input')?.addEventListener('keydown', event => { if (event.key === 'Enter') addFilterList(); });
  document.querySelectorAll('[data-preset]').forEach(btn => btn.addEventListener('click', () => addPreset(btn.dataset.preset)));
  document.getElementById('btn-revert')?.addEventListener('click', loadCustomFilters);
  document.getElementById('btn-save-filters')?.addEventListener('click', saveCustomFilters);
  document.getElementById('btn-refresh-logs')?.addEventListener('click', fetchLogs);
  document.getElementById('log-search')?.addEventListener('input', renderLogs);
  document.getElementById('btn-add-whitelist')?.addEventListener('click', addWhitelist);
  document.getElementById('whitelist-input')?.addEventListener('keydown', event => { if (event.key === 'Enter') addWhitelist(); });
  document.querySelectorAll('[data-setting]').forEach(btn => btn.addEventListener('click', () => toggleSetting(btn.dataset.setting)));
  document.getElementById('btn-sync-all')?.addEventListener('click', syncAllNow);
  document.getElementById('btn-sync-all-settings')?.addEventListener('click', syncAllNow);
  document.getElementById('btn-sync-all-overview')?.addEventListener('click', syncAllNow);
  document.getElementById('btn-refresh-health')?.addEventListener('click', refreshHealth);
}

function initManifestInfo() {
  const manifest = chrome.runtime.getManifest();
  const brandVersion = document.getElementById('brand-version');
  if (brandVersion) brandVersion.textContent = `v${manifest.version || '?'} · local protection suite`;
}

function init() {
  initManifestInfo();
  initNavigation();
  bindControls();
  loadSettings();
  fetchOverview();
  overviewTimer = setInterval(fetchOverview, 10_000);
}

document.addEventListener('DOMContentLoaded', init);
