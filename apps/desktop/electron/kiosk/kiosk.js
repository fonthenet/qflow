// ── Kiosk Application ─────────────────────────────────────────────
// Self-contained kiosk logic. Discovers API from window.location.origin.
// No server-side template injection needed.

(function () {
  'use strict';

  var API = window.location.origin;
  var CLOUD = ''; // fetched from /api/health
  var S = {
    step: 'loading',
    office: null,
    orgName: null,
    logoUrl: null,
    departments: [],
    services: [],
    selectedDept: null,
    selectedService: null,
    ticket: null,
    queueCounts: {},
    businessHours: null, // server-provided business hours info
  };
  var resetTimer = null;
  var idleTimer = null;
  var countdownInterval = null;
  var IDLE_TIMEOUT = 60000;
  var businessCheckInterval = null;

  // ── Utilities ──────────────────────────────────────────────────

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  // ── Idle reset — returns to home after inactivity ──────────────

  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    if (S.step !== 'done' && S.step !== 'closed') {
      idleTimer = setTimeout(function () {
        if (S.step !== 'loading' && S.step !== 'done' && S.step !== 'closed') reset();
      }, IDLE_TIMEOUT);
    }
  }
  document.addEventListener('click', resetIdle);
  document.addEventListener('touchstart', resetIdle);

  // ── Fetch queue counts for real-time display ───────────────────

  function fetchQueueCounts() {
    if (!S.office) return;
    fetch(API + '/api/queue-status?officeId=' + S.office.id)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.departments) {
          S.queueCounts = {};
          data.departments.forEach(function (d) {
            S.queueCounts[d.id] = { waiting: d.waiting || 0, estimated_wait: d.estimated_wait || 0 };
          });
        }
      })
      .catch(function () {});
  }

  // ── Check business hours periodically ──────────────────────────

  function checkBusinessHours() {
    if (!S.office) return;
    fetch(API + '/api/kiosk-info?officeId=' + S.office.id)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.business_hours) S.businessHours = data.business_hours;
        var wasOpen = S.step !== 'closed';
        var nowOpen = data.is_open !== false;

        if (wasOpen && !nowOpen) {
          // Office just closed — show closed screen
          S.step = 'closed';
          render();
        } else if (!wasOpen && nowOpen) {
          // Office just opened — go back to selection
          reset();
        }
      })
      .catch(function () {});
  }

  // ── Initialize ─────────────────────────────────────────────────

  async function init() {
    try {
      // Fetch cloud URL from health endpoint
      try {
        var healthRes = await fetch(API + '/api/health');
        var health = await healthRes.json();
        if (health.cloud) CLOUD = health.cloud;
      } catch (e) {}

      // If no cloud URL from health, try config
      if (!CLOUD) {
        try {
          var cfgRes = await fetch(API + '/api/kiosk-info');
          var cfgData = await cfgRes.json();
          // Fallback: use the kiosk-info data directly
        } catch (e) {}
      }

      var res = await fetch(API + '/api/kiosk-info');
      var data = await res.json();
      if (data.error) throw new Error(data.error);

      S.office = data.office;
      S.orgName = data.org_name || null;
      S.logoUrl = data.logo_url || null;
      S.departments = data.departments;
      S.services = data.services;
      S.businessHours = data.business_hours || null;

      // Apply brand color if org has one
      if (S.office.settings) {
        try {
          var settings = typeof S.office.settings === 'string' ? JSON.parse(S.office.settings) : S.office.settings;
          if (settings.brand_color) {
            document.documentElement.style.setProperty('--brand', settings.brand_color);
          }
        } catch (e) {}
      }

      fetchQueueCounts();
      setInterval(fetchQueueCounts, 15000);

      // Check business hours every 60s for open/close transitions
      businessCheckInterval = setInterval(checkBusinessHours, 60000);

      // If office is closed, show closed screen
      if (data.is_open === false) {
        S.step = 'closed';
        render();
        return;
      }

      // Smart step skipping
      if (S.departments.length === 1) {
        S.selectedDept = S.departments[0];
        var svcs = S.services.filter(function (s) { return s.department_id === S.departments[0].id; });
        if (svcs.length === 1) {
          S.selectedService = svcs[0];
          S.step = 'confirm';
        } else {
          S.step = 'service';
        }
      } else {
        S.step = 'department';
      }
      render();
      resetIdle();
    } catch (err) {
      document.getElementById('app').innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:32px">' +
        '<div style="font-size:48px;margin-bottom:16px">&#128225;</div>' +
        '<div style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:8px">Cannot Connect</div>' +
        '<div style="font-size:14px;color:var(--text3);max-width:280px">Make sure Qflo Station is running on this network and try refreshing.</div>' +
        '<button onclick="location.reload()" style="margin-top:20px;padding:12px 32px;border-radius:12px;border:none;background:var(--brand);color:white;font-weight:700;font-size:14px;cursor:pointer">Retry</button>' +
        '</div>';
    }
  }

  // ── Navigation ─────────────────────────────────────────────────

  function stepIndex() {
    var steps = ['department', 'service', 'confirm', 'done'];
    if (S.departments.length === 1) steps.shift();
    return { steps: steps, current: steps.indexOf(S.step) };
  }

  // Expose to onclick handlers in rendered HTML
  window.selectDept = function (dept) {
    S.selectedDept = dept;
    var svcs = S.services.filter(function (s) { return s.department_id === dept.id; });
    if (svcs.length === 1) {
      S.selectedService = svcs[0];
      S.step = 'confirm';
    } else {
      S.step = 'service';
    }
    render();
    resetIdle();
  };

  window.selectService = function (svc) {
    S.selectedService = svc;
    S.step = 'confirm';
    render();
    resetIdle();
  };

  window.goBack = function (step) {
    S.step = step;
    if (step === 'department') S.selectedDept = null;
    render();
  };

  window.takeTicket = async function () {
    var nameInput = document.getElementById('cname');
    var phoneInput = document.getElementById('cphone');
    var btn = document.getElementById('submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Creating...';
    }
    try {
      var res = await fetch(API + '/api/take-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId: S.office.id,
          departmentId: S.selectedDept.id,
          serviceId: S.selectedService.id,
          customerName: nameInput ? nameInput.value : '',
          customerPhone: phoneInput ? phoneInput.value : '',
        }),
      });
      var data = await res.json();
      if (data.closed) {
        // Server rejected: office is closed
        S.businessHours = data.business_hours || null;
        S.step = 'closed';
        render();
        return;
      }
      if (data.error) throw new Error(data.error);
      S.ticket = data.ticket;
      S.step = 'done';
      render();
      resetTimer = setTimeout(reset, 20000);
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Get Ticket';
      }
      // Show inline error instead of alert()
      var errEl = document.getElementById('kiosk-error');
      if (errEl) {
        errEl.textContent = err.message || 'Something went wrong. Please try again.';
        errEl.style.display = 'block';
        setTimeout(function () { errEl.style.display = 'none'; }, 5000);
      }
    }
  };

  window.reset = reset;
  function reset() {
    if (resetTimer) clearTimeout(resetTimer);
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    S.selectedService = null;
    S.ticket = null;

    // Re-check business hours on reset
    if (S.businessHours && !S.businessHours.isOpen) {
      S.step = 'closed';
      render();
      return;
    }

    if (S.departments.length === 1) {
      S.selectedDept = S.departments[0];
      var svcs = S.services.filter(function (s) { return s.department_id === S.departments[0].id; });
      if (svcs.length === 1) {
        S.selectedService = svcs[0];
        S.step = 'confirm';
      } else {
        S.step = 'service';
      }
    } else {
      S.step = 'department';
      S.selectedDept = null;
    }
    render();
    resetIdle();
    fetchQueueCounts();
  }

  // ── Render Helpers ─────────────────────────────────────────────

  function renderHeader(opts) {
    opts = opts || {};
    var name = (S.office && S.office.name) ? S.office.name : 'Qflo';
    var displayName = S.orgName || name;
    var logoHtml = S.logoUrl
      ? '<img src="' + esc(S.logoUrl) + '" alt="Logo" onerror="this.parentElement.innerHTML=\'<span>Q</span>\'">'
      : '<span>Q</span>';

    // Business hours toggle button in header
    var hoursBtn = '';
    if (!opts.hideHours && S.businessHours && S.office && S.office.operating_hours) {
      var bh = S.businessHours;
      var isOpen = bh.isOpen;
      var statusText = isOpen
        ? (bh.todayHours ? 'Open until ' + bh.todayHours.close : 'Open')
        : 'Closed';
      hoursBtn = '<button class="hours-toggle" onclick="toggleHours()" aria-expanded="false" aria-controls="hours-panel">' +
        '<span class="status-dot ' + (isOpen ? 'open' : 'closed') + '"></span>' +
        statusText + ' <span style="font-size:10px;opacity:0.7">&#9660;</span>' +
        '</button>';
    }

    return '<div class="kiosk-header" style="position:relative">' +
      (hoursBtn ? '<div style="position:absolute;top:16px;right:16px">' + hoursBtn + '</div>' : '') +
      '<div class="header-logo">' + logoHtml + '</div>' +
      '<h1>' + esc(displayName) + '</h1>' +
      (S.orgName && S.orgName !== name ? '<div class="subtitle">' + esc(name) + '</div>' : '<div class="subtitle">Welcome &mdash; Take a ticket below</div>') +
      '<div class="conn-dot" id="kconn">Connected</div>' +
      '</div>';
  }

  // ── Hours panel toggle ──────────────────────────────────────────
  window.toggleHours = function () {
    var panel = document.getElementById('hours-panel');
    var btn = document.querySelector('.hours-toggle');
    if (!panel) return;
    var open = panel.classList.toggle('open');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  function renderHoursPanel() {
    var oh = S.office && S.office.operating_hours;
    if (!oh || !S.businessHours) return '';
    if (typeof oh === 'string') {
      try { oh = JSON.parse(oh); } catch (e) { return ''; }
    }
    var days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    var currentDay = S.businessHours.currentDay || '';
    var rows = days.map(function (day) {
      var h = oh[day];
      var closed = !h || (h.open === '00:00' && h.close === '00:00');
      var isCurrent = day === currentDay;
      return '<tr class="' + (isCurrent ? 'today' : '') + '">' +
        '<td>' + capitalize(day) + '</td>' +
        '<td>' + (closed ? '<span style="color:var(--text3)">Closed</span>' : h.open + ' – ' + h.close) + '</td>' +
        '</tr>';
    }).join('');
    return '<div id="hours-panel" class="hours-panel" role="region" aria-label="Business hours">' +
      '<div class="hours-title">Business Hours</div>' +
      '<table>' + rows + '</table>' +
      '</div>';
  }

  function renderSteps() {
    var si = stepIndex();
    if (si.steps.length <= 1) return '';
    return '<div class="steps-bar">' + si.steps.map(function (s, i) {
      var cls = 'step-dot';
      if (i < si.current) cls += ' done';
      if (i === si.current) cls += ' active';
      return '<div class="' + cls + '"></div>';
    }).join('') + '</div>';
  }

  function renderScheduleTable() {
    var oh = S.office && S.office.operating_hours;
    if (!oh) return '';
    if (typeof oh === 'string') {
      try { oh = JSON.parse(oh); } catch (e) { return ''; }
    }
    var days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    var currentDay = S.businessHours ? S.businessHours.currentDay : '';
    var rows = days.map(function (day) {
      var h = oh[day];
      var closed = !h || (h.open === '00:00' && h.close === '00:00');
      var isCurrent = day === currentDay;
      return '<tr style="' + (isCurrent ? 'font-weight:700;color:var(--brand)' : 'color:var(--text2)') + '">' +
        '<td style="padding:4px 12px 4px 0;font-size:14px">' + capitalize(day.slice(0, 3)) + '</td>' +
        '<td style="padding:4px 0;font-size:14px;text-align:right">' + (closed ? '<span style="color:var(--text3)">Closed</span>' : h.open + ' &ndash; ' + h.close) + '</td>' +
        '</tr>';
    }).join('');
    return '<table style="margin:0 auto;border-collapse:collapse">' + rows + '</table>';
  }

  // ── Main render ────────────────────────────────────────────────

  function render() {
    var app = document.getElementById('app');

    if (S.step === 'closed') {
      // ── CLOSED SCREEN ────────────────────────────────────────
      var bh = S.businessHours || {};
      var reason = bh.reason || 'closed_today';
      var title = 'We Are Currently Closed';
      var subtitle = '';

      if (reason === 'holiday' && bh.holidayName) {
        title = 'Closed for ' + esc(bh.holidayName);
        subtitle = 'We will be back soon.';
      } else if (reason === 'before_hours' && bh.todayHours) {
        title = 'Not Open Yet';
        subtitle = 'We open at <strong>' + bh.todayHours.open + '</strong> today.';
      } else if (reason === 'after_hours') {
        title = 'Closed for the Day';
      } else if (reason === 'closed_today') {
        title = 'Closed Today';
      }

      if (bh.nextOpen) {
        var nextText = 'Opens ' + capitalize(bh.nextOpen.day) + ' at ' + bh.nextOpen.time;
        if (!subtitle) subtitle = nextText;
      }

      // Build schedule table for closed screen (always visible, not in collapsible panel)
      var closedSchedule = renderScheduleTable();

      app.innerHTML = renderHeader({ hideHours: true }).replace('Welcome &mdash; Take a ticket below', '') +
        '<div class="kiosk-body"><div class="kiosk-content" style="text-align:center;padding-top:40px">' +
        '<div style="margin:0 auto 24px;width:80px;height:80px;border-radius:50%;background:rgba(239,68,68,0.1);display:flex;align-items:center;justify-content:center">' +
        '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>' +
        '</div>' +
        '<div style="font-size:28px;font-weight:800;color:var(--text);margin-bottom:8px">' + title + '</div>' +
        (subtitle ? '<div style="font-size:16px;color:var(--text2);margin-bottom:32px">' + subtitle + '</div>' : '<div style="margin-bottom:32px"></div>') +
        '<div style="font-size:13px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px">Business Hours</div>' +
        closedSchedule +
        '</div></div>';
      return;
    }

    if (S.step === 'department') {
      var totalWaiting = 0;
      var cards = S.departments.map(function (d) {
        var counts = S.queueCounts[d.id] || { waiting: 0, estimated_wait: 0 };
        totalWaiting += counts.waiting;
        var waitText = counts.waiting > 0
          ? '<span class="wait-dot"></span>' + counts.waiting + ' waiting'
          : 'No wait';
        return '<div class="card fade-up" onclick="selectDept(' + JSON.stringify(d).replace(/"/g, '&quot;') + ')">' +
          '<span class="card-icon">&#127973;</span>' + esc(d.name) +
          '<div class="card-meta">' + waitText + '</div>' +
          '</div>';
      }).join('');

      app.innerHTML = renderHeader() + renderHoursPanel() +
        '<div class="kiosk-body"><div class="kiosk-content">' +
        renderSteps() +
        '<div class="queue-stats fade-up"><div class="stat-pill"><div class="stat-num">' + totalWaiting + '</div><div class="stat-label">In Queue</div></div>' +
        '<div class="stat-pill"><div class="stat-num">' + S.departments.length + '</div><div class="stat-label">Departments</div></div></div>' +
        '<div class="section-title">Select Department</div><div class="section-subtitle">Choose the service area you need</div>' +
        '<div class="card-grid">' + cards + '</div>' +
        '</div></div>';

    } else if (S.step === 'service') {
      var svcs = S.services.filter(function (s) { return s.department_id === S.selectedDept.id; });
      var cards = svcs.map(function (s, i) {
        var est = s.estimated_service_time || 10;
        return '<div class="card fade-up" style="animation-delay:' + (i * 0.06) + 's" onclick="selectService(' + JSON.stringify(s).replace(/"/g, '&quot;') + ')">' +
          '<span class="card-icon">&#128203;</span>' + esc(s.name) +
          '<div class="card-meta">~' + est + ' min</div>' +
          '</div>';
      }).join('');

      var backStep = S.departments.length === 1 ? 'confirm' : 'department';
      app.innerHTML = renderHeader() + renderHoursPanel() +
        '<div class="kiosk-body"><div class="kiosk-content">' +
        renderSteps() +
        '<button class="btn-back" onclick="goBack(\'' + backStep + '\')">&larr; Back</button>' +
        '<div class="section-title">Select Service</div><div class="section-subtitle">' + esc(S.selectedDept.name) + '</div>' +
        '<div class="card-grid">' + cards + '</div>' +
        '</div></div>';

    } else if (S.step === 'confirm') {
      var counts = S.queueCounts[S.selectedDept ? S.selectedDept.id : ''] || { waiting: 0 };
      var waitMsg = counts.waiting > 0 ? counts.waiting + ' people ahead of you' : 'You will be first in line';

      var backTarget = 'service';
      var isSinglePath = S.departments.length === 1 && S.services.filter(function (s) { return s.department_id === S.selectedDept.id; }).length === 1;
      var backHandler = isSinglePath ? 'reset()' : "goBack('service')";

      app.innerHTML = renderHeader() + renderHoursPanel() +
        '<div class="kiosk-body"><div class="kiosk-content">' +
        renderSteps() +
        '<button class="btn-back" onclick="' + backHandler + '">&larr; Back</button>' +
        '<div class="form-card scale-in">' +
        '<div style="text-align:center;margin-bottom:20px">' +
        '<div style="font-size:11px;font-weight:700;color:var(--brand);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">' + esc(S.selectedDept.name) + (S.selectedService ? ' &mdash; ' + esc(S.selectedService.name) : '') + '</div>' +
        '<div style="font-size:20px;font-weight:800">Your Details</div>' +
        '<div style="font-size:13px;color:var(--text3);margin-top:4px">' + waitMsg + '</div>' +
        '</div>' +
        '<div id="kiosk-error" style="display:none;padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;color:#dc2626;font-size:13px;font-weight:600;margin-bottom:14px;text-align:center"></div>' +
        '<div class="form-group"><label>Name (optional)</label><input id="cname" placeholder="Enter your name" autocomplete="off"></div>' +
        '<div class="form-group"><label>Phone (optional)</label><input id="cphone" placeholder="For notifications" type="tel" autocomplete="off"></div>' +
        '<button id="submit-btn" class="btn btn-primary btn-large" onclick="takeTicket()">Get Ticket</button>' +
        '</div>' +
        '</div></div>';

    } else if (S.step === 'done') {
      var t = S.ticket;
      var trackUrl = (CLOUD || API) + '/ticket/' + t.id;
      var qrHtml = t.qr_data_url
        ? '<img src="' + t.qr_data_url + '" width="200" height="200" style="display:block;image-rendering:pixelated" alt="QR Code">'
        : '';
      var AUTO_RESET = 20;

      app.innerHTML = renderHeader().replace('Welcome &mdash; Take a ticket below', 'Your ticket is ready!') +
        '<div class="kiosk-body"><div class="kiosk-content">' +
        '<div class="result-card scale-in">' +
        '<div class="result-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>' +
        '<div class="result-label" style="font-size:15px;letter-spacing:2px">YOUR TICKET NUMBER</div>' +
        '<div class="result-number" style="font-size:72px;margin:8px 0">' + esc(t.ticket_number) + '</div>' +
        '<div class="result-position" style="font-size:18px;padding:8px 20px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> #' + t.position + ' in queue</div>' +
        '<div class="result-divider"></div>' +
        '<div class="qr-section" style="gap:20px;padding:20px">' +
        '<div class="qr-box" style="padding:8px">' + qrHtml + '</div>' +
        '<div class="qr-text" style="font-size:15px"><strong style="font-size:16px">Track Your Position</strong>Scan this QR code to follow your place in the queue from your phone.</div>' +
        '</div>' +
        '<a class="track-url" href="' + trackUrl + '" target="_blank">' + trackUrl + '</a>' +
        '<div class="countdown-bar" style="margin-top:24px"><div class="fill" style="animation-duration:' + AUTO_RESET + 's"></div></div>' +
        '<div id="countdown-text" style="text-align:center;font-size:13px;color:var(--text3);margin-top:8px">This screen will reset in <span id="countdown-num">' + AUTO_RESET + '</span> seconds</div>' +
        '</div>' +
        '<button class="btn btn-primary" style="margin-top:16px;font-size:18px" onclick="reset()">Done</button>' +
        '<button class="btn btn-outline" style="margin-top:8px" onclick="reset()">Take Another Ticket</button>' +
        '</div></div>';

      // Live countdown
      var remaining = AUTO_RESET;
      if (countdownInterval) clearInterval(countdownInterval);
      countdownInterval = setInterval(function () {
        remaining--;
        var el = document.getElementById('countdown-num');
        if (el) el.textContent = Math.max(0, remaining);
        if (remaining <= 0) { clearInterval(countdownInterval); countdownInterval = null; }
      }, 1000);
    }
  }

  // ── Device ping ────────────────────────────────────────────────

  var kioskId = localStorage.getItem('qf_device_id') || ('kiosk-' + Math.random().toString(36).substr(2, 6));
  localStorage.setItem('qf_device_id', kioskId);

  function pingKiosk() {
    fetch(API + '/api/device-ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: kioskId, type: 'kiosk', name: 'Local Kiosk' }),
    }).catch(function () {});
  }
  pingKiosk();
  setInterval(pingKiosk, 15000);

  // ── SSE: live updates from Station ─────────────────────────────

  function connectSSE() {
    try {
      var es = new EventSource(API + '/api/events');
      es.onmessage = function () { fetchQueueCounts(); };
      es.onerror = function () {
        es.close();
        // Reconnect after 5s
        setTimeout(connectSSE, 5000);
      };
    } catch (e) {}
  }
  connectSSE();

  // ── Start ──────────────────────────────────────────────────────
  init();
})();
