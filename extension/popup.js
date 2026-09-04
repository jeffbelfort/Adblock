// popup.js

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function getHostname(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function init() {
  const tab = await getCurrentTab();
  const host = getHostname(tab?.url || '');

  document.getElementById('site-name').textContent = host || 'Unknown site';

  const data = await chrome.storage.local.get(['stats', 'pageBlocks', 'settings', 'whitelist']);
  const stats = data.stats || { today: 0, total: 0 };
  const pageBlocks = data.pageBlocks || {};
  const settings = data.settings || { requests: true, cosmetic: true };
  const whitelist = data.whitelist || [];
  const isWhitelisted = whitelist.includes(host);

  const tabBlocks = pageBlocks[String(tab?.id)];
  const pageCount = tabBlocks ? Object.values(tabBlocks).reduce((a, b) => a + b, 0) : 0;

  document.getElementById('stat-page').textContent = pageCount.toLocaleString();
  document.getElementById('stat-today').textContent = (stats.today || 0).toLocaleString();
  document.getElementById('stat-total').textContent = (stats.total || 0).toLocaleString();
  document.getElementById('site-status').textContent = isWhitelisted ? 'Protection paused' : 'Protected';

  // Power button
  const powerBtn = document.getElementById('power-btn');
  if (isWhitelisted) powerBtn.classList.add('off');
  powerBtn.onclick = async () => {
    const stored = await chrome.storage.local.get('whitelist');
    const wl = stored.whitelist || [];
    const idx = wl.indexOf(host);
    if (idx === -1) wl.push(host); else wl.splice(idx, 1);
    await chrome.storage.local.set({ whitelist: wl });
    if (tab?.id) chrome.tabs.reload(tab.id);
    window.close();
  };

  // Page blocks
  const blockList = document.getElementById('page-block-list');
  if (tabBlocks && Object.keys(tabBlocks).length > 0) {
    const sorted = Object.entries(tabBlocks).sort((a, b) => b[1] - a[1]).slice(0, 5);
    blockList.innerHTML = sorted.map(([domain, count]) => `
      <div class="block-item">
        <span class="block-domain">${esc(domain)}</span>
        <span class="block-count">${count}</span>
      </div>`).join('');
  }

  // Toggles
  const toggleRequests = document.getElementById('toggle-requests');
  const toggleCosmetic = document.getElementById('toggle-cosmetic');
  if (!settings.requests) toggleRequests.classList.remove('on');
  if (!settings.cosmetic) toggleCosmetic.classList.remove('on');

  toggleRequests.onclick = async () => {
    const s = (await chrome.storage.local.get('settings')).settings || {};
    s.requests = s.requests === false ? true : false;
    await chrome.storage.local.set({ settings: s });
    toggleRequests.classList.toggle('on', s.requests !== false);
  };

  toggleCosmetic.onclick = async () => {
    const s = (await chrome.storage.local.get('settings')).settings || {};
    s.cosmetic = s.cosmetic === false ? true : false;
    await chrome.storage.local.set({ settings: s });
    toggleCosmetic.classList.toggle('on', s.cosmetic !== false);
  };

  // Footer buttons
  document.getElementById('open-dashboard').onclick = (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    window.close();
  };
  document.getElementById('open-filters').onclick = (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') + '#filters' });
    window.close();
  };
  document.getElementById('open-logs').onclick = (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') + '#logs' });
    window.close();
  };
}

init().catch(console.error);
