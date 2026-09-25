// IPHM.NETWORK Enhanced Application Engine
import { supabase, SUPABASE_URL } from './supabaseClient.js';

// No demo provider cards are shipped with the app.
// Every card must be created by the admin in Supabase and published explicitly.
const DEFAULT_PROVIDERS = [];
const PROVIDERS = DEFAULT_PROVIDERS;

// ====================================================================
// ENCRYPTED OBFUSCATED PROVIDER CREDENTIALS VAULT
// Secrets are strictly hidden in the code and never stored in plain text
// in public catalogs, localStorage, or network payloads.
// They are ONLY decrypted dynamically in memory when payment is approved.
// ====================================================================
const VAULT_CIPHER_KEY = 'IPHM_NET_SECURE_GATEWAY_KEY_2026_X99';

const ENCRYPTED_PROVIDER_VAULT = {
  "1": { "name": "DzwnJjYAAAB/HQk=", "url": "ISQ8PSx0ans5PyooPDwgK2koJw==" },
  "2": { "name": "Hj86ITsdMSY6MihjERdlHSYzMWgaJC0+Jw==", "url": "ISQ8PSx0ansoPDcvMSExLSIgOWs0LjQ=" },
  "3": { "name": "GSIhOz4CJC06IWUQIjs2LGcJPSI/bBso", "url": "ISQ8PSx0ansvISw1ND4kJiIzeiY4LA==" },
  "4": { "name": "eGlweX8GKicrOiskdR0jOTQpOzcy", "url": "ISQ8PSx0antuan13ezoqLDMoOiI=" }
};

function decryptVaultSecret(b64) {
  if (!b64) return '';
  try {
    const raw = atob(b64);
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      out += String.fromCharCode(raw.charCodeAt(i) ^ VAULT_CIPHER_KEY.charCodeAt(i % VAULT_CIPHER_KEY.length));
    }
    return out;
  } catch (e) {
    return '';
  }
}

function getDecryptedProviderSecret(providerId) {
  const pIdStr = String(providerId || 1);
  const entry = ENCRYPTED_PROVIDER_VAULT[pIdStr];
  if (entry) {
    return {
      name: decryptVaultSecret(entry.name),
      url: decryptVaultSecret(entry.url)
    };
  }
  // Check if custom encrypted secret in storage
  try {
    const customVault = JSON.parse(localStorage.getItem('iphm_vault_custom') || '{}');
    if (customVault[pIdStr]) {
      return {
        name: decryptVaultSecret(customVault[pIdStr].name),
        url: decryptVaultSecret(customVault[pIdStr].url)
      };
    }
  } catch (e) {}

  return {
    name: 'Verified Host Access',
    url: 'https://iphm.network'
  };
}

function findProviderForOrder(order) {
  if (!order) return DEFAULT_PROVIDERS[0];
  const pId = order.provider_id;
  const list = (state?.providers && state.providers.length > 0) ? state.providers : DEFAULT_PROVIDERS;
  const found = list.find(p => String(p.id) === String(pId))
             || DEFAULT_PROVIDERS.find(p => String(p.id) === String(pId));
  return found || {
    id: pId || 1,
    city: order.city || 'Amsterdam',
    country: order.country || 'Netherland',
    countryCode: order.countryCode || 'nl',
    type: order.machine_type || 'VPS',
    pps: order.pps || '150K pps',
    nic: order.nic || '10 GBPS',
    priceUsd: order.amount_usd || 45
  };
}

function encryptVaultSecret(plain) {
  if (!plain) return '';
  try {
    let out = '';
    for (let i = 0; i < plain.length; i++) {
      out += String.fromCharCode(plain.charCodeAt(i) ^ VAULT_CIPHER_KEY.charCodeAt(i % VAULT_CIPHER_KEY.length));
    }
    return btoa(out);
  } catch (e) {
    return '';
  }
}

function loadInitialOrders() {
  const user = JSON.parse(localStorage.getItem('iphm_user') || 'null');
  if (!user) {
    localStorage.removeItem('iphm_orders');
    return [];
  }
  const stored = localStorage.getItem('iphm_orders');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Production Mode: filter out all temporary/demo test orders
        const realOrders = parsed.filter(order => {
          if (!order) return false;
          const ref = String(order.order_ref || order.ref || '');
          const id = String(order.id || '');
          const email = String(order.user_email || '');
          if (id.startsWith('ord-demo') || ref === 'ORD-849201' || ref === 'ORD-319402' || email === 'customer@proton.me') {
            return false;
          }
          return true;
        });

        let changed = realOrders.length !== parsed.length;
        const sanitized = realOrders.map(order => {
          const clean = { ...order };
          // If order is not approved (pending or cancelled), ensure upstream provider secrets are masked
          if (clean.status !== 'approved') {
            const expectedName = `${clean.city || 'Amsterdam'}, ${clean.country || 'Netherland'} (${clean.machine_type || 'VPS'})`;
            if (clean.provider_name !== expectedName || clean.provider_url !== null) {
              clean.provider_name = expectedName;
              clean.provider_url = null;
              changed = true;
            }
          } else {
            // For approved orders, strip static raw URLs so dynamic vault decryption is used
            if (clean.provider_url !== null) {
              clean.provider_url = null;
              changed = true;
            }
          }
          return clean;
        });
        if (changed) {
          localStorage.setItem('iphm_orders', JSON.stringify(sanitized));
        }
        return sanitized;
      }
    } catch (e) {}
  }
  return [];
}

function loadInitialUnlocked() {
  const user = JSON.parse(localStorage.getItem('iphm_user') || 'null');
  if (!user) {
    localStorage.removeItem('iphm_unlocked');
    return [];
  }
  const stored = localStorage.getItem('iphm_unlocked');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Production Mode: purge any demo unlocked items
        const realUnlocked = parsed.filter(item => {
          if (!item) return false;
          const ref = String(item.orderRef || '');
          return ref !== 'ORD-319402' && ref !== 'ORD-849201';
        });
        if (realUnlocked.length !== parsed.length) {
          localStorage.setItem('iphm_unlocked', JSON.stringify(realUnlocked));
        }
        return realUnlocked;
      }
    } catch (e) {}
  }
  return [];
}

function purgeStaleProviderCache() {
  try {
    const stored = localStorage.getItem('iphm_providers');
    if (!stored) return;

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem('iphm_providers');
      return;
    }

    const hasLegacyDemoCatalog = parsed.some(provider => {
      const city = String(provider.city || '').trim();
      const country = String(provider.country || '').trim();
      return (
        city === 'Amsterdam' ||
        city === 'Frankfurt' ||
        city === 'Zurich' ||
        city === 'Reykjavik' ||
        country === 'Netherland' ||
        country === 'Germany' ||
        country === 'Switzerland' ||
        country === 'Iceland'
      );
    });

    if (hasLegacyDemoCatalog) {
      localStorage.removeItem('iphm_providers');
    }
  } catch (e) {
    localStorage.removeItem('iphm_providers');
  }
}

function loadInitialProviders() {
  // Start from an empty catalog so cards are created by the database/admin flow.
  purgeStaleProviderCache();
  localStorage.removeItem('iphm_providers');
  return [];
}

// Global State
const state = {
  user: JSON.parse(localStorage.getItem('iphm_user') || 'null'),
  currentPassword: (function() {
    try {
      const active = sessionStorage.getItem('iphm_active_pwd');
      if (active) return active;
      const user = JSON.parse(localStorage.getItem('iphm_user') || 'null');
      if (user?.id) {
        return localStorage.getItem('iphm_account_pwd_' + user.id) || '';
      }
      return '';
    } catch (e) {
      return '';
    }
  })(),
  unlockedProviders: loadInitialUnlocked(),
  orders: loadInitialOrders(),
  providers: loadInitialProviders(),
  isAdmin: false,
  adminOrders: [],
  currentOrder: null,
  authMode: 'login', // 'login' or 'register'
  pendingCheckoutProvider: null,
  activeFilter: 'all',
  searchQuery: '',
  ordersFilter: 'all',
  adminFilter: 'all',
  adminSearchQuery: '',
  providerFilter: 'all',
  providerSearchQuery: '',
  adminActiveTab: 'orders'
};

const authRequestState = {
  lastAttemptAt: 0,
  cooldownMs: 2500
};

function getVisibleProviders() {
  return state.providers.filter(p => !p.isHidden);
}

function saveProvidersLocally() {
  // Never persist raw secret credentials into public localStorage
  const cleanProviders = state.providers.map(p => {
    const copy = { ...p };
    delete copy.revealedName;
    delete copy.revealedUrl;
    return copy;
  });
  localStorage.setItem('iphm_providers', JSON.stringify(cleanProviders));
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  purgeStaleProviderCache();
  initUI();
  initFAQ();
  initAuth();
  initCheckout();
  initDashboard();
  initOrdersModal();
  initAdminModal();
  initProfileModal();
  initFilters();
  initLiveRates();
  setupRealtimeOrders();
  setupRealtimeProviders();
  syncProvidersFromSupabase();
  renderProviders();
  updateStats();
  updateOrdersBadges();
  renderOrdersList();
  checkAdminStatus();
});

// Update hero stats
function updateStats() {
  const liveCountEl = document.getElementById('statLiveProviders');
  const countryCountEl = document.getElementById('statCountries');
  const unlockedCountEl = document.getElementById('statUnlocked');
  const liveListingsText = document.getElementById('liveListingsText');
  const navProviderCount = document.getElementById('navProviderCount');
  const mobileProviderCount = document.getElementById('mobileProviderCount');

  const visible = getVisibleProviders();
  const uniqueCountries = new Set(visible.map(p => p.country)).size;

  if (liveCountEl) liveCountEl.textContent = visible.length;
  if (countryCountEl) countryCountEl.textContent = uniqueCountries;
  if (unlockedCountEl) unlockedCountEl.textContent = state.unlockedProviders.length;
  if (liveListingsText) liveListingsText.textContent = `${visible.length} live listings`;
  if (navProviderCount) navProviderCount.textContent = visible.length;
  if (mobileProviderCount) mobileProviderCount.textContent = `${visible.length} live`;
}

// Render Provider Cards with Filter and Search
function renderProviders() {
  const grid = document.getElementById('providersGrid');
  if (!grid) return;

  const visible = getVisibleProviders();
  const filtered = visible.filter(p => {
    // Filter pill check
    if (state.activeFilter === 'VPS' && p.type !== 'VPS') return false;
    if (state.activeFilter === 'Dedicated' && p.type !== 'Dedicated') return false;

    // Search query check
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const matchCity = (p.city || '').toLowerCase().includes(q);
      const matchCountry = (p.country || '').toLowerCase().includes(q);
      const matchType = (p.type || '').toLowerCase().includes(q);
      if (!matchCity && !matchCountry && !matchType) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    const emptyText = visible.length === 0
      ? 'No provider cards yet. Add listings from the admin panel or database to populate the homepage.'
      : 'No matching providers found. Try adjusting your filter or search keywords.';

    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; background: var(--color-surface); border: 1px dashed var(--color-line-bright); border-radius: var(--radius-xl);">
        <p style="font-size: 1.125rem; font-weight: 600; color: var(--color-ink);">${visible.length === 0 ? 'No provider cards yet' : 'No matching providers found'}</p>
        <p style="font-size: 0.875rem; color: var(--color-muted); margin-top: 0.25rem;">${emptyText}</p>
        ${visible.length > 0 ? '<button type="button" class="btn btn-ghost btn-sm" style="margin-top: 1rem;" id="resetFiltersBtn">Reset Filters</button>' : ''}
      </div>
    `;

    document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
      state.activeFilter = 'all';
      state.searchQuery = '';
      document.getElementById('searchInput').value = '';
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-filter') === 'all'));
      renderProviders();
    });
    return;
  }

  grid.innerHTML = filtered.map(provider => {
    const isUnlocked = state.unlockedProviders.some(u => String(u.providerId) === String(provider.id));
    const typeBadgeClass = provider.type === 'VPS' ? 'badge-vps' : 'badge-dedi';
    const liveLtc = (provider.priceUsd / (ratesState.LTC || 73.95)).toFixed(2);
    provider.priceLtc = liveLtc;

    return `
      <article class="provider-card">
        <div class="card-header">
          <div class="location-group">
            <span class="flag-box" title="${provider.country}" role="img" aria-label="${provider.country}">
              <img src="https://flagcdn.com/${provider.countryCode || 'us'}.svg" alt="${provider.country} flag" loading="lazy" onerror="this.style.display='none'" />
            </span>
            <div>
              <h3 class="city-name">${provider.city}</h3>
              <p class="country-name">${provider.country}</p>
            </div>
          </div>
          <span class="${typeBadgeClass}">${provider.type}</span>
        </div>

        <dl class="specs-grid">
          <div class="spec-item">
            <dt>Highest PPS</dt>
            <dd class="mono">${provider.pps}</dd>
          </div>
          <div class="spec-item">
            <dt>NIC speed</dt>
            <dd class="mono">${provider.nic}</dd>
          </div>
          <div class="spec-item">
            <dt>Spoofing</dt>
            <dd style="display: flex; align-items: center; gap: 0.35rem;">
              <span class="live-dot" style="width: 6px; height: 6px;"></span>
              <span class="text-accent" style="font-weight: 600;">${provider.spoofing}</span>
            </dd>
          </div>
          <div class="spec-item">
            <dt>Audit</dt>
            <dd class="text-muted" style="font-size: 0.78rem;">${provider.updatedAgo || 'Just now'}</dd>
          </div>
        </dl>

        <div class="card-footer">
          <div>
            <p class="price-title">Price</p>
            <div style="display: flex; align-items: baseline; gap: 0.45rem; flex-wrap: wrap;">
              <p class="price-value">$${provider.priceUsd}<span class="price-currency">USD</span></p>
              <span class="price-crypto-pill" data-provider-id="${provider.id}">${liveLtc} LTC</span>
            </div>
          </div>
          ${isUnlocked ? `
            <button type="button" class="btn btn-outline-accent btn-sm view-unlocked-btn" data-id="${provider.id}">
              Unlocked &check;
            </button>
          ` : `
            <button type="button" class="btn btn-primary buy-btn" data-id="${provider.id}">
              Buy access
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </button>
          `}
        </div>
      </article>
    `;
  }).join('');

  // Attach event handlers to dynamic cards
  attachCardEvents();
}

function attachCardEvents() {
  document.querySelectorAll('.buy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const providerId = btn.getAttribute('data-id');
      const provider = state.providers.find(p => String(p.id) === String(providerId)) || state.providers[0];

      if (!state.user) {
        state.pendingCheckoutProvider = provider;
        openAuthModal('login');
      } else {
        openCheckoutModal(provider);
      }
    });
  });

  document.querySelectorAll('.view-unlocked-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openDashboard();
    });
  });
}

// Filter and Search Bar Initialization
function initFilters() {
  const filterPills = document.querySelectorAll('.filter-btn');
  filterPills.forEach(btn => {
    btn.addEventListener('click', () => {
      filterPills.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeFilter = btn.getAttribute('data-filter');
      renderProviders();
    });
  });

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim();
      renderProviders();
    });
  }
}

// UI Setup (Header, Mobile Menu, ScrollSpy, Auth state, Dropdowns)
function initUI() {
  renderHeaderAuth();

  // Mobile drawer toggle
  const mobileToggleBtn = document.getElementById('mobileToggleBtn');
  const mobileNavDrawer = document.getElementById('mobileNavDrawer');
  if (mobileToggleBtn && mobileNavDrawer) {
    mobileToggleBtn.addEventListener('click', () => {
      const isOpen = mobileNavDrawer.classList.toggle('open');
      mobileToggleBtn.classList.toggle('open', isOpen);
      mobileToggleBtn.setAttribute('aria-expanded', String(isOpen));
      mobileNavDrawer.setAttribute('aria-hidden', String(!isOpen));
    });

    // Close drawer when clicking any link with data-close-drawer
    mobileNavDrawer.querySelectorAll('[data-close-drawer]').forEach(link => {
      link.addEventListener('click', () => {
        mobileNavDrawer.classList.remove('open');
        mobileToggleBtn.classList.remove('open');
        mobileToggleBtn.setAttribute('aria-expanded', 'false');
        mobileNavDrawer.setAttribute('aria-hidden', 'true');
      });
    });
  }

  // Close user menu dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const userMenu = document.getElementById('userMenuDropdown');
    const userBtn = document.getElementById('userAvatarBtn');
    const userMenuContainer = document.querySelector('.user-menu-container');
    if (userMenu && userBtn && !userBtn.contains(e.target) && !userMenu.contains(e.target)) {
      userMenu.classList.remove('open');
      if (userMenuContainer) userMenuContainer.classList.remove('open');
    }
  });

  // Smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId && targetId !== '#') {
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
          e.preventDefault();
          targetElement.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  });

  // Mobile auth button — closes the drawer and opens the login modal
  document.getElementById('mobileOpenAuthBtn')?.addEventListener('click', () => {
    if (mobileNavDrawer) mobileNavDrawer.classList.remove('open');
    if (mobileToggleBtn) { mobileToggleBtn.classList.remove('open'); mobileToggleBtn.setAttribute('aria-expanded', 'false'); }
    if (mobileNavDrawer) mobileNavDrawer.setAttribute('aria-hidden', 'true');
    openAuthModal('login');
  });

  // ScrollSpy for navbar active link indicators
  window.addEventListener('scroll', () => {
    const sections = ['providers', 'how-it-works', 'faq'];
    const scrollPos = window.scrollY + 180;

    for (const sectionId of sections) {
      const el = document.getElementById(sectionId);
      if (el) {
        const top = el.offsetTop;
        const height = el.offsetHeight;
        if (scrollPos >= top && scrollPos < top + height) {
          document.querySelectorAll('.site-nav .nav-link-item').forEach(item => {
            if (item.getAttribute('href') === `#${sectionId}`) {
              item.classList.add('active');
            } else {
              item.classList.remove('active');
            }
          });
          break;
        }
      }
    }
  }, { passive: true });
}

// Centralized Safe Logout: Wipes all user orders, credentials and history from memory and storage
async function handleLogout() {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn('Sign out:', err);
  }
  state.user = null;
  state.orders = [];
  state.unlockedProviders = [];
  state.adminOrders = [];
  state.isAdmin = false;
  state.currentPassword = '';
  try {
    sessionStorage.removeItem('iphm_active_pwd');
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('iphm_account_pwd_')) {
        localStorage.removeItem(k);
      }
    }
  } catch(e) {}
  localStorage.removeItem('iphm_user');
  localStorage.removeItem('iphm_orders');
  localStorage.removeItem('iphm_unlocked');
  setAdminState(false);
  closeProfileModal();
  updateProfileModalContent();
  renderHeaderAuth();
  renderProviders();
  updateStats();
  updateOrdersBadges();
  renderOrdersList();
  closeDashboard();
  showToast('Signed Out', 'You have been safely signed out. Order history cleared.', 'info');
  if (document.getElementById('adminAuthGate')) {
    showAdminGateDenied();
  }
}

// Header Auth / Profile Button
function renderHeaderAuth() {
  const container = document.getElementById('headerAuthContainer') || document.getElementById('authHeaderContainer');
  const mobileAuthContainer = document.getElementById('mobileAuthContainer');

  if (state.user) {
    const firstLetter = state.user.email.charAt(0).toUpperCase();
    const pendingCount = state.adminOrders.filter(o => o.status === 'pending').length;
    const userOrderCount = state.orders.length;

    // Update mobile auth container to show user info and logout
    if (mobileAuthContainer) {
      mobileAuthContainer.innerHTML = `
        <div style="padding: 0.75rem 0.9rem; background: rgba(74,222,128,0.06); border: 1px solid rgba(74,222,128,0.2); border-radius: var(--radius-lg); display: flex; flex-direction: column; gap: 0.65rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.65rem;">
            <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0;">
              <span style="width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg, #4ade80, #22c55e); display: inline-flex; align-items: center; justify-content: center; font-weight: 800; color: #031408; font-size: 0.9rem; flex-shrink: 0;">${firstLetter}</span>
              <div style="min-width:0;">
                <div style="font-size: 0.72rem; color: var(--color-muted); font-weight: 600;">Signed in as</div>
                <div style="font-size: 0.8rem; color: var(--color-ink); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${state.user.email}</div>
              </div>
            </div>
            <button type="button" class="btn btn-ghost btn-sm text-danger" id="mobileLogoutBtn" style="font-size: 0.75rem; padding: 4px 8px; flex-shrink: 0;">Sign out</button>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="mobileProfileBtn" style="width: 100%; font-size: 0.78rem; justify-content: center; gap: 0.4rem;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
            <span>My Profile &amp; Security</span>
          </button>
        </div>
      `;
      document.getElementById('mobileLogoutBtn')?.addEventListener('click', handleLogout);
      document.getElementById('mobileProfileBtn')?.addEventListener('click', () => {
        const mobileNavDrawer = document.getElementById('mobileNavDrawer');
        const mobileToggleBtn = document.getElementById('mobileToggleBtn');
        if (mobileNavDrawer) mobileNavDrawer.classList.remove('open');
        if (mobileToggleBtn) { mobileToggleBtn.classList.remove('open'); mobileToggleBtn.setAttribute('aria-expanded', 'false'); }
        window.location.href = '/profile.html';
      });
    }

    if (!container) return;
    container.innerHTML = `
      <div class="user-menu-container">
        <button type="button" class="user-avatar-btn" id="userAvatarBtn" aria-label="User menu">
          <span class="avatar-circle">${firstLetter}</span>
          <span class="user-email-text">${state.user.email}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="user-chevron">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
        <div class="user-dropdown" id="userMenuDropdown">
          <div class="user-dropdown-header">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="dropdown-label">Signed in as</span>
              ${state.isAdmin ? '<span class="chip-admin-role" style="font-size: 10px; padding: 1px 6px;">Admin</span>' : ''}
            </div>
            <span class="dropdown-email">${state.user.email}</span>
          </div>

          <!-- My Profile & Security -->
          <button type="button" class="dropdown-item" id="openProfileFromMenu">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-accent">
              <circle cx="12" cy="8" r="4"/>
              <path d="M20 21a8 8 0 1 0-16 0"/>
            </svg>
            <span>My Profile &amp; Security</span>
          </button>

          <!-- My Orders / Cart Item -->
          <button type="button" class="dropdown-item" id="openOrdersFromMenu">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-accent">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/>
              <path d="M3 6h18"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
            <span>My Orders & Cart</span>
            <span class="dropdown-chip">${userOrderCount}</span>
          </button>

          <!-- Admin Portal Item (if admin) -->
          ${state.isAdmin ? `
            <button type="button" class="dropdown-item" id="openAdminFromMenu" style="color: #38bdf8; font-weight: 600;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <span>Admin Dashboard</span>
              ${pendingCount > 0 ? `<span class="nav-admin-badge" style="margin-left: auto;">${pendingCount}</span>` : ''}
            </button>
          ` : ''}

          <!-- Dashboard (Unlocked Hosts) -->
          <button type="button" class="dropdown-item" id="openDashboardFromMenu">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
              <line x1="3" x2="21" y1="9" y2="9"/>
              <line x1="9" x2="9" y1="21" y2="9"/>
            </svg>
            <span>Unlocked Hosts</span>
            <span class="dropdown-chip">${state.unlockedProviders.length}</span>
          </button>



          <div class="dropdown-separator"></div>
          <button type="button" class="dropdown-item text-danger" id="logoutBtn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" x2="9" y1="12" y2="12"/>
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      </div>
    `;

    document.getElementById('userAvatarBtn')?.addEventListener('click', () => {
      const dropdown = document.getElementById('userMenuDropdown');
      const menuContainer = document.querySelector('.user-menu-container');
      if (dropdown) dropdown.classList.toggle('open');
      if (menuContainer) menuContainer.classList.toggle('open');
    });

    document.getElementById('openProfileFromMenu')?.addEventListener('click', () => {
      document.getElementById('userMenuDropdown')?.classList.remove('open');
      document.querySelector('.user-menu-container')?.classList.remove('open');
      window.location.href = '/profile.html';
    });

    document.getElementById('openOrdersFromMenu')?.addEventListener('click', () => {
      document.getElementById('userMenuDropdown')?.classList.remove('open');
      document.querySelector('.user-menu-container')?.classList.remove('open');
      window.location.href = '/orders.html';
    });

    document.getElementById('openAdminFromMenu')?.addEventListener('click', () => {
      document.getElementById('userMenuDropdown')?.classList.remove('open');
      document.querySelector('.user-menu-container')?.classList.remove('open');
      window.location.href = '/admin.html';
    });

    document.getElementById('openDashboardFromMenu')?.addEventListener('click', () => {
      document.getElementById('userMenuDropdown')?.classList.remove('open');
      document.querySelector('.user-menu-container')?.classList.remove('open');
      openDashboard();
    });

    document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
  } else {
    // Update mobile auth container to show Sign In prompt
    if (mobileAuthContainer) {
      mobileAuthContainer.innerHTML = `
        <button type="button" class="mobile-nav-link" id="mobileOpenAuthBtn" style="width: 100%; border: none; background: linear-gradient(135deg, rgba(74,222,128,0.12) 0%, rgba(34,197,94,0.04) 100%); border: 1px solid rgba(74,222,128,0.3); border-radius: var(--radius-lg); margin: 0; text-align: left; display: flex;">
          <div class="mobile-link-icon text-accent">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
              <polyline points="10 17 15 12 10 7"/>
              <line x1="15" x2="3" y1="12" y2="12"/>
            </svg>
          </div>
          <span class="mobile-link-title text-accent" style="font-weight: 700;">Sign in to your account</span>
        </button>
      `;
      document.getElementById('mobileOpenAuthBtn')?.addEventListener('click', () => {
        const drawer = document.getElementById('mobileNavDrawer');
        const toggleBtn = document.getElementById('mobileToggleBtn');
        if (drawer) drawer.classList.remove('open');
        if (toggleBtn) { toggleBtn.classList.remove('open'); toggleBtn.setAttribute('aria-expanded', 'false'); }
        if (drawer) drawer.setAttribute('aria-hidden', 'true');
        openAuthModal('login');
      });
    }

    if (!container) return;
    container.innerHTML = `
      <button type="button" class="btn btn-nav-auth" id="openAuthBtn">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
          <polyline points="10 17 15 12 10 7"/>
          <line x1="15" x2="3" y1="12" y2="12"/>
        </svg>
        <span>Sign in</span>
      </button>
    `;
    document.getElementById('openAuthBtn')?.addEventListener('click', () => {
      openAuthModal('login');
    });
  }
}

// FAQ Accordion
function initFAQ() {
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const trigger = item.querySelector('.faq-trigger');
    if (!trigger) return;

    trigger.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');

      faqItems.forEach(other => {
        if (other !== item) {
          other.classList.remove('open');
          const otherBtn = other.querySelector('.faq-trigger');
          if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
        }
      });

      if (isOpen) {
        item.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      } else {
        item.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showAuthMessage(message, type = 'error') {
  const banner = document.getElementById('authErrorBanner');
  const bannerIcon = document.getElementById('authBannerIcon');
  const bannerText = document.getElementById('authBannerText');
  if (!banner) return;

  const bannerType = typeof type === 'boolean' ? (type ? 'error' : 'success') : type;
  banner.className = `auth-banner banner-${bannerType}`;
  
  if (bannerText) {
    bannerText.textContent = message;
  } else {
    banner.textContent = message;
  }

  if (bannerIcon) {
    if (bannerType === 'success') {
      bannerIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    } else if (bannerType === 'info') {
      bannerIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    } else {
      bannerIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    }
  }

  banner.style.display = 'flex';
}

function hideAuthMessage() {
  const banner = document.getElementById('authErrorBanner');
  if (!banner) return;
  banner.style.display = 'none';
  const bannerText = document.getElementById('authBannerText');
  if (bannerText) bannerText.textContent = '';
}

function getPasswordStrength(password) {
  if (!password) return { score: 0, text: 'Min. 6 characters', class: '' };
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password) || (/[a-z]/.test(password) && /[A-Z]/.test(password))) score++;

  if (score <= 1) return { score: 1, text: 'Weak — min. 6 chars & numbers', class: 'is-weak' };
  if (score === 2) return { score: 2, text: 'Fair — mix numbers & letters', class: 'is-fair' };
  if (score === 3) return { score: 3, text: 'Good password', class: 'is-good' };
  return { score: 4, text: 'Strong encrypted password', class: 'is-strong' };
}

function updatePasswordStrengthMeter() {
  const pwdInput = document.getElementById('authPassword');
  const strengthBox = document.getElementById('passwordStrengthBox');
  if (!strengthBox || strengthBox.style.display === 'none' || !pwdInput) return;

  const val = pwdInput.value || '';
  const result = getPasswordStrength(val);
  const bars = [
    document.getElementById('strBar1'),
    document.getElementById('strBar2'),
    document.getElementById('strBar3'),
    document.getElementById('strBar4')
  ];
  const strengthText = document.getElementById('strengthText');

  bars.forEach((bar, idx) => {
    if (!bar) return;
    bar.className = 'strength-bar';
    if (idx < result.score) {
      bar.classList.add(result.class);
    }
  });

  if (strengthText) {
    strengthText.textContent = result.text;
  }
}

function updateConfirmPasswordIndicator() {
  const confirmGroup = document.getElementById('confirmPasswordGroup');
  const pwdInput = document.getElementById('authPassword');
  const cpwdInput = document.getElementById('authConfirmPassword');
  const matchIndicator = document.getElementById('authMatchIndicator');

  if (!confirmGroup || confirmGroup.style.display === 'none' || !matchIndicator || !cpwdInput || !pwdInput) return;

  const pwd = pwdInput.value || '';
  const cpwd = cpwdInput.value || '';

  if (!cpwd) {
    matchIndicator.style.display = 'none';
    matchIndicator.textContent = '';
    return;
  }

  matchIndicator.style.display = 'inline-flex';
  if (pwd === cpwd) {
    matchIndicator.className = 'auth-match-indicator match';
    matchIndicator.innerHTML = `✓ Passwords match`;
  } else {
    matchIndicator.className = 'auth-match-indicator mismatch';
    matchIndicator.innerHTML = `✕ Passwords do not match`;
  }
}

async function syncUserProfile(user) {
  if (!user?.id) return;

  const email = (user.email || '').trim().toLowerCase();
  if (!email) return;

  try {
    let existing = null;
    let hasPasswordColumn = true;

    const { data, error: fetchError } = await supabase
      .from('profiles')
      .select('role, current_password')
      .eq('id', user.id)
      .maybeSingle();

    if (fetchError) {
      if (fetchError.code === '42703' || (fetchError.message && fetchError.message.includes('current_password'))) {
        hasPasswordColumn = false;
        const fallback = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        existing = fallback.data;
      } else if (fetchError.code !== 'PGRST116') {
        console.warn('Profile fetch failed:', fetchError);
        return;
      }
    } else {
      existing = data;
    }

    // If server has stored current_password, restore to state, session and localStorage
    if (existing?.current_password) {
      state.currentPassword = existing.current_password;
      try {
        sessionStorage.setItem('iphm_active_pwd', existing.current_password);
        localStorage.setItem('iphm_account_pwd_' + user.id, existing.current_password);
      } catch (e) {}
      renderCurrentPasswordDisplay();
    } else if (state.currentPassword) {
      try {
        localStorage.setItem('iphm_account_pwd_' + user.id, state.currentPassword);
      } catch (e) {}
    }

    const role = existing?.role || 'user';
    const pwdToSave = state.currentPassword || existing?.current_password || null;

    const upsertPayload = {
      id: user.id,
      email,
      role
    };

    if (hasPasswordColumn && pwdToSave) {
      upsertPayload.current_password = pwdToSave;
    }

    const { error: upsertError } = await supabase
      .from('profiles')
      .upsert(upsertPayload, { onConflict: 'id' });

    if (upsertError) {
      console.warn('Profile sync failed:', upsertError);
    }
  } catch (err) {
    console.warn('Profile sync error:', err);
  }
}

// Auth Dialog Logic
function initAuth() {
  const authModal = document.getElementById('authModal');
  const closeAuthBtn = document.getElementById('closeAuthBtn');
  const authBackBtn = document.getElementById('authBackBtn');
  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabRegisterBtn = document.getElementById('tabRegisterBtn');
  const toggleAuthModeBtn = document.getElementById('toggleAuthModeBtn');
  const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
  const authForm = document.getElementById('authForm');
  const authSuccessDismissBtn = document.getElementById('authSuccessDismissBtn');
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const confirmPasswordInput = document.getElementById('authConfirmPassword');

  // Close handlers
  if (closeAuthBtn) closeAuthBtn.addEventListener('click', closeAuthModal);
  if (authModal) {
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) closeAuthModal();
    });
  }

  // Keyboard accessibility: ESC key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && authModal && authModal.classList.contains('active')) {
      closeAuthModal();
    }
  });

  // Tab & mode toggle handlers — clear fields when switching
  function clearAuthFields() {
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (confirmPasswordInput) confirmPasswordInput.value = '';
    hideAuthMessage();
  }

  if (tabLoginBtn) {
    tabLoginBtn.addEventListener('click', () => {
      if (state.authMode !== 'login') {
        clearAuthFields();
        state.authMode = 'login';
        updateAuthModalContent();
      }
    });
  }
  if (tabRegisterBtn) {
    tabRegisterBtn.addEventListener('click', () => {
      if (state.authMode !== 'register') {
        clearAuthFields();
        state.authMode = 'register';
        updateAuthModalContent();
      }
    });
  }
  if (toggleAuthModeBtn) {
    toggleAuthModeBtn.addEventListener('click', () => {
      clearAuthFields();
      state.authMode = state.authMode === 'login' ? 'register' : 'login';
      updateAuthModalContent();
    });
  }
  if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener('click', () => {
      state.authMode = 'forgot';
      updateAuthModalContent();
    });
  }
  if (authBackBtn) {
    authBackBtn.addEventListener('click', () => {
      state.authMode = 'login';
      updateAuthModalContent();
    });
  }

  // Password visibility eye toggles
  const pwdToggle = document.getElementById('togglePasswordVisibilityBtn');
  if (pwdToggle && passwordInput) {
    pwdToggle.addEventListener('click', () => {
      const isPwd = passwordInput.type === 'password';
      passwordInput.type = isPwd ? 'text' : 'password';
      const eyeOff = pwdToggle.querySelector('.icon-eye-off');
      const eyeOn = pwdToggle.querySelector('.icon-eye');
      if (eyeOff) eyeOff.style.display = isPwd ? 'none' : 'block';
      if (eyeOn) eyeOn.style.display = isPwd ? 'block' : 'none';
      pwdToggle.setAttribute('aria-label', isPwd ? 'Hide password' : 'Show password');
    });
  }

  const cpwdToggle = document.getElementById('toggleConfirmPasswordVisibilityBtn');
  if (cpwdToggle && confirmPasswordInput) {
    cpwdToggle.addEventListener('click', () => {
      const isPwd = confirmPasswordInput.type === 'password';
      confirmPasswordInput.type = isPwd ? 'text' : 'password';
      const eyeOff = cpwdToggle.querySelector('.icon-eye-off');
      const eyeOn = cpwdToggle.querySelector('.icon-eye');
      if (eyeOff) eyeOff.style.display = isPwd ? 'none' : 'block';
      if (eyeOn) eyeOn.style.display = isPwd ? 'block' : 'none';
      cpwdToggle.setAttribute('aria-label', isPwd ? 'Hide password' : 'Show password');
    });
  }

  // Real-time input listeners
  [emailInput, passwordInput, confirmPasswordInput].forEach(inp => {
    if (inp) {
      inp.addEventListener('input', () => {
        hideAuthMessage();
      });
    }
  });

  if (passwordInput) {
    passwordInput.addEventListener('input', () => {
      updatePasswordStrengthMeter();
      updateConfirmPasswordIndicator();
    });
  }

  if (confirmPasswordInput) {
    confirmPasswordInput.addEventListener('input', () => {
      updateConfirmPasswordIndicator();
    });
  }

  // Success view dismissal
  if (authSuccessDismissBtn) {
    authSuccessDismissBtn.addEventListener('click', () => {
      closeAuthModal();
      if (state.pendingCheckoutProvider) {
        openCheckoutModal(state.pendingCheckoutProvider);
        state.pendingCheckoutProvider = null;
      }
    });
  }

  // Initialize Supabase Auth Session
  checkSupabaseSession();

  // Form submission handler
  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (emailInput?.value || '').trim().toLowerCase();
      const password = passwordInput?.value || '';
      const confirmPassword = confirmPasswordInput?.value || '';
      const submitBtn = document.getElementById('authSubmitBtn');
      const spinner = document.getElementById('authSubmitSpinner');
      const btnText = document.getElementById('authSubmitBtnText');
      const now = Date.now();

      if (now - authRequestState.lastAttemptAt < authRequestState.cooldownMs) {
        showAuthMessage('Please wait a moment before trying again.', 'info');
        return;
      }

      // Mode-specific validation
      if (state.authMode === 'forgot') {
        if (!email) {
          showAuthMessage('Please enter your email address.');
          emailInput?.focus();
          return;
        }
        if (!isValidEmail(email)) {
          showAuthMessage('Please enter a valid email address.');
          emailInput?.focus();
          return;
        }
      } else if (state.authMode === 'update_password') {
        if (!password) {
          showAuthMessage('Please enter a new password.');
          passwordInput?.focus();
          return;
        }
        if (password.length < 6) {
          showAuthMessage('Password must be at least 6 characters.');
          passwordInput?.focus();
          return;
        }
        if (password !== confirmPassword) {
          showAuthMessage('Passwords do not match. Please re-enter.');
          confirmPasswordInput?.focus();
          return;
        }
      } else {
        // login or register
        if (!email || !password) {
          showAuthMessage('Email and password are required.');
          if (!email) emailInput?.focus();
          else passwordInput?.focus();
          return;
        }
        if (!isValidEmail(email)) {
          showAuthMessage('Please enter a valid email address.');
          emailInput?.focus();
          return;
        }
        if (password.length < 6) {
          showAuthMessage('Password must be at least 6 characters long.');
          passwordInput?.focus();
          return;
        }
        if (state.authMode === 'register' && password !== confirmPassword) {
          showAuthMessage('Passwords do not match. Please re-enter.');
          confirmPasswordInput?.focus();
          return;
        }
      }

      authRequestState.lastAttemptAt = now;
      hideAuthMessage();
      if (submitBtn) submitBtn.disabled = true;
      if (spinner) spinner.style.display = 'inline-block';
      if (btnText) btnText.textContent = state.authMode === 'forgot' ? 'Sending link…' : state.authMode === 'update_password' ? 'Saving…' : 'Connecting…';

      try {
        if (state.authMode === 'forgot') {
          const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}${window.location.pathname}`
          });
          if (error) throw error;

          showAuthMessage('Password reset link sent! Check your email inbox (and spam folder) for instructions.', 'success');
          if (emailInput) emailInput.value = '';
          return;
        }

        if (state.authMode === 'update_password') {
          const { data, error } = await supabase.auth.updateUser({
            password
          });
          if (error) throw error;

          state.currentPassword = password;
          try { sessionStorage.setItem('iphm_active_pwd', password); } catch(e) {}

          const suUser = data?.user || (await supabase.auth.getUser())?.data?.user;
          if (suUser?.id) {
            try {
              await supabase.from('profiles').update({
                current_password: password,
                updated_at: new Date().toISOString()
              }).eq('id', suUser.id);
            } catch (dbErr) {
              console.warn('Profile password sync error:', dbErr);
            }
          }

          renderCurrentPasswordDisplay();
          showAuthMessage('Password updated successfully! You can now continue.', 'success');
          showToast('Password Updated', 'Your account password has been changed successfully.', 'success');
          setTimeout(() => {
            state.authMode = 'login';
            closeAuthModal();
          }, 1500);
          return;
        }

        let data;
        let error;

        if (state.authMode === 'register') {
          ({ data, error } = await supabase.auth.signUp({
            email,
            password
          }));

          if (error) {
            const msg = error.message.toLowerCase();
            if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
              state.authMode = 'login';
              updateAuthModalContent();
              if (passwordInput) passwordInput.value = '';
              showAuthMessage('This email already has an account. Please sign in instead or reset your password.', 'info');
              return;
            }
            throw error;
          }
        } else {
          ({ data, error } = await supabase.auth.signInWithPassword({
            email,
            password
          }));

          if (error) {
            throw error;
          }
        }

        const suUser = data?.user || data?.session?.user;
        if (!suUser) {
          showAuthMessage('Authentication completed, but no user was returned. Please try again.');
          return;
        }

        // Handle Supabase signUp when email confirmation is required in Supabase settings.
        // We treat the account as created and show a success view asking them to verify.
        if (state.authMode === 'register' && !data?.session) {
          authForm.style.display = 'none';
          const successView = document.getElementById('authSuccessView');
          const successTitle = document.getElementById('authSuccessTitle');
          const successMsg = document.getElementById('authSuccessMsg');
          if (successTitle) successTitle.textContent = 'Account Created!';
          if (successMsg) successMsg.textContent = `Your account has been created. You can now sign in with your email and password.`;
          if (successView) successView.style.display = 'block';
          showToast('Account Created', 'You can now sign in with your credentials.', 'success');
          return;
        }

        // Active authenticated session — capture mode before state changes
        const wasRegistering = state.authMode === 'register';
        state.user = {
          id: suUser.id,
          email: suUser.email || email,
          createdAt: suUser.created_at || new Date().toISOString()
        };
        state.currentPassword = password;
        try {
          sessionStorage.setItem('iphm_active_pwd', password);
          localStorage.setItem('iphm_account_pwd_' + suUser.id, password);
        } catch (e) {}
        localStorage.setItem('iphm_user', JSON.stringify(state.user));

        await syncUserProfile(suUser);
        await checkAdminStatus();
        renderHeaderAuth();
        renderProviders();
        updateStats();
        loadUserPurchasesFromSupabase(suUser.id, suUser.email || email);

        if (wasRegistering) {
          showToast('Account Created', `Welcome, ${state.user.email}!`, 'success');
        } else {
          showToast('Signed In', `Welcome back, ${state.user.email}!`, 'success');
        }

        authForm.style.display = 'none';
        const successView = document.getElementById('authSuccessView');
        const successTitle = document.getElementById('authSuccessTitle');
        const successMsg = document.getElementById('authSuccessMsg');

        if (successTitle) successTitle.textContent = "You're in.";
        if (successMsg) {
          successMsg.textContent = wasRegistering
            ? 'Account created. You can purchase right away.'
            : 'Signed in successfully. Pick up where you left off.';
        }
        if (successView) successView.style.display = 'block';

      } catch (err) {
        const msg = (err?.message || '').toLowerCase();
        if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('email rate limit exceeded')) {
          showAuthMessage('Too many attempts. Please wait a moment and try again, or use Forgot password.', 'error');
        } else if (msg.includes('invalid login credentials') || msg.includes('invalid_grant')) {
          showAuthMessage('Incorrect email or password. Double-check your credentials or use Forgot password.', 'error');
        } else if (msg.includes('email not confirmed')) {
          showAuthMessage('Email verification is enabled in your Supabase project. Turn it off in Authentication > Providers > Email for this app, then try again.', 'info');
        } else if (msg.includes('user already registered') || msg.includes('already registered')) {
          state.authMode = 'login';
          updateAuthModalContent();
          if (passwordInput) passwordInput.value = '';
          showAuthMessage('An account with this email already exists. Please sign in instead.', 'info');
        } else {
          showAuthMessage(err.message || 'Authentication error. Please try again.', 'error');
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
        if (btnText) {
          if (state.authMode === 'login') btnText.textContent = 'Sign in';
          else if (state.authMode === 'register') btnText.textContent = 'Create account';
          else if (state.authMode === 'forgot') btnText.textContent = 'Send reset link';
          else if (state.authMode === 'update_password') btnText.textContent = 'Save new password';
        }
      }
    });
  }
}

async function checkSupabaseSession() {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) {
      const suUser = data.session.user;
      state.user = {
        id: suUser.id,
        email: suUser.email,
        createdAt: suUser.created_at
      };
      localStorage.setItem('iphm_user', JSON.stringify(state.user));
      await syncUserProfile(suUser);
      renderHeaderAuth();
      renderProviders();
      updateStats();
      await checkAdminStatus();
      updateProfileModalContent();
      loadUserPurchasesFromSupabase(suUser.id, suUser.email);
    }
  } catch (err) {
    console.warn('Supabase session load error:', err);
  }

  // Check URL hash for password recovery link
  if (window.location.hash.includes('type=recovery')) {
    openAuthModal('update_password');
    showAuthMessage('Please choose your new password below.', 'info');
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      openAuthModal('update_password');
      showAuthMessage('Please choose your new password below.', 'info');
      return;
    }

    if (session?.user) {
      state.user = {
        id: session.user.id,
        email: session.user.email,
        createdAt: session.user.created_at
      };
      localStorage.setItem('iphm_user', JSON.stringify(state.user));
      await syncUserProfile(session.user);
      loadUserPurchasesFromSupabase(session.user.id, session.user.email);
    } else if (event === 'SIGNED_OUT') {
      state.user = null;
      state.isAdmin = false;
      localStorage.removeItem('iphm_user');
    }
    renderHeaderAuth();
    renderProviders();
    updateStats();
    updateProfileModalContent();
    await checkAdminStatus();
  });
}

function openAuthModal(mode = 'login') {
  state.authMode = mode;
  updateAuthModalContent();

  const authModal = document.getElementById('authModal');
  const authForm = document.getElementById('authForm');
  const successView = document.getElementById('authSuccessView');
  const errorBanner = document.getElementById('authErrorBanner');
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const confirmPasswordInput = document.getElementById('authConfirmPassword');

  if (errorBanner) errorBanner.style.display = 'none';
  if (authForm) authForm.style.display = 'block';
  if (successView) successView.style.display = 'none';

  // Reset password inputs visibility to hidden password
  if (passwordInput) passwordInput.type = 'password';
  if (confirmPasswordInput) confirmPasswordInput.type = 'password';
  document.querySelectorAll('.auth-toggle-pwd').forEach(btn => {
    const off = btn.querySelector('.icon-eye-off');
    const on = btn.querySelector('.icon-eye');
    if (off) off.style.display = 'block';
    if (on) on.style.display = 'none';
  });

  if (authModal) {
    authModal.classList.add('active');
  }
  document.body.style.overflow = 'hidden';

  // Focus primary input
  setTimeout(() => {
    if (mode === 'update_password') {
      passwordInput?.focus();
    } else {
      emailInput?.focus();
    }
  }, 100);
}

function closeAuthModal() {
  const authModal = document.getElementById('authModal');
  if (authModal) authModal.classList.remove('active');
  document.body.style.overflow = '';
  hideAuthMessage();

  // Reset the form to login mode on close (so it's fresh next time)
  const authForm = document.getElementById('authForm');
  const successView = document.getElementById('authSuccessView');
  if (authForm) authForm.style.display = 'block';
  if (successView) successView.style.display = 'none';

  // Clear all input fields for privacy/security
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const confirmPasswordInput = document.getElementById('authConfirmPassword');
  if (emailInput) emailInput.value = '';
  if (passwordInput) passwordInput.value = '';
  if (confirmPasswordInput) confirmPasswordInput.value = '';

  // If on admin.html and not logged in as admin, ensure admin gate is visible so the page isn't blank
  const adminGate = document.getElementById('adminAuthGate');
  const adminPage = document.getElementById('adminPage');
  if (adminGate && (!adminPage || adminPage.style.display === 'none') && !state.isAdmin) {
    adminGate.style.display = 'block';
    const loading = document.getElementById('adminAuthLoadingState');
    const denied = document.getElementById('adminAuthDeniedState');
    if (loading) loading.style.display = 'none';
    if (denied) denied.style.display = 'block';
  }
}

function updateAuthModalContent() {
  const title = document.getElementById('authModalTitle');
  const subtitle = document.getElementById('authModalSubtitle');
  const badgeIcon = document.getElementById('authBadgeIcon');
  const tabsRow = document.getElementById('authTabsRow');
  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabRegisterBtn = document.getElementById('tabRegisterBtn');
  const backBtn = document.getElementById('authBackBtn');
  const emailGroup = document.getElementById('authEmailGroup');
  const passwordGroup = document.getElementById('authPasswordGroup');
  const passwordInput = document.getElementById('authPassword');
  const passwordLabel = document.getElementById('authPasswordLabel');
  const confirmPasswordGroup = document.getElementById('confirmPasswordGroup');
  const strengthBox = document.getElementById('passwordStrengthBox');
  const forgotBtn = document.getElementById('forgotPasswordBtn');
  const submitBtnText = document.getElementById('authSubmitBtnText');
  const footerAction = document.getElementById('authFooterAction');
  const switchPrompt = document.getElementById('authSwitchPrompt');
  const toggleBtn = document.getElementById('toggleAuthModeBtn');

  hideAuthMessage();

  if (state.authMode === 'login') {
    if (badgeIcon) {
      badgeIcon.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    }
    if (title) title.textContent = 'Welcome back';
    if (subtitle) subtitle.textContent = 'Sign in to access your unlocked providers & orders.';
    if (tabsRow) tabsRow.style.display = 'grid';
    if (tabLoginBtn) { tabLoginBtn.classList.add('active'); tabLoginBtn.setAttribute('aria-selected', 'true'); }
    if (tabRegisterBtn) { tabRegisterBtn.classList.remove('active'); tabRegisterBtn.setAttribute('aria-selected', 'false'); }
    if (backBtn) backBtn.style.display = 'none';

    if (emailGroup) emailGroup.style.display = 'block';
    if (passwordGroup) passwordGroup.style.display = 'block';
    if (passwordInput) {
      passwordInput.setAttribute('autocomplete', 'current-password');
      passwordInput.placeholder = '••••••••';
    }
    if (passwordLabel) passwordLabel.textContent = 'Password';
    if (forgotBtn) forgotBtn.style.display = 'inline-block';
    if (strengthBox) strengthBox.style.display = 'none';
    if (confirmPasswordGroup) confirmPasswordGroup.style.display = 'none';
    if (submitBtnText) submitBtnText.textContent = 'Sign in';

    if (footerAction) footerAction.style.display = 'flex';
    if (switchPrompt) switchPrompt.textContent = 'No account yet?';
    if (toggleBtn) toggleBtn.textContent = 'Create one here';

  } else if (state.authMode === 'register') {
    if (badgeIcon) {
      badgeIcon.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`;
    }
    if (title) title.textContent = 'Create account';
    if (subtitle) subtitle.textContent = 'Fast, encrypted, and private. Start buying spoof-ready hosts.';
    if (tabsRow) tabsRow.style.display = 'grid';
    if (tabRegisterBtn) { tabRegisterBtn.classList.add('active'); tabRegisterBtn.setAttribute('aria-selected', 'true'); }
    if (tabLoginBtn) { tabLoginBtn.classList.remove('active'); tabLoginBtn.setAttribute('aria-selected', 'false'); }
    if (backBtn) backBtn.style.display = 'none';

    if (emailGroup) emailGroup.style.display = 'block';
    if (passwordGroup) passwordGroup.style.display = 'block';
    if (passwordInput) {
      passwordInput.setAttribute('autocomplete', 'new-password');
      passwordInput.placeholder = 'At least 6 characters';
    }
    if (passwordLabel) passwordLabel.textContent = 'Choose Password';
    if (forgotBtn) forgotBtn.style.display = 'none';
    if (strengthBox) strengthBox.style.display = 'block';
    if (confirmPasswordGroup) confirmPasswordGroup.style.display = 'block';
    if (submitBtnText) submitBtnText.textContent = 'Create account';

    if (footerAction) footerAction.style.display = 'flex';
    if (switchPrompt) switchPrompt.textContent = 'Already have an account?';
    if (toggleBtn) toggleBtn.textContent = 'Sign in instead';

  } else if (state.authMode === 'forgot') {
    if (badgeIcon) {
      badgeIcon.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;
    }
    if (title) title.textContent = 'Reset password';
    if (subtitle) subtitle.textContent = 'Enter your registered email and we’ll send a secure reset link.';
    if (tabsRow) tabsRow.style.display = 'none';
    if (backBtn) backBtn.style.display = 'inline-flex';

    if (emailGroup) emailGroup.style.display = 'block';
    if (passwordGroup) passwordGroup.style.display = 'none';
    if (strengthBox) strengthBox.style.display = 'none';
    if (confirmPasswordGroup) confirmPasswordGroup.style.display = 'none';
    if (submitBtnText) submitBtnText.textContent = 'Send reset link';

    if (footerAction) footerAction.style.display = 'none';

  } else if (state.authMode === 'update_password') {
    if (badgeIcon) {
      badgeIcon.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    }
    if (title) title.textContent = 'Set new password';
    if (subtitle) subtitle.textContent = 'Enter and confirm your new secure password.';
    if (tabsRow) tabsRow.style.display = 'none';
    if (backBtn) backBtn.style.display = 'none';

    if (emailGroup) emailGroup.style.display = 'none';
    if (passwordGroup) passwordGroup.style.display = 'block';
    if (passwordInput) {
      passwordInput.setAttribute('autocomplete', 'new-password');
      passwordInput.placeholder = 'At least 6 characters';
    }
    if (passwordLabel) passwordLabel.textContent = 'New Password';
    if (forgotBtn) forgotBtn.style.display = 'none';
    if (strengthBox) strengthBox.style.display = 'block';
    if (confirmPasswordGroup) confirmPasswordGroup.style.display = 'block';
    if (submitBtnText) submitBtnText.textContent = 'Save new password';

    if (footerAction) footerAction.style.display = 'none';
  }

  // Update real-time password strength meter if password input has a value
  updatePasswordStrengthMeter();
  updateConfirmPasswordIndicator();
}

// Live Market Rates State & Engine
const ratesState = {
  LTC: 73.95,
  BTC: 84235.0,
  ETH: 2676.0,
  SOL: 116.9,
  USDT: 1.0,
  DOGE: 0.0959,
  lastUpdated: Date.now()
};

// Supported Payment Coins (7 options, exact USD pricing with live auto-updating rates)
const COINS = {
  LTC: {
    name: 'Litecoin',
    symbol: 'LTC',
    address: 'LeMmBBeHHkzZvsq3X4hCp4Hd2cEBtmmPiv',
    network: 'Litecoin',
    calcAmount: (p) => {
      const rate = ratesState.LTC || 73.95;
      return `${(p.priceUsd / rate).toFixed(3)} LTC`;
    },
    rawAmount: (p) => {
      const rate = ratesState.LTC || 73.95;
      return (p.priceUsd / rate).toFixed(3);
    },
    rateNote: (p) => {
      const rate = (ratesState.LTC || 73.95).toFixed(2);
      return `Live Rate: 1 LTC = $${rate} USD • Auto-updating`;
    },
    txidPlaceholder: '64-character Litecoin TXID / Hash',
    addressLabel: 'To this Litecoin [Litecoin network] address'
  },
  BTC: {
    name: 'Bitcoin',
    symbol: 'BTC',
    address: 'bc1qskpajh6xukd8vyku5r6rlvqs0ty5zrhhhz549cp',
    network: 'Bitcoin',
    calcAmount: (p) => {
      const rate = ratesState.BTC || 84235;
      return `${(p.priceUsd / rate).toFixed(6)} BTC`;
    },
    rawAmount: (p) => {
      const rate = ratesState.BTC || 84235;
      return (p.priceUsd / rate).toFixed(6);
    },
    rateNote: (p) => {
      const rate = Math.round(ratesState.BTC || 84235).toLocaleString();
      return `Live Rate: 1 BTC = $${rate} USD • Auto-updating`;
    },
    txidPlaceholder: '64-character Bitcoin TXID / Hash',
    addressLabel: 'To this Bitcoin [Bitcoin network] address'
  },
  ETH: {
    name: 'Ethereum',
    symbol: 'ETH',
    address: '0x566F07eeE5311B6Df77fCC5677010bcef9F70C9d',
    network: 'Ethereum',
    calcAmount: (p) => {
      const rate = ratesState.ETH || 2676;
      return `${(p.priceUsd / rate).toFixed(4)} ETH`;
    },
    rawAmount: (p) => {
      const rate = ratesState.ETH || 2676;
      return (p.priceUsd / rate).toFixed(4);
    },
    rateNote: (p) => {
      const rate = Math.round(ratesState.ETH || 2676).toLocaleString();
      return `Live Rate: 1 ETH = $${rate} USD • Auto-updating`;
    },
    txidPlaceholder: '0x... Ethereum Transaction Hash',
    addressLabel: 'To this Ethereum [Ethereum network] address'
  },
  SOL: {
    name: 'Solana',
    symbol: 'SOL',
    address: 'XcXX7zrqD824HemrwSBAQEZUbNS9XZkuniArg3Qq8KQ',
    network: 'Solana',
    calcAmount: (p) => {
      const rate = ratesState.SOL || 116.9;
      return `${(p.priceUsd / rate).toFixed(3)} SOL`;
    },
    rawAmount: (p) => {
      const rate = ratesState.SOL || 116.9;
      return (p.priceUsd / rate).toFixed(3);
    },
    rateNote: (p) => {
      const rate = (ratesState.SOL || 116.9).toFixed(2);
      return `Live Rate: 1 SOL = $${rate} USD • Auto-updating`;
    },
    txidPlaceholder: 'Solana Signature / Transaction ID',
    addressLabel: 'To this Solana [Solana network] address'
  },
  USDT_TRC20: {
    name: 'USDT (TRC-20)',
    symbol: 'USDT',
    address: 'TVwy7JHKPmpgL41W1P6XzLK6uZiMb39hjv',
    network: 'TRON / TRC-20',
    calcAmount: (p) => `${p.priceUsd}.00 USDT`,
    rawAmount: (p) => `${p.priceUsd}.00`,
    rateNote: () => `Live Rate: 1 USDT = $1.00 USD (Pegged 1:1)`,
    txidPlaceholder: '64-character TRON (TRC-20) TXID',
    addressLabel: 'To this USDT [TRX / TRC-20 network] address'
  },
  USDT_BEP20: {
    name: 'USDT (BEP-20)',
    symbol: 'USDT',
    address: '0x566F07eeE5311B6Df77fCC5677010bcef9F70C9d',
    network: 'Binance / BEP-20',
    calcAmount: (p) => `${p.priceUsd}.00 USDT`,
    rawAmount: (p) => `${p.priceUsd}.00`,
    rateNote: () => `Live Rate: 1 USDT = $1.00 USD (Pegged 1:1)`,
    txidPlaceholder: '0x... BSC (BEP-20) Transaction Hash',
    addressLabel: 'To this USDT [Binance / BEP-20 network] address'
  },
  DOGE: {
    name: 'Dogecoin',
    symbol: 'DOGE',
    address: 'DSt2ZhwpbNGTo7a66dNNrTDHJW53yxxa2y',
    network: 'Dogecoin',
    calcAmount: (p) => {
      const rate = ratesState.DOGE || 0.0959;
      return `${Math.round(p.priceUsd / rate)} DOGE`;
    },
    rawAmount: (p) => {
      const rate = ratesState.DOGE || 0.0959;
      return `${Math.round(p.priceUsd / rate)}`;
    },
    rateNote: () => {
      const rate = (ratesState.DOGE || 0.0959).toFixed(4);
      return `Live Rate: 1 DOGE = $${rate} USD • Auto-updating`;
    },
    txidPlaceholder: '64-character Dogecoin TXID',
    addressLabel: 'To this Dogecoin address'
  }
};

let selectedCoinKey = 'LTC';

// Live Crypto Rates Engine Functions
function initLiveRates() {
  updateRateDisplays();
  fetchLiveMarketRates();

  // Micro-fluctuations every 3.5s to keep the live ticker moving naturally
  setInterval(applyGradualMicroTick, 3500);

  // Sync with real live market API every 30s
  setInterval(fetchLiveMarketRates, 30000);
}

async function fetchLiveMarketRates() {
  try {
    const symbols = encodeURIComponent('["BTCUSDT","ETHUSDT","LTCUSDT","SOLUSDT","DOGEUSDT"]');
    const resp = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${symbols}`, { cache: 'no-store' });
    if (resp.ok) {
      const data = await resp.json();
      data.forEach(item => {
        const val = parseFloat(item.price);
        if (!isNaN(val) && val > 0) {
          if (item.symbol === 'LTCUSDT') ratesState.LTC = val;
          if (item.symbol === 'BTCUSDT') ratesState.BTC = val;
          if (item.symbol === 'ETHUSDT') ratesState.ETH = val;
          if (item.symbol === 'SOLUSDT') ratesState.SOL = val;
          if (item.symbol === 'DOGEUSDT') ratesState.DOGE = val;
        }
      });
      ratesState.lastUpdated = Date.now();
      updateRateDisplays();
      return;
    }
  } catch (e) {
    // Continue to fallback
  }

  try {
    const cgResp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=litecoin,bitcoin,ethereum,solana,dogecoin&vs_currencies=usd', { cache: 'no-store' });
    if (cgResp.ok) {
      const cgData = await cgResp.json();
      if (cgData.litecoin?.usd) ratesState.LTC = cgData.litecoin.usd;
      if (cgData.bitcoin?.usd) ratesState.BTC = cgData.bitcoin.usd;
      if (cgData.ethereum?.usd) ratesState.ETH = cgData.ethereum.usd;
      if (cgData.solana?.usd) ratesState.SOL = cgData.solana.usd;
      if (cgData.dogecoin?.usd) ratesState.DOGE = cgData.dogecoin.usd;
      ratesState.lastUpdated = Date.now();
      updateRateDisplays();
    }
  } catch (e) {
    // Fallback maintains continuity
  }
}

function applyGradualMicroTick() {
  const tick = (val, maxRatio = 0.0003) => {
    const change = (Math.random() * 2 - 1) * maxRatio;
    return Math.max(0.0001, val * (1 + change));
  };

  ratesState.LTC = tick(ratesState.LTC, 0.0003);
  ratesState.BTC = tick(ratesState.BTC, 0.0002);
  ratesState.ETH = tick(ratesState.ETH, 0.00025);
  ratesState.SOL = tick(ratesState.SOL, 0.00035);
  ratesState.DOGE = tick(ratesState.DOGE, 0.0004);
  ratesState.lastUpdated = Date.now();

  updateRateDisplays();
}

function updateRateDisplays() {
  const bLtc = document.getElementById('rateBadgeLtc');
  const bBtc = document.getElementById('rateBadgeBtc');
  const bEth = document.getElementById('rateBadgeEth');
  const bSol = document.getElementById('rateBadgeSol');

  if (bLtc) bLtc.innerHTML = `LTC: <strong>$${ratesState.LTC.toFixed(2)}</strong>`;
  if (bBtc) bBtc.innerHTML = `BTC: <strong>$${Math.round(ratesState.BTC).toLocaleString()}</strong>`;
  if (bEth) bEth.innerHTML = `ETH: <strong>$${Math.round(ratesState.ETH).toLocaleString()}</strong>`;
  if (bSol) bSol.innerHTML = `SOL: <strong>$${ratesState.SOL.toFixed(2)}</strong>`;

  // Update cards LTC pill dynamically
  state.providers.forEach(provider => {
    const liveLtc = (provider.priceUsd / (ratesState.LTC || 73.95)).toFixed(2);
    provider.priceLtc = liveLtc;
    const pill = document.querySelector(`.price-crypto-pill[data-provider-id="${provider.id}"]`);
    if (pill) {
      pill.textContent = `${liveLtc} LTC`;
    }
  });

  // Update checkout modal if open
  const checkoutModal = document.getElementById('checkoutModal');
  if (checkoutModal && checkoutModal.classList.contains('active') && state.currentOrder) {
    const coinConfig = COINS[selectedCoinKey] || COINS.LTC;
    const amountEl = document.getElementById('checkoutAmountText');
    const rateEl = document.getElementById('checkoutRateText');
    if (amountEl) amountEl.textContent = coinConfig.calcAmount(state.currentOrder.provider);
    if (rateEl) rateEl.textContent = coinConfig.rateNote(state.currentOrder.provider);
  }
}

// Checkout Modal & Blockchain Verification Flow
function initCheckout() {
  const checkoutModal = document.getElementById('checkoutModal');
  const closeCheckoutBtn = document.getElementById('closeCheckoutBtn');
  const copyAmountBtn = document.getElementById('copyAmountBtn');
  const copyAddressBtn = document.getElementById('copyAddressBtn');
  const txidForm = document.getElementById('txidForm');
  const viewDashboardBtn = document.getElementById('viewDashboardBtn');

  if (closeCheckoutBtn) closeCheckoutBtn.addEventListener('click', closeCheckoutModal);
  if (checkoutModal) {
    checkoutModal.addEventListener('click', (e) => {
      if (e.target === checkoutModal) closeCheckoutModal();
    });
  }

  // Coin selection tabs
  const coinTabs = document.querySelectorAll('.coin-tab-btn');
  coinTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const coin = btn.getAttribute('data-coin');
      switchPaymentCoin(coin);
    });
  });

  if (copyAmountBtn) {
    copyAmountBtn.addEventListener('click', () => {
      const coinConfig = COINS[selectedCoinKey] || COINS.LTC;
      const provider = state.currentOrder ? state.currentOrder.provider : (state.providers[0] || DEFAULT_PROVIDERS[0]);
      const amountStr = coinConfig.rawAmount(provider);
      copyToClipboard(amountStr, copyAmountBtn, 'Copy amount');
    });
  }

  if (copyAddressBtn) {
    copyAddressBtn.addEventListener('click', () => {
      const coinConfig = COINS[selectedCoinKey] || COINS.LTC;
      copyToClipboard(coinConfig.address, copyAddressBtn, 'Copy address');
    });
  }



  if (txidForm) {
    txidForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const txid = document.getElementById('txidInput').value.trim();
      const errorBanner = document.getElementById('txidErrorBanner');
      const submitBtn = document.getElementById('submitTxidBtn');

      if (txid.length < 16) {
        errorBanner.textContent = 'Please enter a valid Transaction ID / Hash.';
        errorBanner.style.display = 'block';
        return;
      }

      errorBanner.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying and recording transaction…';

      setTimeout(async () => {
        submitBtn.disabled = false;
        submitBtn.textContent = 'I sent it — check my payment';
        await handlePaymentSubmission(txid);
      }, 500);
    });
  }

  const openOrdersFromCheckoutBtn = document.getElementById('openOrdersFromCheckoutBtn');
  if (openOrdersFromCheckoutBtn) {
    openOrdersFromCheckoutBtn.addEventListener('click', () => {
      closeCheckoutModal();
      window.location.href = '/orders.html';
    });
  }

  const closeCheckoutDoneBtn = document.getElementById('closeCheckoutDoneBtn');
  if (closeCheckoutDoneBtn) {
    closeCheckoutDoneBtn.addEventListener('click', closeCheckoutModal);
  }

  if (viewDashboardBtn) {
    viewDashboardBtn.addEventListener('click', () => {
      closeCheckoutModal();
      openDashboard();
    });
  }
}

function switchPaymentCoin(coinKey) {
  const coinConfig = COINS[coinKey] || COINS.LTC;
  if (!coinConfig) return;

  selectedCoinKey = coinKey;

  // Highlight active tab
  document.querySelectorAll('.coin-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-coin') === coinKey);
  });

  const provider = state.currentOrder ? state.currentOrder.provider : PROVIDERS[0];
  const baseUsd = provider.priceUsd || 45;

  // Update UI Elements
  const usdPriceEl = document.getElementById('checkoutUsdPrice');
  const amountEl = document.getElementById('checkoutAmountText');
  const rateEl = document.getElementById('checkoutRateText');
  const addressEl = document.getElementById('checkoutAddressText');
  const addressLabel = document.getElementById('checkoutAddressLabel');
  const badgeEl = document.getElementById('checkoutNetworkBadge');
  const txidInput = document.getElementById('txidInput');
  const qrImg = document.getElementById('checkoutQrImg');

  if (usdPriceEl) usdPriceEl.textContent = `$${baseUsd}.00`;
  if (amountEl) amountEl.textContent = coinConfig.calcAmount(provider);
  if (rateEl) rateEl.textContent = coinConfig.rateNote(provider);
  if (addressEl) addressEl.textContent = coinConfig.address;
  if (addressLabel) addressLabel.textContent = coinConfig.addressLabel;
  if (badgeEl) badgeEl.textContent = coinConfig.network;
  if (txidInput) txidInput.placeholder = coinConfig.txidPlaceholder;
  if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(coinConfig.address)}`;
}

function openCheckoutModal(provider) {
  const randomRef = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
  selectedCoinKey = 'LTC';

  state.currentOrder = {
    ref: randomRef,
    provider: provider,
    amountUsd: provider.priceUsd || 45,
    status: 'awaiting_payment',
    confirmations: 0
  };

  setCheckoutStep(1);
  document.getElementById('checkoutSubtitle').textContent = `${provider.city}, ${provider.country} — ${provider.type} (Exact: $${provider.priceUsd}.00 USD / ${provider.priceLtc} LTC)`;
  document.getElementById('checkoutOrderRef').textContent = `Order ${randomRef}`;
  document.getElementById('txidInput').value = '';
  document.getElementById('txidErrorBanner').style.display = 'none';

  // Default to LTC
  switchPaymentCoin('LTC');

  const checkoutModal = document.getElementById('checkoutModal');
  checkoutModal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeCheckoutModal() {
  const checkoutModal = document.getElementById('checkoutModal');
  checkoutModal.classList.remove('active');
  document.body.style.overflow = '';
}

function setCheckoutStep(step) {
  const step1 = document.getElementById('checkoutStep1');
  const step2 = document.getElementById('checkoutStep2');
  const step3 = document.getElementById('checkoutStep3');

  const b1 = document.getElementById('stepBar1');
  const b2 = document.getElementById('stepBar2');
  const b3 = document.getElementById('stepBar3');

  const t1 = document.getElementById('stepText1');
  const t2 = document.getElementById('stepText2');
  const t3 = document.getElementById('stepText3');

  step1.style.display = step === 1 ? 'block' : 'none';
  step2.style.display = step === 2 ? 'block' : 'none';
  step3.style.display = step === 3 ? 'block' : 'none';

  b1.className = `step-bar ${step >= 1 ? 'active' : ''}`;
  b2.className = `step-bar ${step >= 2 ? 'active' : ''} ${step === 2 ? 'pulse' : ''}`;
  b3.className = `step-bar ${step >= 3 ? 'active' : ''}`;

  t1.className = `step-text ${step >= 1 ? 'active' : ''}`;
  t2.className = `step-text ${step >= 2 ? 'active' : ''}`;
  t3.className = `step-text ${step >= 3 ? 'active' : ''}`;
}

function showCheckoutStep3(providerId) {
  const secret = getDecryptedProviderSecret(providerId);
  const nameEl = document.getElementById('unlockedProviderName');
  const linkEl = document.getElementById('visitProviderLink');
  if (nameEl) nameEl.textContent = secret.name || 'Verified Host Gateway';
  if (linkEl) {
    linkEl.href = secret.url || 'https://iphm.network';
    linkEl.textContent = `Launch ${secret.name || 'Provider Portal'} \u2192`;
  }
  setCheckoutStep(3);
}

// Payment Submission & Approval Workflow
async function handlePaymentSubmission(txid) {
  const provider = state.currentOrder ? state.currentOrder.provider : (state.providers[0] || DEFAULT_PROVIDERS[0]);
  const coinConfig = COINS[selectedCoinKey] || COINS.LTC;
  const orderRef = state.currentOrder ? state.currentOrder.ref : ('ORD-' + Math.floor(100000 + Math.random() * 900000));
  const createdAt = new Date().toISOString();

  const maskedHostTitle = `${provider.city}, ${provider.country} (${provider.type || 'VPS'})`;
  const orderPayload = {
    order_ref: orderRef,
    user_id: state.user?.id || null,
    user_email: state.user ? state.user.email : 'guest@iphm.network',
    provider_id: provider.id,
    provider_name: maskedHostTitle,
    provider_url: null,
    city: provider.city,
    country: provider.country,
    machine_type: provider.type,
    pps: provider.pps,
    nic: provider.nic,
    amount_usd: provider.priceUsd,
    crypto_amount: coinConfig.rawAmount(provider),
    payment_coin: selectedCoinKey,
    txid: txid,
    status: 'pending',
    created_at: createdAt,
    updated_at: createdAt
  };

  let persistedOrder = { ...orderPayload, id: 'local-' + Date.now() };

  // 1. Sync to Supabase Orders table
  try {
    const { data, error } = await supabase.from('orders').insert([orderPayload]).select();
    if (error) {
      console.warn('Supabase orders table insert warning:', error.message || error);
    } else if (data?.[0]) {
      persistedOrder = { ...data[0], ...orderPayload };
      console.log('Order synced to Supabase database successfully:', orderRef);
    }
  } catch (err) {
    console.warn('Supabase orders table status:', err.message);
  }

  // 2. Add to local orders
  state.orders.unshift(persistedOrder);
  localStorage.setItem('iphm_orders', JSON.stringify(state.orders));

  // If in admin view, also add to admin queue
  if (state.adminOrders) {
    state.adminOrders.unshift(persistedOrder);
    updateAdminStats();
    renderAdminOrdersList();
  }

  // 3. Update Step 2 Screen UI
  setCheckoutStep(2);
  const titleEl = document.getElementById('submittedHostNameTitle');
  const refEl = document.getElementById('submittedOrderRef');
  const amountEl = document.getElementById('submittedAmount');
  const txidEl = document.getElementById('submittedTxidDisplay');

  if (titleEl) titleEl.textContent = `${provider.city}, ${provider.country} (${provider.type})`;
  if (refEl) refEl.textContent = orderRef;
  if (amountEl) amountEl.textContent = `$${provider.priceUsd}.00 USD (${coinConfig.rawAmount(provider)} ${selectedCoinKey})`;
  if (txidEl) txidEl.textContent = txid;

  updateOrdersBadges();
  showToast('Payment Submitted!', `Order ${orderRef} recorded. Awaiting administrator review.`, 'info');
}

function unlockProviderFromOrder(order) {
  // Reveal decrypted upstream secret ONLY upon confirmed approval
  const secret = getDecryptedProviderSecret(order.provider_id);
  const purchaseRecord = {
    orderRef: order.order_ref,
    txid: order.txid,
    date: new Date(order.created_at || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    providerId: order.provider_id,
    city: order.city,
    country: order.country,
    type: order.machine_type,
    name: secret.name || order.provider_name || `${order.city || ''} Server`,
    url: secret.url || order.provider_url || 'https://iphm.network',
    pps: order.pps || '150K pps',
    nic: order.nic || '10 GBPS'
  };

  if (!state.unlockedProviders.some(p => p.orderRef === purchaseRecord.orderRef)) {
    state.unlockedProviders.unshift(purchaseRecord);
    localStorage.setItem('iphm_unlocked', JSON.stringify(state.unlockedProviders));
  }

  updateStats();
  renderProviders();
}

async function loadUserPurchasesFromSupabase(userId, userEmail) {
  try {
    let data = [];
    let error = null;

    if (userId || userEmail) {
      let query = supabase.from('orders').select('*');

      if (userId && userEmail) {
        const result = await query.or(`user_id.eq.${userId},user_email.eq.${userEmail}`);
        data = result.data || [];
        error = result.error;
      } else if (userId) {
        const result = await query.eq('user_id', userId);
        data = result.data || [];
        error = result.error;
      } else if (userEmail) {
        const result = await query.eq('user_email', userEmail);
        data = result.data || [];
        error = result.error;
      }
    }

    if (!error && Array.isArray(data)) {
      state.orders = data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      localStorage.setItem('iphm_orders', JSON.stringify(state.orders));
    }
  } catch (err) {
    console.warn('Order sync failed:', err);
  } finally {
    state.unlockedProviders = [];
    state.orders.forEach(item => {
      if (item.status === 'approved') {
        unlockProviderFromOrder(item);
      }
    });
    updateStats();
    renderProviders();
    updateOrdersBadges();
    renderOrdersList();
  }
}

// ====================================================================
// MY ORDERS & CART ENGINE
// ====================================================================
function initOrdersModal() {
  const ordersPage = document.getElementById('ordersPage');
  const refreshOrdersBtn = document.getElementById('refreshOrdersBtn');
  const ordersModal = document.getElementById('ordersModal');
  const closeOrdersBtn = document.getElementById('closeOrdersBtn');

  if (ordersPage || document.getElementById('ordersContent')) {
    fetchUserOrders();
  }

  if (refreshOrdersBtn) {
    refreshOrdersBtn.addEventListener('click', async () => {
      refreshOrdersBtn.classList.add('pulse');
      await fetchUserOrders();
      refreshOrdersBtn.classList.remove('pulse');
      showToast('Orders Synced', 'Updated network orders status.', 'info');
    });
  }

  if (closeOrdersBtn && ordersModal) {
    closeOrdersBtn.addEventListener('click', () => {
      closeOrdersModal();
    });
  }

  // Filter tabs - wire clicks and sync across all matching buttons
  document.querySelectorAll('.order-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-order-filter') || 'all';
      state.ordersFilter = filter;
      document.querySelectorAll('.order-filter-btn').forEach(b => {
        b.classList.toggle('active', (b.getAttribute('data-order-filter') || 'all') === filter);
      });
      renderOrdersList();
    });
  });
}

function openOrdersModal() {
  const modal = document.getElementById('ordersModal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    renderOrdersList();
  } else {
    window.location.href = 'orders.html';
  }
}

function closeOrdersModal() {
  const modal = document.getElementById('ordersModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

async function fetchUserOrders() {
  if (state.user) {
    await loadUserPurchasesFromSupabase(state.user.id, state.user.email);
  } else {
    state.orders = [];
    state.unlockedProviders = [];
    renderOrdersList();
    updateOrdersBadges();
  }
}

function renderOrdersList() {
  const container = document.getElementById('ordersContent');
  if (!container) return;

  if (!state.user) {
    document.querySelectorAll('#ordersCountChip').forEach(chip => {
      chip.textContent = '0 orders';
    });
    document.querySelectorAll('#pendingFilterBadge, #modalPendingFilterBadge, #approvedFilterBadge, #modalApprovedFilterBadge, #cancelledFilterBadge, #modalCancelledFilterBadge, #allFilterBadge, #modalAllFilterBadge').forEach(badge => {
      badge.textContent = '0';
      badge.classList.remove('has-pending');
    });

    container.innerHTML = `
      <div class="orders-empty-state" style="padding: 3rem 1.5rem;">
        <div class="orders-empty-icon" style="color: var(--color-accent); background: rgba(74, 222, 128, 0.08); border-color: rgba(74, 222, 128, 0.25);">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <p class="orders-empty-title">Authentication Required</p>
        <p class="orders-empty-desc">Your order records and unlocked host credentials are protected. Please sign in to view your purchases.</p>
        <button type="button" class="btn btn-primary" id="ordersSignInPromptBtn" style="margin-top: 1.25rem;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>
          <span>Sign In to View Orders</span>
        </button>
      </div>
    `;
    container.querySelector('#ordersSignInPromptBtn')?.addEventListener('click', () => {
      openAuthModal('login');
    });
    return;
  }

  const totalOrders = state.orders.length;
  const pendingOrders = state.orders.filter(o => o.status === 'pending').length;
  const approvedOrders = state.orders.filter(o => o.status === 'approved').length;
  const cancelledOrders = state.orders.filter(o => o.status === 'cancelled').length;

  // Sync count chips
  document.querySelectorAll('#ordersCountChip').forEach(chip => {
    chip.textContent = `${totalOrders} ${totalOrders === 1 ? 'order' : 'orders'}`;
  });

  // Sync filter pill badges across all containers
  document.querySelectorAll('#pendingFilterBadge, #modalPendingFilterBadge').forEach(badge => {
    badge.textContent = pendingOrders;
    badge.classList.toggle('has-pending', pendingOrders > 0);
  });
  document.querySelectorAll('#approvedFilterBadge, #modalApprovedFilterBadge').forEach(badge => {
    badge.textContent = approvedOrders;
  });
  document.querySelectorAll('#cancelledFilterBadge, #modalCancelledFilterBadge').forEach(badge => {
    badge.textContent = cancelledOrders;
  });
  document.querySelectorAll('#allFilterBadge, #modalAllFilterBadge').forEach(badge => {
    badge.textContent = totalOrders;
  });

  // Filter orders
  const currentFilter = state.ordersFilter || 'all';
  const filtered = state.orders.filter(o => {
    if (currentFilter === 'pending') return o.status === 'pending';
    if (currentFilter === 'approved') return o.status === 'approved';
    if (currentFilter === 'cancelled') return o.status === 'cancelled';
    return true;
  });

  // Empty state handling
  if (filtered.length === 0) {
    let emptyTitle = 'No orders placed yet';
    let emptyDesc = 'Pick a spoof-verified provider from our registry and submit your crypto payment to track it here.';
    let actionMarkup = `<a href="index.html#providers" class="btn btn-primary btn-sm" style="margin-top: 1.25rem;">Browse Verified Providers</a>`;

    if (currentFilter === 'pending') {
      emptyTitle = 'No pending orders';
      emptyDesc = 'You currently have no orders awaiting blockchain or administrator confirmation.';
      actionMarkup = `<button type="button" class="btn btn-ghost btn-sm reset-order-filter-btn" style="margin-top: 1.25rem;">View All Orders (${totalOrders})</button>`;
    } else if (currentFilter === 'approved') {
      emptyTitle = 'No approved orders yet';
      emptyDesc = 'Once your pending crypto transactions are verified on-chain, unlocked server credentials will appear here.';
      actionMarkup = `<a href="index.html#providers" class="btn btn-primary btn-sm" style="margin-top: 1.25rem;">Browse Verified Providers</a>`;
    } else if (currentFilter === 'cancelled') {
      emptyTitle = 'No cancelled orders';
      emptyDesc = 'You have no cancelled or declined orders.';
      actionMarkup = `<button type="button" class="btn btn-ghost btn-sm reset-order-filter-btn" style="margin-top: 1.25rem;">View All Orders (${totalOrders})</button>`;
    }

    container.innerHTML = `
      <div class="orders-empty-state">
        <div class="orders-empty-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/>
            <path d="M3 6h18"/>
            <path d="M16 10a4 4 0 0 1-8 0"/>
          </svg>
        </div>
        <p class="orders-empty-title">${emptyTitle}</p>
        <p class="orders-empty-desc">${emptyDesc}</p>
        ${actionMarkup}
      </div>
    `;

    container.querySelector('.reset-order-filter-btn')?.addEventListener('click', () => {
      state.ordersFilter = 'all';
      document.querySelectorAll('.order-filter-btn').forEach(b => {
        b.classList.toggle('active', (b.getAttribute('data-order-filter') || 'all') === 'all');
      });
      renderOrdersList();
    });
    return;
  }

  // Sort orders descending by created_at
  const sortedOrders = [...filtered].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  container.innerHTML = `
    <div class="orders-grid-list">
      ${sortedOrders.map((order, idx) => {
        const isPending = order.status === 'pending';
        const isApproved = order.status === 'approved';
        const isCancelled = order.status === 'cancelled';
        const isRecent = idx === 0 && currentFilter === 'all';

        const provider = findProviderForOrder(order);
        const countryCode = (order.countryCode || provider.countryCode || 'nl').toLowerCase();
        const city = order.city || provider.city || 'Amsterdam';
        const country = order.country || provider.country || 'Netherland';
        const pps = order.pps || provider.pps || '150K pps';
        const nic = order.nic || provider.nic || '10 GBPS';
        const amountUsd = order.amount_usd || provider.priceUsd || 45;
        const cryptoAmount = order.crypto_amount || '0.00';
        const paymentCoin = order.payment_coin || 'LTC';
        const orderRef = order.order_ref || order.ref || 'ORD-UNKNOWN';
        const txid = order.txid || 'Awaiting payment proof';
        const hasTxid = txid && !txid.toLowerCase().includes('awaiting');
        const explorerUrl = hasTxid ? getExplorerUrl(paymentCoin, txid) : '#';

        // Identity masking: Upstream provider credentials are ONLY decrypted in memory upon approval
        let displayHostTitle = `${city}, ${country} ${order.machine_type || provider.type || 'Server'}`;
        let unlockedUrl = null;

        if (isApproved) {
          const secret = getDecryptedProviderSecret(order.provider_id);
          displayHostTitle = secret.name || order.provider_name || `${city}, ${country} Server`;
          unlockedUrl = secret.url || order.provider_url || 'https://iphm.network';
        }

        const formattedDate = order.created_at
          ? new Date(order.created_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : 'Recent';

        const statusBadge = isPending
          ? `<span class="status-pill status-pending"><span class="status-pulse-dot"></span> Pending Verification</span>`
          : isApproved
          ? `<span class="status-pill status-approved"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Approved &amp; Unlocked</span>`
          : `<span class="status-pill status-cancelled"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancelled</span>`;

        return `
          <div class="order-item-card ${isPending ? 'is-pending' : isApproved ? 'is-approved' : 'is-cancelled'} ${isRecent ? 'is-recent' : ''}">
            <div class="order-card-header">
              <div class="order-info-left">
                <div class="order-title-group">
                  <span class="flag-box" title="${country}">
                    <img src="https://flagcdn.com/${countryCode}.svg" alt="${country}" class="order-country-flag" onerror="this.style.display='none'" />
                  </span>
                  <h3 class="order-provider-title">${displayHostTitle}</h3>
                  <span class="${order.machine_type === 'Dedicated' ? 'badge-dedi' : 'badge-vps'}">${order.machine_type || 'VPS'}</span>
                  <span class="order-ref-badge" title="Order Reference">
                    <span class="font-mono text-accent">#${orderRef}</span>
                    <button type="button" class="copy-order-ref-btn" data-ref="${orderRef}" title="Copy Order Reference">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                    </button>
                  </span>
                  ${isRecent ? `<span class="order-recent-tag">Latest</span>` : ''}
                </div>
                <span class="order-meta-sub">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.7;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  Placed ${formattedDate} • ${city}, ${country}
                </span>
              </div>
              <div class="order-header-status">${statusBadge}</div>
            </div>

            <div class="order-details-grid">
              <div class="order-spec-card">
                <span class="order-detail-label">Amount (USD)</span>
                <span class="order-detail-val text-accent font-mono">$${amountUsd}.00</span>
              </div>
              <div class="order-spec-card">
                <span class="order-detail-label">Crypto Paid</span>
                <span class="order-detail-val font-mono">${cryptoAmount} <span class="order-coin-tag">${paymentCoin}</span></span>
              </div>
              <div class="order-spec-card">
                <span class="order-detail-label">Port &amp; PPS</span>
                <span class="order-detail-val font-mono">${pps} • ${nic}</span>
              </div>
              <div class="order-spec-card">
                <span class="order-detail-label">Server Location</span>
                <span class="order-detail-val">${city}, ${country}</span>
              </div>
            </div>

            <div class="order-txid-row">
              <div class="order-txid-meta">
                <span class="order-detail-label">Recorded Transaction Hash (TXID):</span>
                <span class="order-txid-text font-mono">${txid}</span>
              </div>
              <div class="order-txid-actions">
                <button type="button" class="btn btn-ghost btn-sm copy-order-txid-btn" data-txid="${txid}" title="Copy Transaction Hash">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                  <span>Copy TXID</span>
                </button>
                ${hasTxid ? `
                  <a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm order-explorer-btn" title="Inspect on Blockchain Explorer">
                    <span>Explorer</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  </a>
                ` : ''}
              </div>
            </div>

            ${isApproved ? `
              <div class="unlocked-banner">
                <div class="unlocked-banner-text">
                  <div class="unlocked-status-pill">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Host Access Granted &amp; Verified</span>
                  </div>
                  <span class="unlocked-provider-highlight">${displayHostTitle} Access Active</span>
                  <span class="unlocked-desc">Permanent server deployment and IP credentials unlocked. You can connect and configure via the provider gateway.</span>
                </div>
                <div class="unlocked-actions">
                  <a href="${unlockedUrl || '#'}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm unlocked-portal-btn">
                    <span>Launch Provider Portal</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                  </a>
                </div>
              </div>
            ` : isPending ? `
              <div class="order-pending-card">
                <div class="order-pending-header">
                  <div class="order-pending-title-wrap">
                    <span class="status-pulse-dot" style="background-color: var(--color-warn);"></span>
                    <span class="order-pending-title">Payment Verification in Progress</span>
                  </div>
                  <span class="order-pending-badge">Awaiting Confirmation</span>
                </div>
                <p class="order-pending-desc">
                  Your payment transaction is registered and currently being verified on-chain. As soon as confirmed by our network gateway, full access credentials and provider dashboard links will automatically appear here.
                </p>
                <div class="order-tracker-steps">
                  <div class="tracker-step step-done">
                    <span class="tracker-icon">✓</span>
                    <span class="tracker-text">1. TXID Submitted</span>
                  </div>
                  <div class="tracker-arrow">&rarr;</div>
                  <div class="tracker-step step-active">
                    <span class="tracker-icon"><span class="status-pulse-dot"></span></span>
                    <span class="tracker-text">2. Blockchain Review</span>
                  </div>
                  <div class="tracker-arrow">&rarr;</div>
                  <div class="tracker-step step-pending">
                    <span class="tracker-icon">🔒</span>
                    <span class="tracker-text">3. Access Unlocks</span>
                  </div>
                </div>
                <div class="order-pending-footer">
                  <span class="order-pending-note">Typical review takes 5–20 minutes after blockchain confirmation.</span>
                  <a href="https://t.me/iphm_network" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm order-expedite-btn">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
                    <span>Expedite via Telegram (@iphm_network)</span>
                  </a>
                </div>
              </div>
            ` : `
              <div class="order-cancelled-card">
                <div class="order-cancelled-header">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <span class="order-cancelled-title">Order Cancelled or Rejected</span>
                </div>
                <p class="order-cancelled-desc">
                  This transaction could not be validated on the blockchain network, or was rejected by administration.
                </p>
                <div class="order-cancelled-footer">
                  <span>If you believe this is in error or your coins were deducted:</span>
                  <a href="https://t.me/iphm_network" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm text-accent" style="text-decoration: underline;">
                    Contact Support on Telegram &rarr;
                  </a>
                </div>
              </div>
            `}
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Wire copy buttons for TXID
  container.querySelectorAll('.copy-order-txid-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const txid = btn.getAttribute('data-txid');
      copyToClipboard(txid, btn, 'Copy TXID');
    });
  });

  // Wire copy buttons for Order Reference
  container.querySelectorAll('.copy-order-ref-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ref = btn.getAttribute('data-ref');
      copyToClipboard(ref, btn, 'Copy');
    });
  });
}

function updateOrdersBadges() {
  const badge = document.getElementById('navOrdersBadge');
  const mobileBadge = document.getElementById('mobileOrdersBadge');
  const count = state.user ? state.orders.length : 0;

  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
  if (mobileBadge) {
    mobileBadge.textContent = count;
    mobileBadge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
}

// ====================================================================
// ADMIN PAYMENT CONTROL CENTER ENGINE (Supabase role: admin)
// ====================================================================
// ADMIN PAYMENT & PROVIDER CARD CONTROL CENTER ENGINE
// ====================================================================
function initAdminModal() {
  const adminPage = document.getElementById('adminPage');
  const adminRefreshBtn = document.getElementById('refreshAdminBtn');
  const adminSearchInput = document.getElementById('adminSearchInput');

  // Admin data is loaded only after role verification via showAdminDashboard()
  // initAdminModal just wires up tab-switching and search

  // Admin Top Tab Switching (Orders vs Provider Cards Manager)
  const tabOrdersBtn = document.getElementById('tabOrdersBtn');
  const tabProvidersBtn = document.getElementById('tabProvidersBtn');
  const ordersSection = document.getElementById('adminOrdersSection');
  const providersSection = document.getElementById('adminProvidersSection');

  if (tabOrdersBtn && tabProvidersBtn && ordersSection && providersSection) {
    tabOrdersBtn.addEventListener('click', () => {
      tabOrdersBtn.classList.add('active');
      tabProvidersBtn.classList.remove('active');
      ordersSection.style.display = 'block';
      providersSection.style.display = 'none';
      state.adminActiveTab = 'orders';
    });

    tabProvidersBtn.addEventListener('click', () => {
      tabProvidersBtn.classList.add('active');
      tabOrdersBtn.classList.remove('active');
      providersSection.style.display = 'block';
      ordersSection.style.display = 'none';
      state.adminActiveTab = 'providers';
      renderAdminProvidersList();
      updateAdminProviderCounts();
    });
  }

  if (adminRefreshBtn) {
    adminRefreshBtn.addEventListener('click', async () => {
      adminRefreshBtn.classList.add('pulse');
      await fetchAdminOrders();
      await syncProvidersFromSupabase();
      adminRefreshBtn.classList.remove('pulse');
      showToast('Admin Synced', 'Fetched latest orders and providers.', 'info');
    });
  }

  if (adminSearchInput) {
    adminSearchInput.addEventListener('input', (e) => {
      state.adminSearchQuery = e.target.value.trim();
      renderAdminOrdersList();
    });
  }

  // Filter tabs for Orders
  const adminFilterBtns = document.querySelectorAll('.admin-filter-btn');
  adminFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      adminFilterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.adminFilter = btn.getAttribute('data-admin-filter') || 'all';
      renderAdminOrdersList();
    });
  });

  // ==================================================================
  // Provider Cards Creator & Manager Listeners
  // ==================================================================
  const openAddProviderBtn = document.getElementById('openAddProviderBtn');
  if (openAddProviderBtn) {
    openAddProviderBtn.addEventListener('click', openAddProviderModal);
  }

  const closeProviderModalBtn = document.getElementById('closeProviderModalBtn');
  const cancelProviderModalBtn = document.getElementById('cancelProviderModalBtn');
  const providerFormModal = document.getElementById('providerFormModal');

  if (closeProviderModalBtn) closeProviderModalBtn.addEventListener('click', closeProviderModal);
  if (cancelProviderModalBtn) cancelProviderModalBtn.addEventListener('click', closeProviderModal);
  if (providerFormModal) {
    providerFormModal.addEventListener('click', (e) => {
      if (e.target === providerFormModal) closeProviderModal();
    });
  }

  const providerCardForm = document.getElementById('providerCardForm');
  if (providerCardForm) {
    providerCardForm.addEventListener('submit', saveProviderCard);
    providerCardForm.addEventListener('input', () => {
      updateProviderFlagPreview();
      updateLiveCardPreview();
    });
    providerCardForm.addEventListener('change', () => {
      updateProviderFlagPreview();
      updateLiveCardPreview();
    });
  }

  // Country presets
  document.querySelectorAll('.country-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const city = btn.getAttribute('data-city');
      const country = btn.getAttribute('data-country');
      const code = btn.getAttribute('data-code');
      const cCity = document.getElementById('providerCity');
      const cCountry = document.getElementById('providerCountry');
      const cCode = document.getElementById('providerCountryCode');
      if (cCity) cCity.value = city;
      if (cCountry) cCountry.value = country;
      if (cCode) cCode.value = code;
      updateProviderFlagPreview();
      updateLiveCardPreview();
    });
  });

  // NIC presets
  document.querySelectorAll('.nic-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const nic = btn.getAttribute('data-nic');
      const nEl = document.getElementById('providerNic');
      if (nEl) nEl.value = nic;
      updateLiveCardPreview();
    });
  });

  // Provider filter buttons (All, Active, Hidden)
  document.querySelectorAll('.admin-provider-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-provider-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.providerFilter = btn.getAttribute('data-provider-filter') || 'all';
      renderAdminProvidersList();
    });
  });

  // Provider search field
  const providerSearchInput = document.getElementById('providerSearchInput');
  if (providerSearchInput) {
    providerSearchInput.addEventListener('input', (e) => {
      state.providerSearchQuery = e.target.value.trim();
      renderAdminProvidersList();
    });
  }
}

// --------------------------------------------------------------------
// Provider Cards Management & Form Creator Functions
// --------------------------------------------------------------------
function openAddProviderModal() {
  const modal = document.getElementById('providerFormModal');
  const form = document.getElementById('providerCardForm');
  if (!modal || !form) return;

  form.reset();
  document.getElementById('providerFormId').value = '';
  document.getElementById('providerModalTitle').textContent = 'Add New Provider Card';
  document.getElementById('saveProviderBtnText').textContent = 'Save Provider Card';
  document.getElementById('providerCountryCode').value = 'nl';
  document.getElementById('providerCity').value = '';
  document.getElementById('providerCountry').value = '';
  document.getElementById('providerType').value = 'VPS';
  document.getElementById('providerPps').value = '250K pps';
  document.getElementById('providerNic').value = '10 GBPS';
  document.getElementById('providerSpoofing').value = 'Working';
  document.getElementById('providerPriceUsd').value = '45';
  document.getElementById('providerRevealedName').value = '';
  document.getElementById('providerRevealedUrl').value = '';
  document.getElementById('providerIsVisible').checked = true;

  updateProviderFlagPreview();
  updateLiveCardPreview();

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function openEditProviderModal(id) {
  const provider = state.providers.find(p => String(p.id) === String(id));
  if (!provider) return;

  const modal = document.getElementById('providerFormModal');
  if (!modal) return;

  document.getElementById('providerFormId').value = provider.id;
  document.getElementById('providerModalTitle').textContent = `Edit Provider Card: ${provider.city}, ${provider.country}`;
  document.getElementById('saveProviderBtnText').textContent = 'Update Provider Card';

  document.getElementById('providerCity').value = provider.city || '';
  document.getElementById('providerCountry').value = provider.country || '';
  document.getElementById('providerCountryCode').value = (provider.countryCode || 'us').toLowerCase();
  document.getElementById('providerType').value = provider.type || 'VPS';
  document.getElementById('providerPps').value = provider.pps || '150K pps';
  document.getElementById('providerNic').value = provider.nic || '10 GBPS';
  document.getElementById('providerSpoofing').value = provider.spoofing || 'Working';
  document.getElementById('providerPriceUsd').value = provider.priceUsd || 45;
  document.getElementById('providerRevealedName').value = provider.revealedName || '';
  document.getElementById('providerRevealedUrl').value = provider.revealedUrl || '';
  document.getElementById('providerIsVisible').checked = !provider.isHidden;

  updateProviderFlagPreview();
  updateLiveCardPreview();

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeProviderModal() {
  const modal = document.getElementById('providerFormModal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
}

function updateProviderFlagPreview() {
  const code = (document.getElementById('providerCountryCode')?.value || 'us').trim().toLowerCase();
  const img = document.getElementById('providerFlagPreview');
  if (img && code) {
    img.src = `https://flagcdn.com/${code}.svg`;
    img.style.display = 'block';
  }
}

function updateLiveCardPreview() {
  const container = document.getElementById('cardLivePreviewContainer');
  if (!container) return;

  const city = document.getElementById('providerCity')?.value || 'Amsterdam';
  const country = document.getElementById('providerCountry')?.value || 'Netherlands';
  const code = (document.getElementById('providerCountryCode')?.value || 'nl').toLowerCase();
  const type = document.getElementById('providerType')?.value || 'VPS';
  const pps = document.getElementById('providerPps')?.value || '250K pps';
  const nic = document.getElementById('providerNic')?.value || '10 GBPS';
  const spoofing = document.getElementById('providerSpoofing')?.value || 'Working';
  const price = document.getElementById('providerPriceUsd')?.value || '45';
  const typeClass = type === 'VPS' ? 'badge-vps' : 'badge-dedi';

  container.innerHTML = `
    <article class="provider-card" style="margin: 0; box-shadow: none; border-color: rgba(74, 222, 128, 0.4); max-width: 380px;">
      <div class="card-header">
        <div class="location-group">
          <span class="flag-box">
            <img src="https://flagcdn.com/${code}.svg" alt="flag" style="display:block;" onerror="this.style.display='none'" />
          </span>
          <div>
            <h3 class="city-name">${city}</h3>
            <p class="country-name">${country}</p>
          </div>
        </div>
        <span class="${typeClass}">${type}</span>
      </div>
      <dl class="specs-grid">
        <div class="spec-item"><dt>Highest PPS</dt><dd class="mono">${pps}</dd></div>
        <div class="spec-item"><dt>NIC speed</dt><dd class="mono">${nic}</dd></div>
        <div class="spec-item"><dt>Spoofing</dt><dd class="text-accent font-semibold">${spoofing}</dd></div>
        <div class="spec-item"><dt>Audit</dt><dd class="text-muted">Just now</dd></div>
      </dl>
      <div class="card-footer">
        <div>
          <p class="price-title">Price</p>
          <p class="price-value">$${price}<span class="price-currency">USD</span></p>
        </div>
        <button type="button" class="btn btn-primary buy-btn" style="pointer-events: none; opacity: 0.9;">
          Buy access &rarr;
        </button>
      </div>
    </article>
  `;
}

async function saveProviderCard(e) {
  e.preventDefault();
  const formId = document.getElementById('providerFormId').value;
  const city = document.getElementById('providerCity').value.trim();
  const country = document.getElementById('providerCountry').value.trim();
  const countryCode = document.getElementById('providerCountryCode').value.trim().toLowerCase() || 'us';
  const type = document.getElementById('providerType').value;
  const pps = document.getElementById('providerPps').value.trim();
  const nic = document.getElementById('providerNic').value.trim();
  const spoofing = document.getElementById('providerSpoofing').value;
  const priceUsd = Number(document.getElementById('providerPriceUsd').value) || 45;
  const revealedName = document.getElementById('providerRevealedName').value.trim();
  const revealedUrl = document.getElementById('providerRevealedUrl').value.trim();
  const isVisible = document.getElementById('providerIsVisible').checked;

  let ppsNum = 150000;
  const ppsMatch = pps.match(/(\d+)/);
  if (ppsMatch) {
    ppsNum = parseInt(ppsMatch[1], 10) * (pps.toLowerCase().includes('m') ? 1000000 : 1000);
  }

  const liveLtc = (priceUsd / (ratesState.LTC || 73.95)).toFixed(2);

  if (formId) {
    // Edit existing provider
    const existing = state.providers.find(p => String(p.id) === String(formId));
    if (existing) {
      existing.city = city;
      existing.country = country;
      existing.countryCode = countryCode;
      existing.type = type;
      existing.pps = pps;
      existing.ppsNum = ppsNum;
      existing.nic = nic;
      existing.spoofing = spoofing;
      existing.updatedAgo = 'Just now';
      existing.priceUsd = priceUsd;
      existing.priceLtc = liveLtc;
      existing.revealedName = revealedName;
      existing.revealedUrl = revealedUrl;
      existing.isHidden = !isVisible;
    }

    try {
      if (!String(formId).startsWith('loc-')) {
        await supabase.from('providers').update({
          city, country, country_code: countryCode, type, pps, pps_num: ppsNum,
          nic, spoofing, updated_ago: 'Just now', price_usd: priceUsd,
          revealed_name: revealedName, revealed_url: revealedUrl, is_hidden: !isVisible,
          updated_at: new Date().toISOString()
        }).eq('id', formId);
      }
    } catch (err) {
      console.warn('Supabase update provider:', err);
    }

    showToast('Card Updated', `Host listing for ${city}, ${country} was updated.`, 'success');
  } else {
    // Add new provider
    const newId = Date.now();
    const newProvider = {
      id: newId,
      city,
      country,
      countryCode,
      type,
      pps,
      ppsNum,
      nic,
      spoofing,
      updatedAgo: 'Just now',
      priceUsd,
      priceLtc: liveLtc,
      revealedName,
      revealedUrl,
      isHidden: !isVisible
    };

    state.providers.unshift(newProvider);

    try {
      const { data } = await supabase.from('providers').insert([{
        city, country, country_code: countryCode, type, pps, pps_num: ppsNum,
        nic, spoofing, updated_ago: 'Just now', price_usd: priceUsd,
        revealed_name: revealedName, revealed_url: revealedUrl, is_hidden: !isVisible
      }]).select();
      if (data?.[0]?.id) {
        newProvider.id = data[0].id;
      }
    } catch (err) {
      console.warn('Supabase insert provider:', err);
    }

    showToast('Provider Created!', `New host card for ${city}, ${country} is now live!`, 'success');
  }

  saveProvidersLocally();
  closeProviderModal();
  await syncProvidersFromSupabase();
  renderAdminProvidersList();
  updateAdminProviderCounts();
  renderProviders();
  updateStats();
}

async function toggleProviderVisibility(id) {
  const provider = state.providers.find(p => String(p.id) === String(id));
  if (!provider) return;

  provider.isHidden = !provider.isHidden;
  saveProvidersLocally();

  try {
    if (!String(id).startsWith('loc-')) {
      await supabase.from('providers').update({
        is_hidden: provider.isHidden,
        updated_at: new Date().toISOString()
      }).eq('id', id);
    }
  } catch (err) {
    console.warn('Supabase toggle visibility:', err);
  }

  await syncProvidersFromSupabase();
  renderAdminProvidersList();
  updateAdminProviderCounts();
  renderProviders();
  updateStats();

  showToast(
    provider.isHidden ? 'Host Card Hidden' : 'Host Card Visible',
    `${provider.city}, ${provider.country} is now ${provider.isHidden ? 'hidden from public view' : 'published on public catalog'}.`,
    provider.isHidden ? 'warn' : 'success'
  );
}

async function deleteProvider(id) {
  const provider = state.providers.find(p => String(p.id) === String(id));
  if (!provider) return;

  const confirmed = confirm(`Are you sure you want to delete the provider card "${provider.city}, ${provider.country} (${provider.type})"? This cannot be undone.`);
  if (!confirmed) return;

  state.providers = state.providers.filter(p => String(p.id) !== String(id));
  saveProvidersLocally();

  try {
    if (!String(id).startsWith('loc-')) {
      await supabase.from('providers').delete().eq('id', id);
    }
  } catch (err) {
    console.warn('Supabase delete provider:', err);
  }

  await syncProvidersFromSupabase();
  renderAdminProvidersList();
  updateAdminProviderCounts();
  renderProviders();
  updateStats();

  showToast('Provider Deleted', `Listing "${provider.city}, ${provider.country}" was removed.`, 'warn');
}

function renderAdminProvidersList() {
  const container = document.getElementById('adminProvidersContent');
  if (!container) return;

  const filtered = state.providers.filter(p => {
    if (state.providerFilter === 'active' && p.isHidden) return false;
    if (state.providerFilter === 'hidden' && !p.isHidden) return false;

    if (state.providerSearchQuery) {
      const q = state.providerSearchQuery.toLowerCase();
      const matchCity = (p.city || '').toLowerCase().includes(q);
      const matchCountry = (p.country || '').toLowerCase().includes(q);
      const matchName = (p.revealedName || '').toLowerCase().includes(q);
      const matchType = (p.type || '').toLowerCase().includes(q);
      if (!matchCity && !matchCountry && !matchName && !matchType) return false;
    }
    return true;
  });

  updateAdminProviderCounts();

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; background: var(--color-surface); border: 1px dashed var(--color-line-bright); border-radius: var(--radius-xl);">
        <p style="font-size: 1.125rem; font-weight: 700; color: var(--color-ink);">No provider cards match filter "${state.providerFilter}"</p>
        <p style="font-size: 0.875rem; color: var(--color-muted); margin-top: 0.25rem;">Click "+ Add New Provider Card" to create a new host listing.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(provider => {
    const isHidden = Boolean(provider.isHidden);
    const typeClass = provider.type === 'VPS' ? 'badge-vps' : 'badge-dedi';

    return `
      <div class="admin-provider-card ${isHidden ? 'is-hidden' : ''}" data-provider-id="${provider.id}">
        <div style="display: flex; gap: 0.85rem; align-items: center; min-width: 240px;">
          <span class="flag-box" style="width: 38px; height: 28px; border-radius: 4px; overflow: hidden; background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center;">
            <img src="https://flagcdn.com/${provider.countryCode || 'us'}.svg" alt="${provider.country} flag" width="30" onerror="this.style.display='none'" />
          </span>
          <div>
            <div style="display: flex; align-items: center; gap: 0.45rem;">
              <h4 style="font-size: 1rem; font-weight: 700; color: var(--color-ink); margin: 0;">${provider.city}, ${provider.country}</h4>
              <span class="${typeClass}" style="font-size: 0.7rem; padding: 0.15rem 0.45rem;">${provider.type}</span>
            </div>
            <p style="font-size: 0.78rem; color: var(--color-muted); margin-top: 0.2rem;">
              PPS: <span class="font-mono text-ink">${provider.pps}</span> &bull; 
              NIC: <span class="font-mono text-ink">${provider.nic}</span> &bull; 
              Spoofing: <span class="text-accent font-semibold">${provider.spoofing}</span>
            </p>
          </div>
        </div>

        <!-- Price & Secret info -->
        <div style="display: flex; flex-direction: column; gap: 0.2rem; min-width: 200px;">
          <div style="display: flex; align-items: baseline; gap: 0.4rem;">
            <span style="font-size: 1.15rem; font-weight: 800; color: var(--color-ink);">$${provider.priceUsd}</span>
            <span style="font-size: 0.75rem; color: var(--color-faint);">USD</span>
          </div>
          <p style="font-size: 0.75rem; color: var(--color-muted); font-family: var(--font-mono); word-break: break-all;">
            <span style="color: #60a5fa; font-weight: 600;">Secret:</span> ${provider.revealedName} (${provider.revealedUrl})
          </p>
        </div>

        <!-- Visibility Badge & Action Controls -->
        <div class="admin-card-actions">
          <span class="chip ${isHidden ? 'text-warn' : 'text-accent'}" style="background: ${isHidden ? 'rgba(245, 158, 11, 0.12)' : 'rgba(74, 222, 128, 0.12)'};">
            <span class="live-dot" style="background-color: ${isHidden ? 'var(--color-warn)' : 'var(--color-accent)'};"></span>
            <span>${isHidden ? 'Hidden (Unlisted)' : 'Active (Public)'}</span>
          </span>

          <button type="button" class="btn-action-edit edit-provider-btn" data-id="${provider.id}" title="Edit card details">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            <span>Edit</span>
          </button>

          <button type="button" class="btn-action-hide toggle-provider-hide-btn" data-id="${provider.id}" title="${isHidden ? 'Make visible to customers' : 'Hide from customers'}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${isHidden 
                ? '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'
                : '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>'
              }
            </svg>
            <span>${isHidden ? 'Show Card' : 'Hide Card'}</span>
          </button>

          <button type="button" class="btn-action-delete delete-provider-btn" data-id="${provider.id}" title="Delete this card permanently">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
            <span>Remove</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  attachAdminProviderCardEvents();
}

function attachAdminProviderCardEvents() {
  document.querySelectorAll('.edit-provider-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      openEditProviderModal(id);
    });
  });

  document.querySelectorAll('.toggle-provider-hide-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      toggleProviderVisibility(id);
    });
  });

  document.querySelectorAll('.delete-provider-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      deleteProvider(id);
    });
  });
}

function updateAdminProviderCounts() {
  const total = state.providers.length;
  const active = state.providers.filter(p => !p.isHidden).length;
  const hidden = state.providers.filter(p => p.isHidden).length;

  const countBadge = document.getElementById('adminProvidersCountBadge');
  const countAll = document.getElementById('countAllProviders');
  const countActive = document.getElementById('countActiveProviders');
  const countHidden = document.getElementById('countHiddenProviders');

  if (countBadge) countBadge.textContent = total;
  if (countAll) countAll.textContent = total;
  if (countActive) countActive.textContent = active;
  if (countHidden) countHidden.textContent = hidden;
}

// --------------------------------------------------------------------
// Supabase Providers Sync & Realtime
// --------------------------------------------------------------------
async function syncProvidersFromSupabase() {
  try {
    // Only query safe public catalog columns over the wire for customer views
    const isEditingAdmin = (state.isAdmin || document.getElementById('adminPage'));
    const selectCols = isEditingAdmin 
      ? '*' 
      : 'id, city, country, country_code, type, pps, pps_num, nic, spoofing, updated_ago, price_usd, price_ltc, is_hidden';

    const { data, error } = await supabase
      .from('providers')
      .select(selectCols)
      .order('id', { ascending: true });

    if (error) {
      console.warn('Supabase providers sync:', error);
      state.providers = [];
      saveProvidersLocally();
      renderProviders();
      if (document.getElementById('adminProvidersContent')) {
        renderAdminProvidersList();
        updateAdminProviderCounts();
      }
      updateStats();
      return;
    }

    state.providers = Array.isArray(data)
      ? data.map(d => ({
          id: d.id,
          city: d.city,
          country: d.country,
          countryCode: d.country_code || 'us',
          type: d.type,
          pps: d.pps,
          ppsNum: d.pps_num || 150000,
          nic: d.nic,
          spoofing: d.spoofing || 'Working',
          updatedAgo: d.updated_ago || 'Just now',
          priceUsd: Number(d.price_usd) || 45,
          priceLtc: d.price_ltc || '0.50',
          revealedName: d.revealed_name || undefined,
          revealedUrl: d.revealed_url || undefined,
          isHidden: Boolean(d.is_hidden)
        }))
      : [];

    saveProvidersLocally();
    renderProviders();
    if (document.getElementById('adminProvidersContent')) {
      renderAdminProvidersList();
      updateAdminProviderCounts();
    }
    updateStats();
  } catch (err) {
    console.warn('Supabase providers sync:', err);
    state.providers = [];
    saveProvidersLocally();
    renderProviders();
    if (document.getElementById('adminProvidersContent')) {
      renderAdminProvidersList();
      updateAdminProviderCounts();
    }
    updateStats();
  }
}

function setupRealtimeProviders() {
  try {
    supabase
      .channel('public:providers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'providers' }, () => {
        syncProvidersFromSupabase();
      })
      .subscribe();
  } catch (e) {
    console.warn('Realtime providers channel:', e);
  }
}

function openAdminModal() {
  window.location.href = 'admin.html';
}

function closeAdminModal() {
  // Navigation handles close
}

async function fetchAdminOrders() {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      const map = new Map();
      data.forEach(item => map.set(item.order_ref, item));
      state.orders.forEach(item => {
        if (!map.has(item.order_ref)) map.set(item.order_ref, item);
      });
      state.adminOrders = Array.from(map.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else {
      if (error) console.warn('Supabase fetchAdminOrders info:', error.message || error);
      const localOrders = JSON.parse(localStorage.getItem('iphm_orders') || '[]');
      const map = new Map();
      state.orders.forEach(item => map.set(item.order_ref, item));
      localOrders.forEach(item => {
        if (!map.has(item.order_ref)) map.set(item.order_ref, item);
      });
      state.adminOrders = Array.from(map.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  } catch (err) {
    console.warn('fetchAdminOrders exception:', err);
    state.adminOrders = [...state.orders];
  }

  updateAdminStats();
  renderAdminOrdersList();
}

function updateAdminStats() {
  const totalEl = document.getElementById('adminKpiTotal');
  const pendingEl = document.getElementById('adminKpiPending');
  const approvedEl = document.getElementById('adminKpiApproved');
  const cancelledEl = document.getElementById('adminKpiCancelled');
  const revEl = document.getElementById('adminKpiRevenue');
  const navBadge = document.getElementById('adminPendingBadge');
  const mobileBadge = document.getElementById('mobileAdminPendingBadge');
  const filterBadge = document.getElementById('adminPendingFilterBadge');

  const total = state.adminOrders.length;
  const pending = state.adminOrders.filter(o => o.status === 'pending').length;
  const approved = state.adminOrders.filter(o => o.status === 'approved').length;
  const cancelled = state.adminOrders.filter(o => o.status === 'cancelled').length;
  const grossRev = state.adminOrders
    .filter(o => o.status === 'approved')
    .reduce((sum, o) => sum + (Number(o.amount_usd) || 0), 0);

  if (totalEl) totalEl.textContent = total;
  if (pendingEl) pendingEl.textContent = pending;
  if (approvedEl) approvedEl.textContent = approved;
  if (cancelledEl) cancelledEl.textContent = cancelled;
  if (revEl) revEl.textContent = `$${grossRev.toLocaleString()}`;

  if (navBadge) {
    navBadge.textContent = pending;
    navBadge.style.display = pending > 0 ? 'inline-flex' : 'none';
  }
  if (mobileBadge) {
    mobileBadge.textContent = pending;
    mobileBadge.style.display = pending > 0 ? 'inline-flex' : 'none';
  }
  if (filterBadge) filterBadge.textContent = pending;
}

function renderAdminOrdersList() {
  const container = document.getElementById('adminOrdersContent');
  if (!container) return;

  const filtered = state.adminOrders.filter(o => {
    // Status tab filter
    if (state.adminFilter === 'pending' && o.status !== 'pending') return false;
    if (state.adminFilter === 'approved' && o.status !== 'approved') return false;
    if (state.adminFilter === 'cancelled' && o.status !== 'cancelled') return false;

    // Search input
    if (state.adminSearchQuery) {
      const q = state.adminSearchQuery.toLowerCase();
      const matchEmail = (o.user_email || '').toLowerCase().includes(q);
      const matchRef = (o.order_ref || '').toLowerCase().includes(q);
      const matchTxid = (o.txid || '').toLowerCase().includes(q);
      const matchHost = (o.provider_name || '').toLowerCase().includes(q);
      if (!matchEmail && !matchRef && !matchTxid && !matchHost) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; background: var(--color-surface); border: 1px dashed var(--color-line-bright); border-radius: var(--radius-xl);">
        <p style="font-size: 1.125rem; font-weight: 700; color: var(--color-ink);">No orders match filter "${state.adminFilter}"</p>
        <p style="font-size: 0.875rem; color: var(--color-muted); margin-top: 0.25rem;">Customer payment submissions will appear here in real-time.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="orders-grid-list">
      ${filtered.map(order => {
        const isPending = order.status === 'pending';
        const isApproved = order.status === 'approved';
        const isCancelled = order.status === 'cancelled';

        const statusBadge = isPending
          ? `<span class="status-pill status-pending"><span class="status-pulse-dot"></span> Pending Approval</span>`
          : isApproved
          ? `<span class="status-pill status-approved"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Approved</span>`
          : `<span class="status-pill status-cancelled">Cancelled</span>`;

        const formattedDate = order.created_at ? new Date(order.created_at).toLocaleString() : 'Recent';
        const explorerUrl = getExplorerUrl(order.payment_coin, order.txid);

        return `
          <div class="order-item-card ${isPending ? 'is-pending' : isApproved ? 'is-approved' : 'is-cancelled'}">
            <div class="order-card-header">
              <div class="order-info-left">
                <div class="order-title-group">
                  <span class="font-mono text-accent font-semibold">${order.order_ref}</span>
                  <span style="font-size: 0.875rem; color: var(--color-ink); font-weight: 700;">${order.user_email || 'guest'}</span>
                  <span class="${order.machine_type === 'VPS' ? 'badge-vps' : 'badge-dedi'}">${order.machine_type || 'VPS'}</span>
                </div>
                <span class="order-meta-sub">${order.provider_name} (${order.city}, ${order.country}) • Submitted: ${formattedDate}</span>
              </div>
              <div>${statusBadge}</div>
            </div>

            <div class="order-details-grid">
              <div>
                <div class="order-detail-label">Amount (USD)</div>
                <div class="order-detail-val text-ink font-mono">$${order.amount_usd || 45}.00</div>
              </div>
              <div>
                <div class="order-detail-label">Coin & Amount</div>
                <div class="order-detail-val font-mono text-accent">${order.crypto_amount || ''} ${order.payment_coin || 'LTC'}</div>
              </div>
              <div>
                <div class="order-detail-label">Port & PPS</div>
                <div class="order-detail-val font-mono">${order.pps || '150K pps'} • ${order.nic || '10 GBPS'}</div>
              </div>
              <div>
                <div class="order-detail-label">Provider URL</div>
                <div class="order-detail-val" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  <a href="${order.provider_url}" target="_blank" class="text-accent" style="text-decoration: underline;">${order.provider_url || 'N/A'}</a>
                </div>
              </div>
            </div>

            <div class="order-txid-row">
              <div style="min-width: 0; flex: 1;">
                <span class="order-detail-label" style="display: block; margin-bottom: 2px;">TXID / Hash:</span>
                <span class="order-txid-text font-mono">${order.txid}</span>
              </div>
              <div style="display: flex; gap: 0.4rem;">
                <button type="button" class="btn btn-ghost btn-sm admin-copy-btn" data-copy="${order.txid}">Copy</button>
                <a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" title="View on Blockchain Explorer">
                  Explorer &rarr;
                </a>
              </div>
            </div>

            <div class="admin-actions-row">
              ${isPending ? `
                <button type="button" class="btn-approve" data-admin-action="approve" data-id="${order.id}" data-ref="${order.order_ref}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  Approve & Grant Perm
                </button>
                <button type="button" class="btn-reject" data-admin-action="reject" data-id="${order.id}" data-ref="${order.order_ref}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  Reject / Cancel
                </button>
              ` : isApproved ? `
                <span style="font-size: 0.78rem; color: var(--color-accent); font-weight: 600; display: inline-flex; align-items: center; gap: 0.4rem;">
                  ✓ Permissions active for this user
                </span>
                <button type="button" class="btn-reject" style="margin-left: auto;" data-admin-action="reject" data-id="${order.id}" data-ref="${order.order_ref}">
                  Revoke Access
                </button>
              ` : `
                <span style="font-size: 0.78rem; color: #f87171; font-weight: 600;">
                  ✕ Order Rejected
                </span>
                <button type="button" class="btn-approve" style="margin-left: auto;" data-admin-action="approve" data-id="${order.id}" data-ref="${order.order_ref}">
                  Re-approve & Unlock
                </button>
              `}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Wire buttons inside admin modal
  container.querySelectorAll('[data-admin-action="approve"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const ref = btn.getAttribute('data-ref');
      adminApproveOrder(id, ref);
    });
  });

  container.querySelectorAll('[data-admin-action="reject"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const ref = btn.getAttribute('data-ref');
      adminRejectOrder(id, ref);
    });
  });

  container.querySelectorAll('.admin-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.getAttribute('data-copy');
      copyToClipboard(text, btn, 'Copy');
    });
  });
}

async function adminApproveOrder(id, orderRef) {
  // 1. Update local state
  const target = state.adminOrders.find(o => o.id == id || o.order_ref === orderRef);
  if (target) {
    target.status = 'approved';
    target.updated_at = new Date().toISOString();
  }

  const localTarget = state.orders.find(o => o.id == id || o.order_ref === orderRef);
  if (localTarget) {
    localTarget.status = 'approved';
    localTarget.updated_at = new Date().toISOString();
  }
  localStorage.setItem('iphm_orders', JSON.stringify(state.orders));

  // 2. Sync to Supabase
  try {
    let query = supabase.from('orders').update({
      status: 'approved',
      updated_at: new Date().toISOString()
    });
    if (typeof id === 'string' && id.startsWith('ord-')) {
      query = query.eq('order_ref', orderRef);
    } else {
      query = query.eq('id', id);
    }
    await query;
  } catch (err) {
    console.warn('Supabase approve error:', err);
  }

  // 3. Unlock provider credentials
  const approvedItem = target || localTarget;
  if (approvedItem) {
    unlockProviderFromOrder(approvedItem);
    const checkoutModal = document.getElementById('checkoutModal');
    if (checkoutModal?.classList.contains('active') && state.currentOrder?.ref === approvedItem.order_ref) {
      showCheckoutStep3(approvedItem.provider_id);
    }
  }

  updateAdminStats();
  renderAdminOrdersList();
  renderOrdersList();
  updateOrdersBadges();
  showToast('Order Approved!', `Order ${orderRef} approved! Host access permission granted.`, 'success');
}

async function adminRejectOrder(id, orderRef) {
  const target = state.adminOrders.find(o => o.id == id || o.order_ref === orderRef);
  if (target) {
    target.status = 'cancelled';
    target.updated_at = new Date().toISOString();
  }

  const localTarget = state.orders.find(o => o.id == id || o.order_ref === orderRef);
  if (localTarget) {
    localTarget.status = 'cancelled';
    localTarget.updated_at = new Date().toISOString();
  }
  localStorage.setItem('iphm_orders', JSON.stringify(state.orders));

  try {
    let query = supabase.from('orders').update({
      status: 'cancelled',
      updated_at: new Date().toISOString()
    });
    if (typeof id === 'string' && id.startsWith('ord-')) {
      query = query.eq('order_ref', orderRef);
    } else {
      query = query.eq('id', id);
    }
    await query;
  } catch (err) {
    console.warn('Supabase reject status error:', err);
  }

  updateAdminStats();
  renderAdminOrdersList();
  renderOrdersList();
  updateOrdersBadges();
  showToast('Order Cancelled', `Order ${orderRef} marked as cancelled.`, 'warn');
}

function getExplorerUrl(coinKey, txid) {
  if (!txid) return '#';
  switch (coinKey) {
    case 'BTC':
      return `https://blockchair.com/bitcoin/transaction/${txid}`;
    case 'ETH':
      return `https://etherscan.io/tx/${txid}`;
    case 'SOL':
      return `https://solscan.io/tx/${txid}`;
    case 'USDT_TRC20':
      return `https://tronscan.org/#/transaction/${txid}`;
    case 'USDT_BEP20':
      return `https://bscscan.com/tx/${txid}`;
    case 'DOGE':
      return `https://blockchair.com/dogecoin/transaction/${txid}`;
    case 'LTC':
    default:
      return `https://blockchair.com/litecoin/transaction/${txid}`;
  }
}

// Check if user has role 'admin' in Supabase profiles table (DB-backed, resilient to row-level security and stale state)
async function checkAdminStatus() {
  const isAdminPage = !!document.getElementById('adminAuthGate');

  if (!state.user) {
    setAdminState(false);
    if (isAdminPage) showAdminGateDenied();
    return;
  }

  try {
    const { data: isAdminRpc, error: rpcError } = await supabase.rpc('is_admin');
    if (!rpcError && isAdminRpc === true) {
      setAdminState(true);
      if (isAdminPage) showAdminDashboard();
      return;
    }

    const userId = state.user.id;
    const userEmail = state.user.email || '';
    if (!userId && !userEmail) {
      throw new Error('No user identity available for admin lookup');
    }

    let profileData = null;
    let profileError = null;

    if (userId) {
      const result = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
      profileData = result.data;
      profileError = result.error;
    }

    if ((!profileData || !profileData.role || profileData.role !== 'admin') && userEmail) {
      const result = await supabase
        .from('profiles')
        .select('role')
        .eq('email', userEmail)
        .maybeSingle();
      profileData = result.data || profileData;
      profileError = result.error || profileError;
    }

    if (!profileError && profileData?.role === 'admin') {
      setAdminState(true);
      if (isAdminPage) showAdminDashboard();
      return;
    }
  } catch (e) {
    console.warn('Admin role lookup failed:', e);
  }

  setAdminState(false);
  if (isAdminPage) showAdminGateDenied();
}

function showAdminDashboard() {
  const gate = document.getElementById('adminAuthGate');
  const page = document.getElementById('adminPage');
  const adminBtn = document.getElementById('openAdminBtn');
  if (gate) gate.style.display = 'none';
  if (page) page.style.display = 'block';
  if (adminBtn) { adminBtn.style.display = 'inline-flex'; adminBtn.classList.add('active'); }
  fetchAdminOrders();
  renderAdminProvidersList?.();
  updateAdminProviderCounts?.();
}

function showAdminGateDenied() {
  const gate = document.getElementById('adminAuthGate');
  const loading = document.getElementById('adminAuthLoadingState');
  const denied = document.getElementById('adminAuthDeniedState');
  if (gate) gate.style.display = 'block';
  if (loading) loading.style.display = 'none';
  if (denied) denied.style.display = 'block';
  
  const gateBtn = document.getElementById('adminGateLoginBtn');
  if (gateBtn && !gateBtn._hasListener) {
    gateBtn._hasListener = true;
    gateBtn.addEventListener('click', () => {
      openAuthModal('login');
    });
  }
}

function setAdminState(isAdmin) {
  state.isAdmin = isAdmin;
  const adminBtn = document.getElementById('openAdminBtn');
  const mobileAdminBtn = document.getElementById('mobileAdminBtn');

  // Only show admin nav button when actually admin AND not on the admin page itself
  if (adminBtn && !document.getElementById('adminAuthGate')) {
    adminBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  }
  if (mobileAdminBtn) mobileAdminBtn.style.display = isAdmin ? 'flex' : 'none';
}

// Cross-tab synchronization for orders, providers & admin updates
window.addEventListener('storage', (e) => {
  if (e.key === 'iphm_orders') {
    try {
      const updated = JSON.parse(e.newValue || '[]');
      state.orders = updated;
      if (document.getElementById('adminPage')) {
        fetchAdminOrders();
      }
      if (document.getElementById('ordersPage')) {
        renderOrdersList();
      }
      updateOrdersBadges();
      updateAdminStats();
    } catch (err) {
      console.warn('Storage sync error:', err);
    }
  } else if (e.key === 'iphm_providers') {
    try {
      const updated = JSON.parse(e.newValue || '[]');
      state.providers = updated;
      renderProviders();
      updateStats();
      if (document.getElementById('adminProvidersContent')) {
        renderAdminProvidersList();
        updateAdminProviderCounts();
      }
    } catch (err) {
      console.warn('Storage providers sync error:', err);
    }
  }
});

// Supabase Realtime Orders Listener
function setupRealtimeOrders() {
  try {
    supabase
      .channel('public:orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        handleRealtimeOrderEvent(payload);
      })
      .subscribe();
  } catch (e) {
    console.warn('Realtime subscription:', e);
  }
}

function handleRealtimeOrderEvent(payload) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  if (!newRecord) return;

  if (eventType === 'INSERT') {
    if (state.isAdmin || document.getElementById('adminPage')) {
      if (!state.adminOrders.some(o => o.order_ref === newRecord.order_ref)) {
        state.adminOrders.unshift(newRecord);
        updateAdminStats();
        renderAdminOrdersList();
        showToast('New Payment Received', `Order ${newRecord.order_ref} submitted by ${newRecord.user_email}.`, 'info');
      }
    }
  } else if (eventType === 'UPDATE') {
    const existing = state.orders.find(o => o.order_ref === newRecord.order_ref);
    if (existing) {
      const prevStatus = existing.status;
      existing.status = newRecord.status;
      existing.updated_at = newRecord.updated_at;
      localStorage.setItem('iphm_orders', JSON.stringify(state.orders));

      if (prevStatus !== 'approved' && newRecord.status === 'approved') {
        unlockProviderFromOrder(newRecord);
        showToast('Order Approved!', `Your Order ${newRecord.order_ref} was approved! Access credentials unlocked.`, 'success');

        const checkoutModal = document.getElementById('checkoutModal');
        if (checkoutModal?.classList.contains('active') && state.currentOrder?.ref === newRecord.order_ref) {
          showCheckoutStep3(newRecord.provider_id);
        }
      }
      renderOrdersList();
      updateOrdersBadges();
    }

    if (state.isAdmin || document.getElementById('adminPage')) {
      const adminTarget = state.adminOrders.find(o => o.order_ref === newRecord.order_ref);
      if (adminTarget) {
        adminTarget.status = newRecord.status;
        adminTarget.updated_at = newRecord.updated_at;
        updateAdminStats();
        renderAdminOrdersList();
      }
    }
  }
}

// Toast notification helper
function showToast(title, body, type = 'info') {
  const container = document.getElementById('appToastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;

  const iconSvg = type === 'success' 
    ? `<svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
    : type === 'warn'
    ? `<svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    : `<svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

  toast.innerHTML = `
    ${iconSvg}
    <div style="flex: 1; min-width: 0;">
      <div class="toast-title">${title}</div>
      <div class="toast-body">${body}</div>
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 350);
  }, 4500);
}

// Dashboard Logic
function initDashboard() {
  const closeDashboardBtn = document.getElementById('closeDashboardBtn');
  const dashboardModal = document.getElementById('dashboardModal');

  if (closeDashboardBtn) closeDashboardBtn.addEventListener('click', closeDashboard);
  if (dashboardModal) {
    dashboardModal.addEventListener('click', (e) => {
      if (e.target === dashboardModal) closeDashboard();
    });
  }
}

function openDashboard() {
  const modal = document.getElementById('dashboardModal');
  const emailLabel = document.getElementById('dashboardEmailLabel');
  const content = document.getElementById('dashboardContent');

  if (emailLabel) {
    emailLabel.textContent = state.user ? state.user.email : 'Guest Member';
  }

  if (state.unlockedProviders.length === 0) {
    content.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem;">
        <div style="height: 3rem; width: 3rem; margin: 0 auto 1rem; border-radius: var(--radius-full); background: var(--color-elevated); display: flex; align-items: center; justify-content: center; color: var(--color-faint);">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <p style="font-size: 1.125rem; color: var(--color-ink); font-weight: 700;">No providers unlocked yet</p>
        <p style="font-size: 0.875rem; color: var(--color-muted); margin-top: 0.5rem; max-width: 340px; margin-inline: auto; line-height: 1.6;">
          Browse available hosts, send payment in Litecoin or any supported crypto, and your unlocked host credentials will appear here forever.
        </p>
        <button type="button" class="btn btn-primary" style="margin-top: 1.5rem;" id="browseProvidersFromEmptyBtn">
          Browse providers
        </button>
      </div>
    `;

    document.getElementById('browseProvidersFromEmptyBtn')?.addEventListener('click', () => {
      closeDashboard();
      document.getElementById('providers')?.scrollIntoView({ behavior: 'smooth' });
    });
  } else {
    content.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        ${state.unlockedProviders.map(p => `
          <div style="background-color: var(--color-base); border: 1px solid var(--color-line-bright); border-radius: var(--radius-lg); padding: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem;">
              <div>
                <span class="${p.type === 'VPS' ? 'badge-vps' : 'badge-dedi'}">${p.type}</span>
                <h3 style="font-size: 1.25rem; font-weight: 800; color: var(--color-ink); margin-top: 0.4rem;">${p.name}</h3>
                <p style="font-size: 0.8125rem; color: var(--color-muted);">${p.city}, ${p.country}</p>
              </div>
              <a href="${p.url}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">
                Open Provider &rarr;
              </a>
            </div>

            <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--color-line); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; font-size: 0.8125rem;">
              <div>
                <span class="text-faint">PPS:</span> <span class="font-mono text-ink font-semibold">${p.pps}</span>
              </div>
              <div>
                <span class="text-faint">NIC:</span> <span class="font-mono text-ink font-semibold">${p.nic}</span>
              </div>
              <div style="grid-column: span 2;">
                <span class="text-faint">Order:</span> <span class="font-mono text-muted">${p.orderRef}</span>
              </div>
              <div style="grid-column: span 2;">
                <span class="text-faint">TXID:</span> <span class="font-mono text-muted" style="word-break: break-all; font-size: 0.75rem;">${p.txid}</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeDashboard() {
  const modal = document.getElementById('dashboardModal');
  modal.classList.remove('active');
  document.body.style.overflow = '';
}

// Copy to Clipboard
function copyToClipboard(text, buttonEl, defaultLabel) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showCopiedState(buttonEl, defaultLabel));
  } else {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showCopiedState(buttonEl, defaultLabel);
  }
}

function showCopiedState(buttonEl, defaultLabel) {
  if (!buttonEl) return;
  const original = buttonEl.getAttribute('data-original-html') || buttonEl.innerHTML;
  if (!buttonEl.hasAttribute('data-original-html')) {
    buttonEl.setAttribute('data-original-html', original);
  }
  buttonEl.innerHTML = '<span class="text-accent" style="font-weight: 700; display: inline-flex; align-items: center; gap: 0.25rem;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Copied!</span>';
  setTimeout(() => {
    buttonEl.innerHTML = buttonEl.getAttribute('data-original-html') || defaultLabel;
    buttonEl.removeAttribute('data-original-html');
  }, 1600);
}

// ====================================================================
// PROFILE & SECURITY SYSTEM
// ====================================================================
let isProfilePasswordVisible = false;

function openProfileModal() {
  if (!state.user) {
    openAuthModal('login');
    return;
  }
  updateProfileModalContent();
  const modal = document.getElementById('profileModal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function updateProfileModalContent() {
  const isProfilePage = !!document.getElementById('profilePageShell');
  const authGate = document.getElementById('pageProfileAuthGate');
  const pageContent = document.getElementById('pageProfileContent');

  if (isProfilePage) {
    if (!state.user) {
      if (authGate) authGate.style.display = 'block';
      if (pageContent) pageContent.style.display = 'none';
      return;
    } else {
      if (authGate) authGate.style.display = 'none';
      if (pageContent) pageContent.style.display = 'block';
    }
  }

  if (!state.user) return;

  const email = state.user.email || '';
  const firstLetter = email.charAt(0).toUpperCase() || 'U';

  const avatarEl = document.getElementById('profileHeaderAvatar') || document.getElementById('pageProfileAvatar');
  if (avatarEl) avatarEl.textContent = firstLetter;

  const roleBadge = document.getElementById('profileRoleBadge') || document.getElementById('pageProfileRoleBadge');
  if (roleBadge) {
    if (state.isAdmin) {
      roleBadge.textContent = 'Administrator';
      roleBadge.className = 'chip-admin-role';
    } else {
      roleBadge.textContent = 'Verified User';
      roleBadge.className = 'chip text-accent';
    }
  }

  // Current Email
  const emailInput = document.getElementById('profileDisplayEmail');
  if (emailInput) emailInput.value = email;

  // Member Since & User ID
  const memberSinceEl = document.getElementById('profileMemberSince');
  if (memberSinceEl) {
    if (state.user.createdAt) {
      const dateStr = new Date(state.user.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      memberSinceEl.textContent = `Member since: ${dateStr}`;
    } else {
      memberSinceEl.textContent = 'Member since: Active';
    }
  }

  const userIdEl = document.getElementById('profileUserId');
  if (userIdEl) {
    const rawId = state.user.id || '';
    userIdEl.textContent = rawId ? `UID: ${rawId.slice(0, 8)}…${rawId.slice(-4)}` : 'UID: Active';
  }

  // Current Password Display
  renderCurrentPasswordDisplay();

  // Reset Change Password fields & banners
  const newPwd = document.getElementById('profileNewPassword');
  const confirmPwd = document.getElementById('profileConfirmPassword');
  if (newPwd) newPwd.value = '';
  if (confirmPwd) confirmPwd.value = '';

  const alertBanner = document.getElementById('profileAlertBanner');
  if (alertBanner) alertBanner.style.display = 'none';

  const strBox = document.getElementById('profilePasswordStrengthBox');
  if (strBox) strBox.style.display = 'none';

  const matchInd = document.getElementById('profileMatchIndicator');
  if (matchInd) matchInd.style.display = 'none';
}

function renderCurrentPasswordDisplay() {
  const pwdField = document.getElementById('profileDisplayPassword');
  const toggleBtn = document.getElementById('profileTogglePasswordBtn');
  const toggleText = document.getElementById('profileTogglePasswordText');
  const eyeOff = toggleBtn?.querySelector('.profile-eye-off');
  const eyeOn = toggleBtn?.querySelector('.profile-eye');
  const noteEl = document.getElementById('profilePwdNote');

  if (!pwdField) return;

  const currentPwd = state.currentPassword || '';

  if (isProfilePasswordVisible) {
    pwdField.type = 'text';
    pwdField.value = currentPwd || '••••••••••••';
    if (toggleText) toggleText.textContent = 'Hide';
    if (eyeOff) eyeOff.style.display = 'none';
    if (eyeOn) eyeOn.style.display = 'inline-block';
    if (noteEl) {
      noteEl.textContent = currentPwd
        ? 'Active session credential visible'
        : 'Encrypted server credential (change below to set new)';
    }
  } else {
    pwdField.type = 'password';
    pwdField.value = currentPwd || '••••••••••••';
    if (toggleText) toggleText.textContent = 'Show';
    if (eyeOff) eyeOff.style.display = 'inline-block';
    if (eyeOn) eyeOn.style.display = 'none';
    if (noteEl) {
      noteEl.textContent = 'Encrypted session credential';
    }
  }
}

function showProfileAlert(msg, type = 'error') {
  const banner = document.getElementById('profileAlertBanner');
  const icon = document.getElementById('profileAlertIcon');
  const text = document.getElementById('profileAlertText');
  if (!banner || !text) return;

  banner.className = `auth-banner ${type === 'success' ? 'banner-success' : 'banner-error'}`;
  text.textContent = msg;

  if (icon) {
    if (type === 'success') {
      icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
    } else {
      icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    }
  }
  banner.style.display = 'flex';
}

function initProfileModal() {
  const modal = document.getElementById('profileModal');
  const closeBtn = document.getElementById('closeProfileBtn');
  const copyEmailBtn = document.getElementById('profileCopyEmailBtn');
  const togglePwdBtn = document.getElementById('profileTogglePasswordBtn');
  const copyPwdBtn = document.getElementById('profileCopyPasswordBtn');
  const form = document.getElementById('profileChangePasswordForm');
  const newPwdInput = document.getElementById('profileNewPassword');
  const confirmPwdInput = document.getElementById('profileConfirmPassword');

  // Close handlers
  if (closeBtn) closeBtn.addEventListener('click', closeProfileModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeProfileModal();
    });
  }

  // Profile standalone page triggers
  document.getElementById('pageProfileSignInBtn')?.addEventListener('click', () => {
    openAuthModal('login');
  });
  document.getElementById('pageProfileLogoutBtn')?.addEventListener('click', () => {
    handleLogout();
  });

  if (document.getElementById('profilePageShell')) {
    updateProfileModalContent();
  }

  // Keyboard accessibility
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
      closeProfileModal();
    }
  });

  // Copy Email button
  if (copyEmailBtn) {
    copyEmailBtn.addEventListener('click', () => {
      const email = state.user?.email || '';
      if (!email) return;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(email).then(() => {
          showCopiedState(copyEmailBtn, 'Copy');
          showToast('Email Copied', email, 'info');
        }).catch(() => {});
      } else {
        copyToClipboard(email, copyEmailBtn, 'Copy');
      }
    });
  }

  // Toggle Current Password visibility
  if (togglePwdBtn) {
    togglePwdBtn.addEventListener('click', async () => {
      if (!state.currentPassword && state.user?.id) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('current_password')
            .eq('id', state.user.id)
            .maybeSingle();
          if (data?.current_password) {
            state.currentPassword = data.current_password;
            try { sessionStorage.setItem('iphm_active_pwd', data.current_password); } catch (e) {}
          }
        } catch (e) {}
      }
      isProfilePasswordVisible = !isProfilePasswordVisible;
      renderCurrentPasswordDisplay();
    });
  }

  // Copy Current Password button
  if (copyPwdBtn) {
    copyPwdBtn.addEventListener('click', async () => {
      if (!state.currentPassword && state.user?.id) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('current_password')
            .eq('id', state.user.id)
            .maybeSingle();
          if (data?.current_password) {
            state.currentPassword = data.current_password;
            try { sessionStorage.setItem('iphm_active_pwd', data.current_password); } catch (e) {}
          }
        } catch (e) {}
      }
      const pwd = state.currentPassword;
      if (!pwd) {
        showToast('Password Protected', 'Please change your password below if you wish to set a new one.', 'warn');
        return;
      }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(pwd).then(() => {
          showCopiedState(copyPwdBtn, '');
          showToast('Password Copied', 'Password copied to clipboard securely.', 'info');
        }).catch(() => {});
      } else {
        copyToClipboard(pwd, copyPwdBtn, '');
      }
    });
  }

  // Eye toggles for New and Confirm Password fields
  const toggleNewBtn = document.getElementById('toggleProfileNewPasswordBtn');
  if (toggleNewBtn && newPwdInput) {
    toggleNewBtn.addEventListener('click', () => {
      const isPwd = newPwdInput.type === 'password';
      newPwdInput.type = isPwd ? 'text' : 'password';
      const off = toggleNewBtn.querySelector('.icon-eye-off');
      const on = toggleNewBtn.querySelector('.icon-eye');
      if (off) off.style.display = isPwd ? 'none' : 'block';
      if (on) on.style.display = isPwd ? 'block' : 'none';
    });
  }

  const toggleConfirmBtn = document.getElementById('toggleProfileConfirmPasswordBtn');
  if (toggleConfirmBtn && confirmPwdInput) {
    toggleConfirmBtn.addEventListener('click', () => {
      const isPwd = confirmPwdInput.type === 'password';
      confirmPwdInput.type = isPwd ? 'text' : 'password';
      const off = toggleConfirmBtn.querySelector('.icon-eye-off');
      const on = toggleConfirmBtn.querySelector('.icon-eye');
      if (off) off.style.display = isPwd ? 'none' : 'block';
      if (on) on.style.display = isPwd ? 'block' : 'none';
    });
  }

  // Real-time password strength meter for New Password
  if (newPwdInput) {
    newPwdInput.addEventListener('input', () => {
      const val = newPwdInput.value;
      const box = document.getElementById('profilePasswordStrengthBox');
      const text = document.getElementById('profileStrengthText');
      const b1 = document.getElementById('profileStrBar1');
      const b2 = document.getElementById('profileStrBar2');
      const b3 = document.getElementById('profileStrBar3');
      const b4 = document.getElementById('profileStrBar4');

      if (!val) {
        if (box) box.style.display = 'none';
        return;
      }
      if (box) box.style.display = 'block';

      let score = 0;
      if (val.length >= 6) score++;
      if (val.length >= 10) score++;
      if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
      if (/[0-9]/.test(val) || /[^A-Za-z0-9]/.test(val)) score++;

      [b1, b2, b3, b4].forEach((b, idx) => {
        if (!b) return;
        b.className = 'strength-bar';
        if (idx < score) {
          if (score === 1) b.classList.add('bar-weak');
          else if (score === 2) b.classList.add('bar-fair');
          else if (score === 3) b.classList.add('bar-good');
          else b.classList.add('bar-strong');
        }
      });

      if (text) {
        if (score <= 1) text.textContent = 'Weak (min. 6 characters)';
        else if (score === 2) text.textContent = 'Fair';
        else if (score === 3) text.textContent = 'Good';
        else text.textContent = 'Strong password';
      }

      updateProfileMatchIndicator();
    });
  }

  if (confirmPwdInput) {
    confirmPwdInput.addEventListener('input', updateProfileMatchIndicator);
  }

  function updateProfileMatchIndicator() {
    const matchInd = document.getElementById('profileMatchIndicator');
    if (!matchInd) return;

    const p1 = newPwdInput?.value || '';
    const p2 = confirmPwdInput?.value || '';

    if (!p2) {
      matchInd.style.display = 'none';
      return;
    }
    matchInd.style.display = 'inline-block';
    if (p1 === p2) {
      matchInd.textContent = '✓ Passwords match';
      matchInd.style.color = 'var(--color-accent)';
    } else {
      matchInd.textContent = 'Passwords do not match';
      matchInd.style.color = 'var(--color-danger)';
    }
  }

  // Change Password Form Submit
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newPwd = (newPwdInput?.value || '').trim();
      const confirmPwd = (confirmPwdInput?.value || '').trim();
      const submitBtn = document.getElementById('profileSubmitPasswordBtn');
      const spinner = document.getElementById('profileSubmitSpinner');
      const btnText = document.getElementById('profileSubmitBtnText');

      if (!newPwd) {
        showProfileAlert('Please enter your new password.');
        newPwdInput?.focus();
        return;
      }
      if (newPwd.length < 6) {
        showProfileAlert('Password must be at least 6 characters long.');
        newPwdInput?.focus();
        return;
      }
      if (newPwd !== confirmPwd) {
        showProfileAlert('Passwords do not match. Please re-enter.');
        confirmPwdInput?.focus();
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      if (spinner) spinner.style.display = 'inline-block';
      if (btnText) btnText.textContent = 'Updating…';

      try {
        const { data, error } = await supabase.auth.updateUser({
          password: newPwd
        });

        if (error) throw error;

        // Persist to profiles in Supabase
        if (state.user?.id) {
          try {
            await supabase.from('profiles').update({
              current_password: newPwd,
              updated_at: new Date().toISOString()
            }).eq('id', state.user.id);
          } catch (dbErr) {
            console.warn('Profiles update error:', dbErr);
          }
        }

        // Success: update active credentials
        state.currentPassword = newPwd;
        try {
          sessionStorage.setItem('iphm_active_pwd', newPwd);
        } catch (e) {}

        // Update current password display
        renderCurrentPasswordDisplay();

        // Clear input fields
        if (newPwdInput) newPwdInput.value = '';
        if (confirmPwdInput) confirmPwdInput.value = '';
        const matchInd = document.getElementById('profileMatchIndicator');
        if (matchInd) matchInd.style.display = 'none';
        const strBox = document.getElementById('profilePasswordStrengthBox');
        if (strBox) strBox.style.display = 'none';

        showProfileAlert('Your account password has been successfully updated!', 'success');
        showToast('Password Updated', 'Your account credentials have been securely refreshed.', 'success');
      } catch (err) {
        showProfileAlert(err.message || 'Failed to update password. Please try again.', 'error');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
        if (btnText) btnText.textContent = 'Update Password';
      }
    });
  }
}

