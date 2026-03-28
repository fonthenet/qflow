// ── Kiosk Application ─────────────────────────────────────────────
// Self-contained kiosk logic. Discovers API from window.location.origin.
// No server-side template injection needed.

(function () {
  'use strict';

  var API = window.location.origin;
  var PAGE_PARAMS = new URLSearchParams(window.location.search || '');
  var REQUESTED_OFFICE_ID = PAGE_PARAMS.get('officeId');
  var OFFICE_QUERY = REQUESTED_OFFICE_ID ? ('?officeId=' + encodeURIComponent(REQUESTED_OFFICE_ID)) : '';
  var CLOUD = ''; // fetched from /api/health
  var S = {
    step: 'loading',
    locale: 'en',
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
  var M = {
    fr: {
      'Take a Ticket': 'Prendre un ticket',
      'Loading...': 'Chargement...',
      'Cannot Connect': 'Connexion impossible',
      'Make sure Qflo Station is running on this network and try refreshing.': 'Assurez-vous que la station Qflo fonctionne sur ce réseau puis actualisez.',
      'Retry': 'Réessayer',
      'Connected': 'Connecté',
      'Welcome - Take a ticket below': 'Bienvenue - prenez un ticket ci-dessous',
      'Closed': 'Fermé',
      'Business Hours': 'Horaires',
      'We Are Currently Closed': 'Nous sommes actuellement fermés',
      'Visit intake is currently closed': "La prise de visites est actuellement fermée",
      'This business is not taking visits right now. Please check back later or contact the business directly.': "Cette entreprise n'accepte pas de visites pour le moment. Veuillez revenir plus tard ou contacter directement l'entreprise.",
      'Closed for {name}': 'Fermé pour {name}',
      'We will be back soon.': 'Nous revenons bientôt.',
      'Not Open Yet': 'Pas encore ouvert',
      'We open at <strong>{time}</strong> today.': "Nous ouvrons à <strong>{time}</strong> aujourd'hui.",
      'Closed for the Day': 'Fermé pour la journée',
      'Closed Today': "Ferme aujourd'hui",
      'Opens {day} at {time}': 'Ouvre {day} à {time}',
      'No wait': "Pas d'attente",
      'In Queue': 'En file',
      'Departments': 'Services',
      'Select Department': 'Choisir un service',
      'Choose the service area you need': "Choisissez le service dont vous avez besoin",
      'Select Service': 'Choisir un service',
      'Back': 'Retour',
      '{minutes} min': '{minutes} min',
      '{count} waiting': '{count} en attente',
      '{count} people ahead of you': '{count} personnes devant vous',
      'You will be first in line': "Vous serez premier dans la file d'attente",
      'Your Details': 'Vos informations',
      'Name (optional)': 'Nom (facultatif)',
      'Enter your name': 'Entrez votre nom',
      'Phone (optional)': 'Téléphone (facultatif)',
      'For WhatsApp alerts': 'Pour les alertes WhatsApp',
      'Reason for visit (optional)': 'Motif de visite (facultatif)',
      'Brief description': 'Brève description',
      'Get Ticket': 'Prendre un ticket',
      'Creating...': 'Création...',
      'Something went wrong. Please try again.': "Un problème est survenu. Veuillez réessayer.",
      'Your ticket is ready!': 'Votre ticket est prêt !',
      'YOUR TICKET NUMBER': 'VOTRE NUMÉRO DE TICKET',
      'Track Your Position': 'Suivre votre position',
      'Scan this QR code to follow your place in the queue from your phone.': "Scannez ce code QR pour suivre votre place dans la file d'attente depuis votre t\u00e9l\u00e9phone.",
      'Done': "Termin\u00e9",
      'Take Another Ticket': 'Prendre un autre ticket',
      '#{position} in queue': "#{position} dans la file d'attente",
      'WhatsApp notifications active': "Notifications WhatsApp activ\u00e9es",
      'You will receive updates on WhatsApp': "Vous recevrez les mises \u00e0 jour sur WhatsApp",
      'Sunday': 'Dimanche',
      'Monday': 'Lundi',
      'Tuesday': 'Mardi',
      'Wednesday': 'Mercredi',
      'Thursday': 'Jeudi',
      'Friday': 'Vendredi',
      'Saturday': 'Samedi'
    },
    ar: {
      'Take a Ticket': 'احصل على تذكرة',
      'Loading...': 'جار التحميل...',
      'Cannot Connect': 'تعذر الاتصال',
      'Make sure Qflo Station is running on this network and try refreshing.': 'تأكد من أن محطة Qflo تعمل على هذه الشبكة ثم أعد التحديث.',
      'Retry': 'إعادة المحاولة',
      'Connected': 'متصل',
      'Welcome - Take a ticket below': 'مرحباً - خذ تذكرة من الأسفل',
      'Closed': 'مغلق',
      'Business Hours': 'ساعات العمل',
      'We Are Currently Closed': 'نحن مغلقون حالياً',
      'Visit intake is currently closed': 'استقبال الزيارات مغلق حالياً',
      'This business is not taking visits right now. Please check back later or contact the business directly.': 'هذه المنشأة لا تستقبل الزيارات حالياً. يرجى المحاولة لاحقاً أو التواصل معها مباشرة.',
      'Closed for {name}': 'مغلق بسبب {name}',
      'We will be back soon.': 'سنعود قريباً.',
      'Not Open Yet': 'لم نفتتح بعد',
      'We open at <strong>{time}</strong> today.': 'نفتح اليوم عند <strong>{time}</strong>.',
      'Closed for the Day': 'مغلق لباقي اليوم',
      'Closed Today': 'مغلق اليوم',
      'Opens {day} at {time}': 'يفتح {day} عند {time}',
      'No wait': 'لا يوجد انتظار',
      'In Queue': 'في الطابور',
      'Departments': 'الأقسام',
      'Select Department': 'اختر القسم',
      'Choose the service area you need': 'اختر منطقة الخدمة التي تحتاجها',
      'Select Service': 'اختر الخدمة',
      'Back': 'رجوع',
      '{minutes} min': '{minutes} دقيقة',
      '{count} waiting': '{count} انتظار',
      '{count} people ahead of you': 'هناك {count} أشخاص قبلك',
      'You will be first in line': 'ستكون الأول في الطابور',
      'Your Details': 'بياناتك',
      'Name (optional)': 'الاسم (اختياري)',
      'Enter your name': 'أدخل اسمك',
      'Phone (optional)': 'الهاتف (اختياري)',
      'For WhatsApp alerts': 'لتنبيهات واتساب',
      'Reason for visit (optional)': 'سبب الزيارة (اختياري)',
      'Brief description': 'وصف مختصر',
      'Get Ticket': 'احصل على تذكرة',
      'Creating...': 'جار الإنشاء...',
      'Something went wrong. Please try again.': 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
      'Your ticket is ready!': 'تذكرتك جاهزة!',
      'YOUR TICKET NUMBER': 'رقم تذكرتك',
      'Track Your Position': 'تتبع موقعك',
      'Scan this QR code to follow your place in the queue from your phone.': 'امسح رمز QR هذا لمتابعة مكانك في الطابور من هاتفك.',
      'Done': 'تم',
      'Take Another Ticket': 'احصل على تذكرة أخرى',
      '#{position} in queue': '#{position} في الطابور',
      'WhatsApp notifications active': 'إشعارات واتساب مفعّلة',
      'You will receive updates on WhatsApp': 'ستتلقى التحديثات عبر واتساب',
      'Sunday': 'الأحد',
      'Monday': 'الاثنين',
      'Tuesday': 'الثلاثاء',
      'Wednesday': 'الأربعاء',
      'Thursday': 'الخميس',
      'Friday': 'الجمعة',
      'Saturday': 'السبت'
    }
  };

  function tr(key, values) {
    var table = M[S.locale] || {};
    var text = table[key] || key;
    if (!values) return text;
    return text.replace(/\{(\w+)\}/g, function (_, name) {
      return values[name] == null ? '' : String(values[name]);
    });
  }

  function setLocale(locale) {
    S.locale = (locale || 'en').split('-')[0];
    document.documentElement.lang = S.locale;
    document.documentElement.dir = S.locale === 'ar' ? 'rtl' : 'ltr';
    document.title = tr('Take a Ticket');
    var loading = document.getElementById('kiosk-loading');
    if (loading) loading.innerHTML = tr('Loading...');
  }

  window.setKioskLocale = async function (locale) {
    try {
      var res = await fetch(API + '/api/station/settings/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: locale })
      });
      var data = await res.json();
      setLocale((data && data.locale) || locale);
      render();
      resetIdle();
    } catch (e) {
      setLocale(locale);
      render();
    }
  };

  // ── Utilities ──────────────────────────────────────────────────

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function capitalize(s) {
    return s ? tr(s.charAt(0).toUpperCase() + s.slice(1)) : '';
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
        if (data.locale) setLocale(data.locale);
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
          var cfgRes = await fetch(API + '/api/kiosk-info' + OFFICE_QUERY, { cache: 'no-store' });
          var cfgData = await cfgRes.json();
          // Fallback: use the kiosk-info data directly
        } catch (e) {}
      }

      var res = await fetch(API + '/api/kiosk-info' + OFFICE_QUERY, { cache: 'no-store' });
      var data = await res.json();
      if (data.error) throw new Error(data.error);

      S.office = data.office;
      setLocale(data.locale || 'en');
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
        '<div style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:8px">' + tr('Cannot Connect') + '</div>' +
        '<div style="font-size:14px;color:var(--text3);max-width:280px">' + tr('Make sure Qflo Station is running on this network and try refreshing.') + '</div>' +
        '<button onclick="location.reload()" style="margin-top:20px;padding:12px 32px;border-radius:12px;border:none;background:var(--brand);color:white;font-weight:700;font-size:14px;cursor:pointer">' + tr('Retry') + '</button>' +
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
    var reasonInput = document.getElementById('creason');
    var btn = document.getElementById('submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>' + tr('Creating...');
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
          customerReason: reasonInput ? reasonInput.value : '',
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
      playSuccessSound();

      // Poll for ticket number rewrite (L-G-004 → G-032) if offline ticket
      if (S.ticket && S.ticket.ticket_number && S.ticket.ticket_number.startsWith('L-')) {
        var ticketIdForPoll = S.ticket.id;
        var pollId = setInterval(async function () {
          try {
            var r = await fetch(API + '/api/track?id=' + encodeURIComponent(ticketIdForPoll));
            if (!r.ok) return;
            var d = await r.json();
            if (d.ticket && d.ticket.ticket_number && !d.ticket.ticket_number.startsWith('L-')) {
              S.ticket.ticket_number = d.ticket.ticket_number;
              var numEl = document.querySelector('.ticket-box .number');
              if (numEl) numEl.textContent = S.ticket.ticket_number;
              clearInterval(pollId);
            }
          } catch (e) { /* ignore */ }
        }, 1500);
        // Stop polling after 30s
        setTimeout(function () { clearInterval(pollId); }, 30000);
      }
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = tr('Get Ticket');
      }
      // Show inline error instead of alert()
      var errEl = document.getElementById('kiosk-error');
      if (errEl) {
        errEl.textContent = err.message || tr('Something went wrong. Please try again.');
        errEl.style.display = 'block';
        setTimeout(function () { if (errEl) errEl.style.display = 'none'; }, 6000);
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

  // ── Success Sound ──────────────────────────────────────────────
  function playSuccessSound() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Two-tone chime: C5 → E5
      [523.25, 659.25].forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.5);
      });
    } catch (e) { /* audio not available */ }
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
        ? (bh.todayHours ? bh.todayHours.close : tr('Connected'))
        : tr('Closed');
      hoursBtn = '<button class="hours-toggle" onclick="toggleHours()" aria-expanded="false" aria-controls="hours-panel">' +
        '<span class="status-dot ' + (isOpen ? 'open' : 'closed') + '"></span>' +
        statusText + ' <span style="font-size:10px;opacity:0.7">&#9660;</span>' +
        '</button>';
    }

    var localeToggle =
      '<div class="locale-switcher" aria-label="Language switcher">' +
      '<button class="locale-btn" onclick="toggleLocaleMenu()">' + S.locale.toUpperCase() + ' <span class="locale-chevron" id="locale-chev">&#9660;</span></button>' +
      '<div class="locale-menu" id="locale-menu">' +
      ['en', 'fr', 'ar'].filter(function (l) { return l !== S.locale; }).map(function (locale) {
        return '<button class="locale-option" onclick="setKioskLocale(\'' + locale + '\')">' + locale.toUpperCase() + '</button>';
      }).join('') +
      '</div>' +
      '</div>';

    return '<div class="kiosk-header" style="position:relative">' +
      '<div style="position:absolute;top:16px;left:16px">' + localeToggle + '</div>' +
      (hoursBtn ? '<div style="position:absolute;top:16px;right:16px">' + hoursBtn + '</div>' : '') +
      '<div class="header-logo">' + logoHtml + '</div>' +
      '<h1>' + esc(displayName) + '</h1>' +
      (S.orgName && S.orgName !== name ? '<div class="subtitle">' + esc(name) + '</div>' : '<div class="subtitle">' + tr('Welcome - Take a ticket below') + '</div>') +
      '<div class="conn-dot" id="kconn">' + tr('Connected') + '</div>' +
      '</div>';
  }

  // ── Locale menu toggle ─────────────────────────────────────────
  window.toggleLocaleMenu = function () {
    var menu = document.getElementById('locale-menu');
    var chev = document.getElementById('locale-chev');
    if (!menu) return;
    var open = menu.classList.toggle('open');
    if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
  };

  // Close locale menu on outside click
  document.addEventListener('click', function (e) {
    var switcher = document.querySelector('.locale-switcher');
    var menu = document.getElementById('locale-menu');
    if (menu && switcher && !switcher.contains(e.target)) {
      menu.classList.remove('open');
      var chev = document.getElementById('locale-chev');
      if (chev) chev.style.transform = '';
    }
  });

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
        '<td>' + (closed ? '<span style="color:var(--text3)">' + tr('Closed') + '</span>' : h.open + ' – ' + h.close) + '</td>' +
        '</tr>';
    }).join('');
    return '<div id="hours-panel" class="hours-panel" role="region" aria-label="' + tr('Business Hours') + '">' +
      '<div class="hours-title">' + tr('Business Hours') + '</div>' +
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
      var title = tr('We Are Currently Closed');
      var subtitle = '';

      if (reason === 'always_closed') {
        title = tr('Visit intake is currently closed');
        subtitle = tr('This business is not taking visits right now. Please check back later or contact the business directly.');
      } else if (reason === 'holiday' && bh.holidayName) {
        title = tr('Closed for {name}', { name: esc(bh.holidayName) });
        subtitle = tr('We will be back soon.');
      } else if (reason === 'before_hours' && bh.todayHours) {
        title = tr('Not Open Yet');
        subtitle = tr('We open at <strong>{time}</strong> today.', { time: bh.todayHours.open });
      } else if (reason === 'after_hours') {
        title = tr('Closed for the Day');
      } else if (reason === 'closed_today') {
        title = tr('Closed Today');
      }

      if (bh.nextOpen) {
        var nextText = tr('Opens {day} at {time}', { day: capitalize(bh.nextOpen.day), time: bh.nextOpen.time });
        if (!subtitle) subtitle = nextText;
      }

      // Build schedule table for closed screen (always visible, not in collapsible panel)
      var closedSchedule = renderScheduleTable();

      app.innerHTML = renderHeader({ hideHours: true }).replace(tr('Welcome - Take a ticket below'), '') +
        '<div class="kiosk-body"><div class="kiosk-content" style="text-align:center;padding-top:40px">' +
        '<div style="margin:0 auto 24px;width:80px;height:80px;border-radius:50%;background:rgba(239,68,68,0.1);display:flex;align-items:center;justify-content:center">' +
        '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>' +
        '</div>' +
        '<div style="font-size:28px;font-weight:800;color:var(--text);margin-bottom:8px">' + title + '</div>' +
        (subtitle ? '<div style="font-size:16px;color:var(--text2);margin-bottom:32px">' + subtitle + '</div>' : '<div style="margin-bottom:32px"></div>') +
        '<div style="font-size:13px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px">' + tr('Business Hours') + '</div>' +
        closedSchedule +
        '</div></div>';
      return;
    }

    if (S.step === 'department') {
      var totalWaiting = 0;
      var cards = S.departments.map(function (d, i) {
        var counts = S.queueCounts[d.id] || { waiting: 0, estimated_wait: 0 };
        totalWaiting += counts.waiting;
        var waitText = counts.waiting > 0
          ? '<span class="wait-dot"></span>' + tr('{count} waiting', { count: counts.waiting })
          : tr('No wait');
        var initial = d.name ? d.name.charAt(0).toUpperCase() : '?';
        return '<div class="card fade-up" style="animation-delay:' + (i * 0.06) + 's" onclick="selectDept(' + JSON.stringify(d).replace(/"/g, '&quot;') + ')">' +
          '<div class="card-icon">' + initial + '</div>' +
          '<div class="card-body"><div class="card-name">' + esc(d.name) + '</div>' +
          '<div class="card-meta">' + waitText + '</div></div>' +
          '<div class="card-chevron">&#8250;</div>' +
          '</div>';
      }).join('');

      app.innerHTML = renderHeader() + renderHoursPanel() +
        '<div class="kiosk-body"><div class="kiosk-content">' +
        renderSteps() +
        '<div class="queue-stats fade-up"><div class="stat-pill"><div class="stat-num">' + totalWaiting + '</div><div class="stat-label">' + tr('In Queue') + '</div></div>' +
        '<div class="stat-pill"><div class="stat-num">' + S.departments.length + '</div><div class="stat-label">' + tr('Departments') + '</div></div></div>' +
        '<div class="section-title">' + tr('Select Department') + '</div><div class="section-subtitle">' + tr('Choose the service area you need') + '</div>' +
        '<div class="card-list">' + cards + '</div>' +
        '</div></div>';

    } else if (S.step === 'service') {
      var svcs = S.services.filter(function (s) { return s.department_id === S.selectedDept.id; });
      var cards = svcs.map(function (s, i) {
        var est = s.estimated_service_time || 10;
        var initial = s.name ? s.name.charAt(0).toUpperCase() : '?';
        return '<div class="card fade-up" style="animation-delay:' + (i * 0.06) + 's" onclick="selectService(' + JSON.stringify(s).replace(/"/g, '&quot;') + ')">' +
          '<div class="card-icon">' + initial + '</div>' +
          '<div class="card-body"><div class="card-name">' + esc(s.name) + '</div>' +
          '<div class="card-meta">~' + tr('{minutes} min', { minutes: est }) + '</div></div>' +
          '<div class="card-chevron">&#8250;</div>' +
          '</div>';
      }).join('');

      var backStep = S.departments.length === 1 ? 'confirm' : 'department';
      app.innerHTML = renderHeader() + renderHoursPanel() +
        '<div class="kiosk-body"><div class="kiosk-content">' +
        renderSteps() +
        '<div class="section-title">' + tr('Select Service') + '</div><div class="section-subtitle">' + esc(S.selectedDept.name) + '</div>' +
        '<div class="card-list">' + cards + '</div>' +
        '</div></div>';

    } else if (S.step === 'confirm') {
      var counts = S.queueCounts[S.selectedDept ? S.selectedDept.id : ''] || { waiting: 0 };
      var waitMsg = counts.waiting > 0 ? tr('{count} people ahead of you', { count: counts.waiting }) : tr('You will be first in line');

      var backTarget = 'service';
      var isSinglePath = S.departments.length === 1 && S.services.filter(function (s) { return s.department_id === S.selectedDept.id; }).length === 1;
      var backHandler = isSinglePath ? 'reset()' : "goBack('service')";

      app.innerHTML = renderHeader() + renderHoursPanel() +
        '<div class="kiosk-body"><div class="kiosk-content">' +
        renderSteps() +
        '<div class="form-card scale-in">' +
        '<div class="form-header">' +
        '<div class="dept-service">' + esc(tr(S.selectedDept.name)) + (S.selectedService ? ' &mdash; ' + esc(tr(S.selectedService.name)) : '') + '</div>' +
        '<div class="title">' + tr('Your Details') + '</div>' +
        '<div class="subtitle">' + waitMsg + '</div>' +
        '</div>' +
        '<div id="kiosk-error" class="form-error"></div>' +
        '<div class="form-fields">' +
        '<div class="form-group"><label>' + tr('Name (optional)') + '</label><input id="cname" placeholder="' + tr('Enter your name') + '" autocomplete="off"></div>' +
        '<div class="form-group"><label>' + tr('Phone (optional)') + '</label><input id="cphone" placeholder="' + tr('For WhatsApp alerts') + '" type="tel" autocomplete="off"></div>' +
        '<div class="form-group full-width"><label>' + tr('Reason for visit (optional)') + '</label><input id="creason" placeholder="' + tr('Brief description') + '" autocomplete="off"></div>' +
        '</div>' +
        '<button id="submit-btn" class="btn btn-primary btn-large" onclick="takeTicket()">' + tr('Get Ticket') + '</button>' +
        '</div>' +
        '</div></div>';

    } else if (S.step === 'done') {
      var t = S.ticket;
      var trackUrl = (CLOUD || API) + '/ticket/' + t.id;
      var qrHtml = t.qr_data_url
        ? '<img src="' + t.qr_data_url + '" width="200" height="200" style="display:block;image-rendering:pixelated" alt="QR Code">'
        : '';

      // Estimated wait
      var estWait = '';
      var waitMin = t.estimated_wait || t.estimated_service_time;
      if (waitMin) {
        estWait = '<div class="est-wait">⏱ ~' + tr('{minutes} min', { minutes: waitMin }) + '</div>';
      }

      // WhatsApp notification badge (shown when phone was entered)
      var whatsappBadge = t.has_phone
        ? '<div class="whatsapp-badge">' +
          '<div class="icon">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="#16a34a"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
          '<div class="label">' + tr('WhatsApp notifications active') + '</div>' +
          '<div class="sublabel">' + tr('You will receive updates on WhatsApp') + '</div>' +
          '</div>' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' +
          '</div>'
        : '';

      app.innerHTML = renderHeader().replace(tr('Welcome - Take a ticket below'), tr('Your ticket is ready!')) +
        '<div class="kiosk-body"><div class="kiosk-content">' +
        '<div class="result-card scale-in">' +
        '<div class="result-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>' +
        '<div class="result-title">' + tr('Your ticket is ready!') + '</div>' +
        '<div class="ticket-box">' +
        '<div class="label">' + tr('YOUR TICKET NUMBER') + '</div>' +
        '<div class="number">' + esc(t.ticket_number) + '</div>' +
        '<div class="card-meta" style="justify-content:center;font-size:15px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> ' + tr('#{position} in queue', { position: t.position }) + (waitMin ? ' · ⏱ ~' + tr('{minutes} min', { minutes: waitMin }) : '') + '</div>' +
        '</div>' +
        whatsappBadge +
        '<div class="result-divider"></div>' +
        '<div class="qr-section">' +
        '<div class="qr-box">' + qrHtml + '</div>' +
        '<div class="qr-text"><strong>' + tr('Track Your Position') + '</strong>' + tr('Scan this QR code to follow your place in the queue from your phone.') + '</div>' +
        '</div>' +
        '</div>' +
        '<button class="btn btn-done btn-large" onclick="reset()">' + tr('Take Another Ticket') + '</button>' +
        '</div></div>';
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
  setInterval(pingKiosk, 5000);

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
