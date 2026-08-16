// NutriScan AI — frontend logic
// Talks to the backend API defined in backend/server.js (same-origin, so no base URL needed).

(function () {
  'use strict';

  const API = '/api';

  // ---------------- State ----------------
  let authToken = localStorage.getItem('nutriscan_token') || null;
  let currentUser = null;
  let healthProfile = loadLocalHealthProfile();
  let activeScanTab = 'barcode';
  let lastAnalysis = null; // { product, analysis } — used by detail tabs
  let barcodeStream = null;
  let barcodeDetectionTimer = null;

  // ---------------- Helpers ----------------
  function $(id) { return document.getElementById(id); }

  function showToast(message, isError) {
    let toast = $('appToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appToast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  async function apiRequest(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (authToken) headers.Authorization = 'Bearer ' + authToken;
    const res = await fetch(API + path, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      const message = (data && data.error) || `Request failed (${res.status})`;
      throw new Error(message);
    }
    return data;
  }

  function loadLocalHealthProfile() {
    try {
      const raw = localStorage.getItem('nutriscan_health_profile');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveLocalHealthProfile(profile) {
    healthProfile = profile;
    localStorage.setItem('nutriscan_health_profile', JSON.stringify(profile));
  }

  // ---------------- Navigation ----------------
  window.navigateTo = function (sectionId) {
    document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
    const target = $(sectionId);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-links a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === '#' + sectionId);
    });

    $('mobileMenu')?.classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  window.toggleMobileMenu = function () {
    $('mobileMenu')?.classList.toggle('open');
  };

  document.addEventListener('click', (event) => {
    const link = event.target.closest('.nav-links a, .mobile-menu a');
    if (!link) return;
    const hash = link.getAttribute('href');
    if (hash && hash.startsWith('#')) {
      event.preventDefault();
      navigateTo(hash.slice(1));
    }
  });

  // ---------------- Auth ----------------
  let authMode = 'login';

  window.openAuthModal = function (mode) {
    authMode = mode === 'register' ? 'register' : 'login';
    const isRegister = authMode === 'register';
    $('authTitle').textContent = isRegister ? 'Create your account' : 'Welcome back';
    $('authSubtitle').textContent = isRegister
      ? 'Save your health profile and get personalized results.'
      : 'Sign in to save your health profile.';
    $('registerNameField').style.display = isRegister ? 'block' : 'none';
    $('authName').required = isRegister;
    $('authPassword').autocomplete = isRegister ? 'new-password' : 'current-password';
    $('authSubmit').textContent = isRegister ? 'Create account' : 'Sign in';
    $('authSwitch').innerHTML = isRegister
      ? 'Already have an account? <button type="button" onclick="openAuthModal(\'login\')">Sign in</button>'
      : 'New here? <button type="button" onclick="openAuthModal(\'register\')">Create an account</button>';
    $('authError').classList.remove('active');
    $('authForm').reset();
    $('authModal').classList.add('open');
    $('authModal').setAttribute('aria-hidden', 'false');
    $('authEmail').focus();
  };

  window.closeAuthModal = function () {
    $('authModal').classList.remove('open');
    $('authModal').setAttribute('aria-hidden', 'true');
  };

  window.submitAuth = async function (event) {
    event.preventDefault();
    const errorEl = $('authError');
    errorEl.classList.remove('active');
    const submitBtn = $('authSubmit');
    submitBtn.disabled = true;

    try {
      const payload = {
        email: $('authEmail').value.trim(),
        password: $('authPassword').value
      };
      let data;
      if (authMode === 'register') {
        payload.name = $('authName').value.trim();
        data = await apiRequest('/auth/register', { method: 'POST', body: payload });
      } else {
        data = await apiRequest('/auth/login', { method: 'POST', body: payload });
      }
      authToken = data.token;
      localStorage.setItem('nutriscan_token', authToken);
      currentUser = data.user;
      renderAuthState();
      closeAuthModal();
      showToast(`Signed in as ${currentUser.name}`);
      await syncHealthProfileFromServer();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.add('active');
    } finally {
      submitBtn.disabled = false;
    }
  };

  window.signOut = function () {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('nutriscan_token');
    renderAuthState();
    showToast('Signed out');
  };

  function renderAuthState() {
    const container = $('authActions');
    if (!container) return;
    if (currentUser) {
      const initial = (currentUser.name || currentUser.email || '?').trim().charAt(0).toUpperCase();
      container.innerHTML = `
        <div class="user-chip">
          <span class="avatar">${initial}</span>
          <span>${escapeHtml(currentUser.name)}</span>
          <button type="button" onclick="signOut()">Sign out</button>
        </div>`;
    } else {
      container.innerHTML = `<button class="btn-auth" onclick="openAuthModal('login')">Sign in</button>`;
    }
  }

  async function restoreSession() {
    if (!authToken) return;
    try {
      currentUser = await apiRequest('/auth/me');
      renderAuthState();
      await syncHealthProfileFromServer();
    } catch {
      authToken = null;
      localStorage.removeItem('nutriscan_token');
    }
  }

  async function syncHealthProfileFromServer() {
    if (!authToken) return;
    try {
      const profile = await apiRequest('/health-profile');
      saveLocalHealthProfile(profile);
      populateHealthProfileForm(profile);
    } catch {
      // No saved profile yet on the server — keep whatever is local.
    }
  }

  // ---------------- Scan tabs ----------------
  window.switchScanTab = function (tab, event) {
    activeScanTab = tab;
    document.querySelectorAll('.scan-tab').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.scan-panel').forEach(panel => panel.classList.remove('active'));
    (event?.currentTarget || $(tab + 'ScanTab'))?.classList.add('active');
    $(tab + 'Panel')?.classList.add('active');
    if (tab !== 'camera') stopCameraScanner();
  };

  // ---------------- Camera barcode scanning ----------------
  window.startCameraScanner = async function () {
    const video = $('barcodeVideo');
    const message = $('cameraMessage');
    if (!('BarcodeDetector' in window)) {
      message.textContent = 'Your browser doesn\'t support live barcode scanning. Enter the barcode manually instead.';
      return;
    }
    try {
      barcodeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = barcodeStream;
      video.classList.add('active');
      $('stopCameraButton').classList.add('active');
      $('startCameraButton').style.display = 'none';
      await video.play();
      message.textContent = 'Hold steady — scanning for a barcode…';

      const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
      barcodeDetectionTimer = setInterval(async () => {
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            const value = barcodes[0].rawValue;
            stopCameraScanner();
            $('barcodeInput').value = value;
            switchScanTab('barcode');
            analyzeBarcode();
          }
        } catch { /* detection frame failure, keep trying */ }
      }, 400);
    } catch {
      message.textContent = 'Camera access was denied or unavailable. Enter the barcode manually instead.';
    }
  };

  window.stopCameraScanner = function () {
    if (barcodeDetectionTimer) clearInterval(barcodeDetectionTimer);
    barcodeDetectionTimer = null;
    if (barcodeStream) barcodeStream.getTracks().forEach(track => track.stop());
    barcodeStream = null;
    const video = $('barcodeVideo');
    if (video) { video.pause(); video.srcObject = null; video.classList.remove('active'); }
    $('stopCameraButton')?.classList.remove('active');
    const startBtn = $('startCameraButton');
    if (startBtn) startBtn.style.display = '';
  };

  // ---------------- Analyze ----------------
  function setLoading(isLoading) {
    $('loadingState')?.classList.toggle('active', isLoading);
  }

  window.analyzeBarcode = async function () {
    const barcode = $('barcodeInput').value.trim();
    if (!/^\d{8,14}$/.test(barcode)) {
      showToast('Enter a valid 8–14 digit barcode.', true);
      return;
    }
    setLoading(true);
    try {
      const data = await apiRequest('/analyze', { method: 'POST', body: { barcode, healthProfile } });
      lastAnalysis = data;
      renderResult(data);
      navigateTo('result');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  window.analyzeIngredients = async function () {
    const productName = $('manualProductName').value.trim();
    const ingredients = $('ingredientsInput').value.trim();
    if (!ingredients) {
      showToast('Paste an ingredients list first.', true);
      return;
    }
    setLoading(true);
    try {
      const data = await apiRequest('/analyze', {
        method: 'POST',
        body: { productName, ingredients, healthProfile }
      });
      lastAnalysis = data;
      renderResult(data);
      navigateTo('result');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  // ---------------- Render results ----------------
  const VERDICT_META = {
    good: { icon: 'fa-circle-check', label: 'BETTER CHOICE' },
    moderate: { icon: 'fa-triangle-exclamation', label: 'MODERATE' },
    limit: { icon: 'fa-circle-xmark', label: 'LIMIT' },
    unknown: { icon: 'fa-circle-question', label: 'INSUFFICIENT DATA' }
  };

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function renderResult({ product, analysis }) {
    $('resultProductName').textContent = product.name || 'Unnamed product';
    $('resultBrand').textContent = product.brand || 'Unknown brand';

    const verdict = VERDICT_META[analysis.verdict] || VERDICT_META.unknown;
    const card = $('verdictCard');
    card.className = 'verdict-card ' + analysis.verdict;
    $('verdictIcon').innerHTML = `<i class="fas ${verdict.icon}"></i>`;
    $('verdictText').textContent = verdict.label;
    $('verdictSub').textContent = analysis.reason || '';
    $('frequencyText').textContent = analysis.frequency || '—';
    $('reasonText').textContent = analysis.reason || '—';

    const labelBanner = $('labelCompletion');
    if (analysis.qualityAssessment?.dataConfidence && analysis.qualityAssessment.dataConfidence !== 'High') {
      labelBanner.textContent = `Data confidence: ${analysis.qualityAssessment.dataConfidence}. Some nutrition fields are missing for this product, so treat this result as a guide rather than certainty.`;
      labelBanner.classList.add('active');
    } else {
      labelBanner.classList.remove('active');
    }

    renderIngredients(analysis.ingredientAnalysis || []);
    renderQuantity(analysis.quantityAnalysis || {});
    renderQuality(analysis.qualityAssessment || {});
    renderHazards(analysis.hazardAnalysis || []);
    switchDetailTab('ingredients');
  }

  function renderIngredients(list) {
    const container = $('ingredientsList');
    if (!list.length) {
      container.innerHTML = '<p class="empty-note">No ingredient data available for this product.</p>';
      return;
    }
    container.innerHTML = list.map(ing => `
      <div class="ingredient-row">
        <div>
          <div class="ing-name">${escapeHtml(ing.name)}</div>
          <div class="ing-desc">${escapeHtml(ing.description || '')}</div>
        </div>
        <span class="tag ${escapeHtml(ing.concern || 'none')}">${escapeHtml(ing.concern || 'none')}</span>
      </div>
    `).join('');
  }

  const QUANTITY_LABELS = {
    sugar: { label: 'Sugar', icon: 'fa-cube' },
    sodium: { label: 'Sodium', icon: 'fa-flask' },
    saturatedFat: { label: 'Saturated fat', icon: 'fa-droplet' },
    transFat: { label: 'Trans fat', icon: 'fa-droplet-slash' },
    calories: { label: 'Calories', icon: 'fa-fire' },
    fiber: { label: 'Fiber', icon: 'fa-wheat-awn' }
  };

  function levelClass(level) {
    if (!level) return 'moderate';
    const normalized = level.toLowerCase();
    if (normalized.includes('very high') || normalized === 'high') return 'high';
    if (normalized.includes('moderate')) return 'moderate';
    return 'none';
  }

  function renderQuantity(quantity) {
    const container = $('quantityGrid');
    const entries = Object.entries(quantity);
    if (!entries.length) {
      container.innerHTML = '<p class="empty-note">No quantity data available.</p>';
      return;
    }
    container.innerHTML = entries.map(([key, info]) => {
      const meta = QUANTITY_LABELS[key] || { label: key, icon: 'fa-circle' };
      const displayValue = info.known ? `${info.value}${info.unit}` : 'Not declared';
      return `
        <div class="quantity-card">
          <div class="q-label"><i class="fas ${meta.icon}"></i> ${escapeHtml(meta.label)}</div>
          <div class="q-value">${escapeHtml(displayValue)}</div>
          <div class="q-level tag ${levelClass(info.level)}" style="display:inline-block;">${escapeHtml(info.level || 'Unknown')}</div>
        </div>`;
    }).join('');
  }

  function renderQuality(quality) {
    const scoreEl = $('qualityScore');
    if (quality.score === null || quality.score === undefined) {
      scoreEl.innerHTML = '<span class="score-number">—</span><span class="score-max">/ 100 (not enough data to score)</span>';
    } else {
      scoreEl.innerHTML = `<span class="score-number">${quality.score}</span><span class="score-max">/ 100</span>`;
    }

    const rows = [
      ['Data confidence', quality.dataConfidence],
      ['Nutrition fields available', quality.availableData !== undefined ? `${quality.availableData} / ${quality.totalDataFields}` : '—'],
      ['Whole grains', quality.hasWholeGrains ? 'Yes' : 'No'],
      ['Fiber content', quality.fiberContent],
      ['Protein content', quality.proteinContent],
      ['Processing level', quality.processingLevel]
    ];
    $('qualityDetails').innerHTML = rows.map(([label, value]) => `
      <div class="quality-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value ?? '—')}</span></div>
    `).join('');
  }

  function renderHazards(list) {
    const container = $('hazardsList');
    if (!list.length) {
      container.innerHTML = '<p class="empty-note">No specific hazards flagged for this product.</p>';
      return;
    }
    const icon = { high: 'fa-circle-exclamation', moderate: 'fa-triangle-exclamation', unknown: 'fa-circle-question' };
    container.innerHTML = list.map(hazard => `
      <div class="hazard-row ${escapeHtml(hazard.severity || 'unknown')}">
        <i class="fas ${icon[hazard.severity] || 'fa-circle-info'}"></i>
        <p>${escapeHtml(hazard.description)}</p>
      </div>
    `).join('');
  }

  window.switchDetailTab = function (tab) {
    document.querySelectorAll('.detail-tab').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.detail-panel').forEach(panel => panel.classList.remove('active'));
    document.querySelectorAll('.detail-tabs .detail-tab').forEach(btn => {
      if (btn.textContent.trim().toLowerCase() === tab) btn.classList.add('active');
    });
    $(tab + 'Tab')?.classList.add('active');
  };

  // ---------------- Health profile ----------------
  function populateHealthProfileForm(profile) {
    if (!profile) return;
    if (profile.name) $('profileName').value = profile.name;
    if (profile.age) $('profileAge').value = profile.age;
    if (profile.gender) $('profileGender').value = profile.gender;
    if (profile.weight) $('profileWeight').value = profile.weight;
    $('condDiabetes').checked = !!profile.diabetes;
    $('condHypertension').checked = !!profile.hypertension;
    $('condHeart').checked = !!profile.heartDisease;
    $('condObesity').checked = !!profile.obesity;
    $('condCeliac').checked = !!profile.celiac;
    $('condKidney').checked = !!profile.kidneyDisease;
    if (profile.diet) {
      const radio = document.querySelector(`input[name="diet"][value="${profile.diet}"]`);
      if (radio) radio.checked = true;
    }
  }

  window.saveHealthProfile = async function (event) {
    event.preventDefault();
    const profile = {
      name: $('profileName').value.trim(),
      age: $('profileAge').value ? Number($('profileAge').value) : null,
      gender: $('profileGender').value,
      weight: $('profileWeight').value ? Number($('profileWeight').value) : null,
      diabetes: $('condDiabetes').checked,
      hypertension: $('condHypertension').checked,
      heartDisease: $('condHeart').checked,
      obesity: $('condObesity').checked,
      celiac: $('condCeliac').checked,
      kidneyDisease: $('condKidney').checked,
      diet: document.querySelector('input[name="diet"]:checked')?.value || 'none'
    };

    saveLocalHealthProfile(profile);

    if (authToken) {
      try {
        await apiRequest('/health-profile', { method: 'POST', body: profile });
      } catch (err) {
        showToast(err.message, true);
        return;
      }
    }

    $('profileSaved').classList.add('active');
    if (!authToken) showToast('Saved on this device. Sign in to keep it across devices.');
    setTimeout(() => $('profileSaved').classList.remove('active'), 3500);
  };

  // ---------------- Init ----------------
  document.addEventListener('DOMContentLoaded', () => {
    renderAuthState();
    populateHealthProfileForm(healthProfile);
    restoreSession();
  });
})();
