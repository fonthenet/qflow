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
  var IS_LOCAL = /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost)/.test(window.location.hostname);
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
    selectedPriority: null,
    priorities: null,
    ticket: null,
    queueCounts: {},
    businessHours: null,
    kioskConfig: null, // org-level kiosk settings from dashboard
    whatsappPhone: '',
    messengerPageId: '',
    appointmentStep: null, // null | 'phone' | 'found' | 'not_found'
    appointmentData: null,
    appointmentPhone: '',
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
      'Get Notified': 'Recevoir les notifications',
      'Scan to receive live updates on your phone': 'Scannez pour recevoir les mises \u00e0 jour en direct sur votre t\u00e9l\u00e9phone',
      'WhatsApp': 'WhatsApp',
      'Messenger': 'Messenger',
      'Scan with your phone': 'Scannez avec votre t\u00e9l\u00e9phone',
      'Open WhatsApp and tap Send': 'Ouvrez WhatsApp et appuyez sur Envoyer',
      'Tap "Open Messenger", then tap Get Started': 'Appuyez sur \u00ab Ouvrir Messenger \u00bb, puis D\u00e9marrer',
      'Skip': 'Passer',
      'Back': 'Retour',
      'Sunday': 'Dimanche',
      'Monday': 'Lundi',
      'Tuesday': 'Mardi',
      'Wednesday': 'Mercredi',
      'Thursday': 'Jeudi',
      'Friday': 'Vendredi',
      'Saturday': 'Samedi',
      'English': 'English',
      'Fran\u00e7ais': 'Fran\u00e7ais',
      '\u0627\u0644\u0639\u0631\u0628\u064a\u0629': '\u0627\u0644\u0639\u0631\u0628\u064a\u0629',
      '~{minutes} min wait': '~{minutes} min d\'attente',
      'Select Priority': 'Choisir la priorit\u00e9',
      'Choose your priority level': 'Choisissez votre niveau de priorit\u00e9',
      'Normal': 'Normal',
      'Standard queue': 'File standard',
      'Priority': 'Priorit\u00e9',
      'I Have an Appointment': "J'ai un rendez-vous",
      'Enter your phone number': 'Entrez votre num\u00e9ro de t\u00e9l\u00e9phone',
      'Search': 'Rechercher',
      'Searching...': 'Recherche...',
      'Appointment Found': 'Rendez-vous trouv\u00e9',
      'No Appointment Found': 'Aucun rendez-vous trouv\u00e9',
      'No appointment was found for this phone number.': 'Aucun rendez-vous trouv\u00e9 pour ce num\u00e9ro de t\u00e9l\u00e9phone.',
      'Check In': "S'enregistrer",
      'Checking in...': 'Enregistrement...',
      'Date': 'Date',
      'Time': 'Heure',
      'Service': 'Service',
      'Estimated wait: ~{minutes} minutes': 'Attente estim\u00e9e : ~{minutes} minutes',
      'Phone Number': 'Num\u00e9ro de t\u00e9l\u00e9phone',
      'Please check in at the front desk or use your appointment': 'Veuillez vous enregistrer au comptoir ou utiliser votre rendez-vous'
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
      'Get Notified': 'احصل على الإشعارات',
      'Scan to receive live updates on your phone': 'امسح للحصول على تحديثات مباشرة على هاتفك',
      'WhatsApp': 'واتساب',
      'Messenger': 'ماسنجر',
      'Scan with your phone': 'امسح بهاتفك',
      'Open WhatsApp and tap Send': 'افتح واتساب واضغط إرسال',
      'Tap "Open Messenger", then tap Get Started': 'اضغط «افتح ماسنجر» ثم اضغط ابدأ',
      'Skip': 'تخطي',
      'Back': 'رجوع',
      'Sunday': 'الأحد',
      'Monday': 'الاثنين',
      'Tuesday': 'الثلاثاء',
      'Wednesday': 'الأربعاء',
      'Thursday': 'الخميس',
      'Friday': 'الجمعة',
      'Saturday': 'السبت',
      'English': 'English',
      'Français': 'Français',
      'العربية': 'العربية',
      '~{minutes} min wait': '~{minutes} دقيقة انتظار',
      'Select Priority': 'اختر الأولوية',
      'Choose your priority level': 'اختر مستوى الأولوية',
      'Normal': 'عادي',
      'Standard queue': 'الطابور العادي',
      'Priority': 'الأولوية',
      'I Have an Appointment': 'لدي موعد',
      'Enter your phone number': 'أدخل رقم هاتفك',
      'Search': 'بحث',
      'Searching...': 'جاري البحث...',
      'Appointment Found': 'تم العثور على الموعد',
      'No Appointment Found': 'لم يتم العثور على موعد',
      'No appointment was found for this phone number.': 'لم يتم العثور على موعد لهذا الرقم.',
      'Check In': 'تسجيل الوصول',
      'Checking in...': 'جاري التسجيل...',
      'Date': 'التاريخ',
      'Time': 'الوقت',
      'Service': 'الخدمة',
      'Estimated wait: ~{minutes} minutes': 'الانتظار المتوقع: ~{minutes} دقيقة',
      'Phone Number': 'رقم الهاتف',
      'Please check in at the front desk or use your appointment': 'يرجى التسجيل في مكتب الاستقبال أو استخدام موعدك'
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
    if (S.step !== 'done' && S.step !== 'closed' && S.step !== 'notify') {
      idleTimer = setTimeout(function () {
        if (S.step !== 'loading' && S.step !== 'done' && S.step !== 'closed' && S.step !== 'notify') reset();
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
      S.kioskConfig = data.kiosk_config || null;
      S.checkInMode = data.default_check_in_mode || 'hybrid';
      S.whatsappPhone = data.whatsapp_phone || '';
      S.messengerPageId = data.messenger_page_id || '';
      S.priorities = data.priorities || null;

      // Apply kiosk settings from dashboard (org-level kiosk_config takes priority)
      var kc = S.kioskConfig;
      if (kc) {
        // Theme color: only apply on remote pages; local kiosk keeps default blue
        if (!IS_LOCAL) {
          if (kc.theme_color) {
            document.documentElement.style.setProperty('--brand', kc.theme_color);
          } else if (S.office.settings) {
            try {
              var os = typeof S.office.settings === 'string' ? JSON.parse(S.office.settings) : S.office.settings;
              if (os.brand_color) document.documentElement.style.setProperty('--brand', os.brand_color);
            } catch (e) {}
          }
        }

        // Logo: use kiosk config logo if set
        if (kc.show_logo && kc.logo_url) S.logoUrl = kc.logo_url;
        if (!kc.show_logo) S.logoUrl = null;

        // Idle timeout from dashboard
        if (kc.idle_timeout) IDLE_TIMEOUT = kc.idle_timeout * 1000;

        // Filter hidden departments and services
        if (kc.hidden_departments && kc.hidden_departments.length > 0) {
          S.departments = S.departments.filter(function (d) { return kc.hidden_departments.indexOf(d.id) === -1; });
        }
        if (kc.hidden_services && kc.hidden_services.length > 0) {
          S.services = S.services.filter(function (s) { return kc.hidden_services.indexOf(s.id) === -1; });
        }
      } else if (!IS_LOCAL) {
        // Fallback: apply office brand_color only on remote
        if (S.office.settings) {
          try {
            var settings = typeof S.office.settings === 'string' ? JSON.parse(S.office.settings) : S.office.settings;
            if (settings.brand_color) document.documentElement.style.setProperty('--brand', settings.brand_color);
          } catch (e) {}
        }
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

      // Smart step skipping — respect locked department from dashboard
      var lockedDeptId = kc && kc.locked_department_id;
      var lockedDept = lockedDeptId ? S.departments.find(function (d) { return d.id === lockedDeptId; }) : null;

      if (lockedDept) {
        // Dashboard locked to a specific department — skip dept selection
        S.selectedDept = lockedDept;
        var svcs = S.services.filter(function (s) { return s.department_id === lockedDept.id; });
        if (svcs.length === 1) {
          S.selectedService = svcs[0];
          S.step = 'confirm';
        } else {
          S.step = 'service';
        }
      } else if (S.departments.length === 1) {
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
      var errMsg = (err && err.message) ? err.message : String(err);
      console.error('[kiosk] init failed:', errMsg);
      document.getElementById('app').innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:32px">' +
        '<div style="font-size:48px;margin-bottom:16px">&#128225;</div>' +
        '<div style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:8px">' + tr('Cannot Connect') + '</div>' +
        '<div style="font-size:14px;color:var(--text3);max-width:280px">' + tr('Make sure Qflo Station is running on this network and try refreshing.') + '</div>' +
        '<div style="font-size:11px;color:var(--text3);max-width:360px;margin-top:8px;opacity:0.6;word-break:break-all">' + errMsg + '</div>' +
        '<button onclick="location.reload()" style="margin-top:20px;padding:12px 32px;border-radius:12px;border:none;background:var(--brand);color:white;font-weight:700;font-size:14px;cursor:pointer">' + tr('Retry') + '</button>' +
        '</div>';
    }
  }

  // ── Navigation ─────────────────────────────────────────────────

  function stepIndex() {
    var hasNotify = S.whatsappPhone || S.messengerPageId;
    var steps = ['department', 'service'];
    if (S.priorities && S.priorities.length > 0) steps.push('priority');
    steps.push('confirm');
    if (hasNotify) steps.push('notify');
    steps.push('done');
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
    if (S.priorities && S.priorities.length > 0) {
      S.step = 'priority';
    } else {
      S.step = 'confirm';
    }
    render();
    resetIdle();
  };

  window.selectPriority = function (priorityCategoryId, weight) {
    S.selectedPriority = { categoryId: priorityCategoryId, weight: weight };
    S.step = 'confirm';
    render();
    resetIdle();
  };

  window.showAppointmentCheck = function () {
    S.appointmentStep = 'phone';
    S.appointmentData = null;
    S.appointmentPhone = '';
    S.step = 'appointment';
    render();
    resetIdle();
  };

  window.searchAppointment = async function () {
    var phoneInput = document.getElementById('appt-phone');
    var phone = phoneInput ? phoneInput.value.trim() : '';
    if (!phone) return;
    S.appointmentPhone = phone;
    var btn = document.getElementById('appt-search-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>' + tr('Searching...');
    }
    try {
      var res = await fetch(API + '/api/check-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone, officeId: S.office.id })
      });
      var data = await res.json();
      if (data.appointment) {
        var apptRaw = data.appointment;
        // Derive display-friendly date/time from scheduled_at (cloud schema)
        if (apptRaw.scheduled_at && !apptRaw.date) {
          var dt = new Date(apptRaw.scheduled_at);
          apptRaw.date = dt.toLocaleDateString();
          apptRaw.time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        S.appointmentData = apptRaw;
        S.appointmentStep = 'found';
      } else {
        S.appointmentStep = 'not_found';
      }
      render();
    } catch (err) {
      S.appointmentStep = 'not_found';
      render();
    }
  };

  window.checkInAppointment = async function () {
    var appt = S.appointmentData;
    if (!appt) return;
    var btn = document.getElementById('appt-checkin-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>' + tr('Checking in...');
    }
    try {
      var res = await fetch(API + '/api/take-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId: S.office.id,
          departmentId: appt.department_id,
          serviceId: appt.service_id,
          customerName: appt.customer_name || '',
          customerPhone: S.appointmentPhone || '',
          appointmentId: appt.id,
          priority: 5,
        }),
      });
      var data = await res.json();
      if (data.error) throw new Error(data.error);
      S.ticket = data.ticket;
      var hasNotify = S.whatsappPhone || S.messengerPageId;
      S.step = hasNotify ? 'notify' : 'done';
      render();
      playSuccessSound();
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = tr('Check In');
      }
    }
  };

  window.goBack = function (step) {
    S.step = step;
    if (step === 'department') S.selectedDept = null;
    if (step === 'service') S.selectedPriority = null;
    if (step === 'priority') S.selectedPriority = null;
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
          priorityCategoryId: S.selectedPriority ? S.selectedPriority.categoryId : undefined,
          priority: S.selectedPriority ? S.selectedPriority.weight : undefined,
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
      // If messaging channels available, show notification opt-in; otherwise go to done
      var hasNotify = S.whatsappPhone || S.messengerPageId;
      S.step = hasNotify ? 'notify' : 'done';
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
    S.selectedPriority = null;
    S.ticket = null;
    S.appointmentStep = null;
    S.appointmentData = null;
    S.appointmentPhone = '';

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

  // ── Notification opt-in helpers ─────────────────────────────────

  window.skipNotify = function () {
    S.step = 'done';
    render();
  };

  window.showNotifyQR = function (channel) {
    var t = S.ticket;
    if (!t || !t.qr_token) return;

    var qrUrl = '';
    var instruction = '';
    var icon = '';
    if (channel === 'whatsapp') {
      var phone = S.whatsappPhone.replace(/\D/g, '');
      qrUrl = 'https://wa.me/' + phone + '?text=' + encodeURIComponent('JOIN_' + t.qr_token);
      instruction = tr('Open WhatsApp and tap Send');
      icon = '<svg width="32" height="32" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';
    } else {
      qrUrl = 'https://m.me/' + S.messengerPageId + '?ref=JOIN_' + t.qr_token;
      instruction = tr('Open Messenger and send:') + ' <strong>JOIN ' + t.qr_token + '</strong>';
      icon = '<svg width="32" height="32" viewBox="0 0 24 24" fill="#0084FF"><path d="M12 0C5.373 0 0 4.975 0 11.111c0 3.497 1.745 6.616 4.472 8.652V24l4.086-2.242c1.09.301 2.246.464 3.442.464 6.627 0 12-4.974 12-11.111C24 4.975 18.627 0 12 0zm1.193 14.963l-3.056-3.259-5.963 3.259L10.733 8.1l3.13 3.259L19.752 8.1l-6.559 6.863z"/></svg>';
    }

    // Generate QR code for the URL
    var qrContainer = document.getElementById('notify-qr-container');
    var instrEl = document.getElementById('notify-instruction');
    var channelBtns = document.getElementById('notify-channel-buttons');
    if (!qrContainer) return;

    // Show QR section, hide channel buttons
    if (channelBtns) channelBtns.style.display = 'none';

    qrContainer.innerHTML =
      '<div class="notify-qr-card scale-in">' +
      '<div style="margin-bottom:16px">' + icon + '</div>' +
      '<div class="notify-qr-box" id="notify-qr-img"></div>' +
      '<div style="font-size:15px;font-weight:600;color:var(--text);margin-top:16px">' + tr('Scan with your phone') + '</div>' +
      '<div style="font-size:13px;color:var(--text2);margin-top:4px">' + instruction + '</div>' +
      '<button class="btn btn-back" onclick="backToChannels()" style="margin-top:18px">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> ' +
      tr('Back') + '</button>' +
      '</div>';

    // Server-side QR generation
    var img = document.createElement('img');
    img.src = API + '/api/qr?data=' + encodeURIComponent(qrUrl);
    img.width = 220;
    img.height = 220;
    img.style.display = 'block';
    img.style.imageRendering = 'pixelated';
    img.alt = 'QR Code';
    var imgEl = document.getElementById('notify-qr-img');
    if (imgEl) imgEl.appendChild(img);
  };

  window.backToChannels = function () {
    var channelBtns = document.getElementById('notify-channel-buttons');
    var qrContainer = document.getElementById('notify-qr-container');
    if (channelBtns) channelBtns.style.display = '';
    if (qrContainer) qrContainer.innerHTML = '';
  };

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
      '<button class="locale-btn" onclick="toggleLocaleMenu()">' + S.locale.toUpperCase() + ' <span class="locale-chevron" id="locale-chev"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span></button>' +
      '<div class="locale-menu" id="locale-menu">' +
      ['en', 'fr', 'ar'].filter(function (l) { return l !== S.locale; }).map(function (locale) {
        return '<button class="locale-option" onclick="setKioskLocale(\'' + locale + '\')">' + locale.toUpperCase() + '</button>';
      }).join('') +
      '</div>' +
      '</div>';

    var networkBadge = '<span style="font-size:11px;font-weight:700;color:' + (IS_LOCAL ? 'var(--brand)' : '#16a34a') + ';letter-spacing:0.5px;margin-left:6px">' + (IS_LOCAL ? '🏠 Local' : '🌐 Remote') + '</span>';

    return '<div class="kiosk-header" style="position:relative">' +
      '<div style="position:absolute;top:16px;left:16px;display:flex;align-items:center;gap:8px">' + localeToggle + networkBadge + '</div>' +
      (hoursBtn ? '<div style="position:absolute;top:16px;right:16px">' + hoursBtn + '</div>' : '') +
      '<div class="header-logo">' + logoHtml + '</div>' +
      '<h1>' + esc(displayName) + '</h1>' +
      (S.orgName && S.orgName !== name ? '<div class="subtitle">' + esc(name) + '</div>' : '<div class="subtitle">' + (S.kioskConfig && S.kioskConfig.welcome_message ? esc(S.kioskConfig.welcome_message) : tr('Welcome - Take a ticket below')) + '</div>') +
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
        var estWaitText = counts.estimated_wait > 0
          ? '<div style="font-size:12px;color:var(--text3);margin-top:2px">' + tr('~{minutes} min wait', { minutes: counts.estimated_wait }) + '</div>'
          : '';
        var initial = d.name ? d.name.charAt(0).toUpperCase() : '?';
        return '<div class="card fade-up" style="animation-delay:' + (i * 0.06) + 's" onclick="selectDept(' + JSON.stringify(d).replace(/"/g, '&quot;') + ')">' +
          '<div class="card-icon">' + initial + '</div>' +
          '<div class="card-body"><div class="card-name">' + esc(d.name) + '</div>' +
          '<div class="card-meta">' + waitText + '</div>' + estWaitText + '</div>' +
          '<div class="card-chevron">&#8250;</div>' +
          '</div>';
      }).join('');

      // Language picker pills
      var langPicker =
        '<div style="display:flex;justify-content:center;gap:8px;margin-bottom:16px" class="fade-up">' +
        '<button onclick="setKioskLocale(\'en\')" style="padding:6px 16px;border-radius:20px;border:2px solid ' + (S.locale === 'en' ? 'var(--brand)' : 'var(--border)') + ';background:' + (S.locale === 'en' ? 'var(--brand)' : 'transparent') + ';color:' + (S.locale === 'en' ? '#fff' : 'var(--text2)') + ';font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s">' + tr('English') + '</button>' +
        '<button onclick="setKioskLocale(\'fr\')" style="padding:6px 16px;border-radius:20px;border:2px solid ' + (S.locale === 'fr' ? 'var(--brand)' : 'var(--border)') + ';background:' + (S.locale === 'fr' ? 'var(--brand)' : 'transparent') + ';color:' + (S.locale === 'fr' ? '#fff' : 'var(--text2)') + ';font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s">' + tr('Fran\u00e7ais') + '</button>' +
        '<button onclick="setKioskLocale(\'ar\')" style="padding:6px 16px;border-radius:20px;border:2px solid ' + (S.locale === 'ar' ? 'var(--brand)' : 'var(--border)') + ';background:' + (S.locale === 'ar' ? 'var(--brand)' : 'transparent') + ';color:' + (S.locale === 'ar' ? '#fff' : 'var(--text2)') + ';font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s">' + tr('\u0627\u0644\u0639\u0631\u0628\u064a\u0629') + '</button>' +
        '</div>';

      // Appointment check-in button
      var appointmentBtn =
        '<div style="text-align:center;margin-top:16px" class="fade-up">' +
        '<button onclick="showAppointmentCheck()" style="padding:12px 28px;border-radius:12px;border:2px solid var(--brand);background:transparent;color:var(--brand);font-size:15px;font-weight:700;cursor:pointer;transition:all 0.2s">' +
        '\uD83D\uDCC5 ' + tr('I Have an Appointment') +
        '</button></div>';

      // When check-in mode is "manual", only show appointment check-in (no walk-in tickets)
      if (S.checkInMode === 'manual') {
        app.innerHTML = renderHeader() + renderHoursPanel() +
          '<div class="kiosk-body"><div class="kiosk-content">' +
          langPicker +
          '<div class="queue-stats fade-up"><div class="stat-pill"><div class="stat-num">' + totalWaiting + '</div><div class="stat-label">' + tr('In Queue') + '</div></div></div>' +
          '<div style="text-align:center;margin-top:32px" class="fade-up">' +
          '<div style="font-size:16px;color:var(--text2);margin-bottom:24px">' + tr('Please check in at the front desk or use your appointment') + '</div>' +
          '</div>' +
          appointmentBtn +
          '</div></div>';
      } else {
        app.innerHTML = renderHeader() + renderHoursPanel() +
          '<div class="kiosk-body"><div class="kiosk-content">' +
          langPicker +
          renderSteps() +
          '<div class="queue-stats fade-up"><div class="stat-pill"><div class="stat-num">' + totalWaiting + '</div><div class="stat-label">' + tr('In Queue') + '</div></div>' +
          '<div class="stat-pill"><div class="stat-num">' + S.departments.length + '</div><div class="stat-label">' + tr('Departments') + '</div></div></div>' +
          '<div class="section-title">' + tr('Select Department') + '</div><div class="section-subtitle">' + tr('Choose the service area you need') + '</div>' +
          '<div class="card-list">' + cards + '</div>' +
          appointmentBtn +
          '</div></div>';
      }

    } else if (S.step === 'service') {
      var svcs = S.services.filter(function (s) { return s.department_id === S.selectedDept.id; });
      var cards = svcs.map(function (s, i) {
        var est = s.estimated_service_time || 10;
        var iconContent = s.icon || (s.name ? s.name.charAt(0).toUpperCase() : '?');
        var iconStyle = s.color ? 'background:' + s.color + ';color:#fff' : '';
        return '<div class="card fade-up" style="animation-delay:' + (i * 0.06) + 's" onclick="selectService(' + JSON.stringify(s).replace(/"/g, '&quot;') + ')">' +
          '<div class="card-icon"' + (iconStyle ? ' style="' + iconStyle + '"' : '') + '>' + iconContent + '</div>' +
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

    } else if (S.step === 'priority') {
      // Priority selection step
      var priorityCards = '';
      // Normal (no priority) option
      priorityCards += '<div class="card fade-up" style="animation-delay:0s" onclick="selectPriority(null, 0)">' +
        '<div class="card-icon" style="background:#e5e7eb;color:#374151">&#128100;</div>' +
        '<div class="card-body"><div class="card-name">' + tr('Normal') + '</div>' +
        '<div class="card-meta">' + tr('Standard queue') + '</div></div>' +
        '<div class="card-chevron">&#8250;</div>' +
        '</div>';
      // Priority categories
      if (S.priorities) {
        S.priorities.forEach(function (p, i) {
          var pIcon = p.icon || '\u26A1';
          var pColor = p.color || 'var(--brand)';
          priorityCards += '<div class="card fade-up" style="animation-delay:' + ((i + 1) * 0.06) + 's" onclick="selectPriority(\'' + p.id + '\', ' + (p.weight || 10) + ')">' +
            '<div class="card-icon" style="background:' + pColor + ';color:#fff">' + pIcon + '</div>' +
            '<div class="card-body"><div class="card-name">' + esc(p.name) + '</div>' +
            '<div class="card-meta">' + (p.description ? esc(p.description) : tr('Priority')) + '</div></div>' +
            '<div class="card-chevron">&#8250;</div>' +
            '</div>';
        });
      }

      var priorityBackStep = 'service';
      var svcCount = S.services.filter(function (s) { return s.department_id === S.selectedDept.id; }).length;
      if (svcCount <= 1) priorityBackStep = S.departments.length === 1 ? 'department' : 'department';

      app.innerHTML = renderHeader() + renderHoursPanel() +
        '<div class="kiosk-body"><div class="kiosk-content">' +
        renderSteps() +
        '<div class="section-title">' + tr('Select Priority') + '</div><div class="section-subtitle">' + tr('Choose your priority level') + '</div>' +
        '<div class="card-list">' + priorityCards + '</div>' +
        '</div></div>';

    } else if (S.step === 'appointment') {
      // Appointment check-in flow
      var appointmentContent = '';
      if (S.appointmentStep === 'phone' || !S.appointmentStep) {
        appointmentContent =
          '<div class="form-card scale-in">' +
          '<div class="form-header">' +
          '<div class="title">' + tr('I Have an Appointment') + '</div>' +
          '<div class="subtitle">' + tr('Enter your phone number') + '</div>' +
          '</div>' +
          '<div class="form-fields">' +
          '<div class="form-group full-width"><label>' + tr('Phone Number') + '</label><input id="appt-phone" placeholder="' + tr('Enter your phone number') + '" type="tel" autocomplete="off" style="font-size:18px;text-align:center"></div>' +
          '</div>' +
          '<button id="appt-search-btn" class="btn btn-primary btn-large" onclick="searchAppointment()">' + tr('Search') + '</button>' +
          '<button class="btn btn-back" onclick="reset()" style="margin-top:12px">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> ' +
          tr('Back') + '</button>' +
          '</div>';
      } else if (S.appointmentStep === 'found' && S.appointmentData) {
        var appt = S.appointmentData;
        appointmentContent =
          '<div class="form-card scale-in">' +
          '<div class="form-header">' +
          '<div style="margin:0 auto 12px;width:56px;height:56px;border-radius:50%;background:rgba(34,197,94,0.1);display:flex;align-items:center;justify-content:center">' +
          '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></div>' +
          '<div class="title">' + tr('Appointment Found') + '</div>' +
          '</div>' +
          '<div style="background:var(--bg2);border-radius:12px;padding:16px;margin-bottom:20px">' +
          (appt.date ? '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px"><span style="color:var(--text3)">' + tr('Date') + '</span><span style="font-weight:600;color:var(--text)">' + esc(appt.date) + '</span></div>' : '') +
          (appt.time ? '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px"><span style="color:var(--text3)">' + tr('Time') + '</span><span style="font-weight:600;color:var(--text)">' + esc(appt.time) + '</span></div>' : '') +
          (appt.service_name ? '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px"><span style="color:var(--text3)">' + tr('Service') + '</span><span style="font-weight:600;color:var(--text)">' + esc(appt.service_name) + '</span></div>' : '') +
          '</div>' +
          '<button id="appt-checkin-btn" class="btn btn-primary btn-large" onclick="checkInAppointment()">' + tr('Check In') + '</button>' +
          '<button class="btn btn-back" onclick="reset()" style="margin-top:12px">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> ' +
          tr('Back') + '</button>' +
          '</div>';
      } else if (S.appointmentStep === 'not_found') {
        appointmentContent =
          '<div class="form-card scale-in">' +
          '<div class="form-header">' +
          '<div style="margin:0 auto 12px;width:56px;height:56px;border-radius:50%;background:rgba(239,68,68,0.1);display:flex;align-items:center;justify-content:center">' +
          '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg></div>' +
          '<div class="title">' + tr('No Appointment Found') + '</div>' +
          '<div class="subtitle">' + tr('No appointment was found for this phone number.') + '</div>' +
          '</div>' +
          '<button class="btn btn-primary btn-large" onclick="showAppointmentCheck()">' + tr('Search') + '</button>' +
          '<button class="btn btn-back" onclick="reset()" style="margin-top:12px">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> ' +
          tr('Back') + '</button>' +
          '</div>';
      }

      app.innerHTML = renderHeader() +
        '<div class="kiosk-body"><div class="kiosk-content">' +
        appointmentContent +
        '</div></div>';

    } else if (S.step === 'confirm') {
      var counts = S.queueCounts[S.selectedDept ? S.selectedDept.id : ''] || { waiting: 0 };
      var waitMsg = counts.waiting > 0 ? tr('{count} people ahead of you', { count: counts.waiting }) : tr('You will be first in line');

      var backTarget = 'service';
      var isSinglePath = S.departments.length === 1 && S.services.filter(function (s) { return s.department_id === S.selectedDept.id; }).length === 1;
      var backHandler = isSinglePath ? 'reset()' : (S.priorities && S.priorities.length > 0 ? "goBack('priority')" : "goBack('service')");

      // Priority badge
      var priorityBadge = '';
      if (S.selectedPriority && S.selectedPriority.categoryId) {
        var pCat = S.priorities ? S.priorities.find(function (p) { return p.id === S.selectedPriority.categoryId; }) : null;
        if (pCat) {
          priorityBadge = '<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;background:' + (pCat.color || 'var(--brand)') + ';color:#fff;font-size:13px;font-weight:600;margin-top:6px">' +
            (pCat.icon || '\u26A1') + ' ' + esc(pCat.name) + '</div>';
        }
      }

      app.innerHTML = renderHeader() + renderHoursPanel() +
        '<div class="kiosk-body"><div class="kiosk-content">' +
        renderSteps() +
        '<div class="form-card scale-in">' +
        '<div class="form-header">' +
        '<div class="dept-service">' + esc(tr(S.selectedDept.name)) + (S.selectedService ? ' &mdash; ' + esc(tr(S.selectedService.name)) : '') + '</div>' +
        priorityBadge +
        '<div class="title">' + tr('Your Details') + '</div>' +
        '<div class="subtitle">' + waitMsg + '</div>' +
        '</div>' +
        '<div id="kiosk-error" class="form-error"></div>' +
        '<div class="form-fields">' +
        '<div class="form-group"><label>' + tr('Name (optional)') + '</label><input id="cname" placeholder="' + tr('Enter your name') + '" autocomplete="off"></div>' +
        '<div class="form-group"><label>' + tr('Phone (optional)') + '</label><input id="cphone" placeholder="' + tr('For WhatsApp alerts') + '" type="tel" autocomplete="off"></div>' +
        '<div class="form-group full-width"><label>' + tr('Reason for visit (optional)') + '</label><input id="creason" placeholder="' + tr('Brief description') + '" autocomplete="off"></div>' +
        '</div>' +
        '<button id="submit-btn" class="btn btn-primary btn-large" onclick="takeTicket()">' + (S.kioskConfig && S.kioskConfig.button_label ? esc(S.kioskConfig.button_label) : tr('Get Ticket')) + '</button>' +
        '</div>' +
        '</div></div>';

    } else if (S.step === 'notify') {
      var t = S.ticket;
      var hasWA = Boolean(S.whatsappPhone);
      var hasMessenger = Boolean(S.messengerPageId);

      var channelButtons = '';
      if (hasWA) {
        channelButtons +=
          '<button class="notify-channel-btn whatsapp" onclick="showNotifyQR(\'whatsapp\')">' +
          '<svg width="36" height="36" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' +
          '<span>' + tr('WhatsApp') + '</span>' +
          '</button>';
      }
      if (hasMessenger) {
        channelButtons +=
          '<button class="notify-channel-btn messenger" onclick="showNotifyQR(\'messenger\')">' +
          '<svg width="36" height="36" viewBox="0 0 24 24" fill="#0084FF"><path d="M12 0C5.373 0 0 4.975 0 11.111c0 3.497 1.745 6.616 4.472 8.652V24l4.086-2.242c1.09.301 2.246.464 3.442.464 6.627 0 12-4.974 12-11.111C24 4.975 18.627 0 12 0zm1.193 14.963l-3.056-3.259-5.963 3.259L10.733 8.1l3.13 3.259L19.752 8.1l-6.559 6.863z"/></svg>' +
          '<span>' + tr('Messenger') + '</span>' +
          '</button>';
      }

      // Ticket summary at top
      var ticketSummary =
        '<div class="notify-ticket-summary">' +
        '<div class="result-check small"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>' +
        '<div class="notify-ticket-number">' + esc(t.ticket_number) + '</div>' +
        '<div class="card-meta" style="justify-content:center;font-size:14px">' + tr('#{position} in queue', { position: t.position }) + '</div>' +
        '</div>';

      app.innerHTML = renderHeader() +
        '<div class="kiosk-body"><div class="kiosk-content">' +
        renderSteps() +
        ticketSummary +
        '<div class="section-title">' + tr('Get Notified') + '</div>' +
        '<div class="section-subtitle">' + tr('Scan to receive live updates on your phone') + '</div>' +
        '<div id="notify-channel-buttons" class="notify-channels">' + channelButtons + '</div>' +
        '<div id="notify-qr-container"></div>' +
        '<button class="btn btn-skip" onclick="skipNotify()">' + tr('Skip') + '</button>' +
        '</div></div>';

    } else if (S.step === 'done') {
      var t = S.ticket;
      var trackUrl = (CLOUD || API) + '/q/' + t.qr_token;
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

      // Messaging QR codes (WhatsApp / Messenger) for receiving notifications
      var hasWA = Boolean(S.whatsappPhone);
      var hasMessenger = Boolean(S.messengerPageId);
      var messagingQRs = '';
      if (hasWA || hasMessenger) {
        var waPhone = hasWA ? S.whatsappPhone.replace(/\D/g, '') : '';
        var waUrl = 'https://wa.me/' + waPhone + '?text=' + encodeURIComponent('JOIN_' + t.qr_token);
        var messengerUrl = 'https://m.me/' + S.messengerPageId + '?ref=' + encodeURIComponent('JOIN_' + t.qr_token);

        messagingQRs = '<div class="result-divider"></div>' +
          '<div style="text-align:center;margin-bottom:12px">' +
          '<div style="font-size:15px;font-weight:600;color:var(--text)">' + tr('Get Notified') + '</div>' +
          '<div style="font-size:13px;color:var(--text2);margin-top:2px">' + tr('Scan to receive live updates on your phone') + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:24px;justify-content:center;align-items:flex-start">';

        if (hasWA) {
          messagingQRs +=
            '<div style="text-align:center">' +
            '<img src="' + API + '/api/qr?data=' + encodeURIComponent(waUrl) + '" width="160" height="160" style="display:block;image-rendering:pixelated;border-radius:12px" alt="WhatsApp QR">' +
            '<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' +
            '<span style="font-size:13px;font-weight:600;color:#25D366">WhatsApp</span>' +
            '</div>' +
            '</div>';
        }
        if (hasMessenger) {
          messagingQRs +=
            '<div style="text-align:center">' +
            '<img src="' + API + '/api/qr?data=' + encodeURIComponent(messengerUrl) + '" width="160" height="160" style="display:block;image-rendering:pixelated;border-radius:12px" alt="Messenger QR">' +
            '<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="#0084FF"><path d="M12 0C5.373 0 0 4.975 0 11.111c0 3.497 1.745 6.616 4.472 8.652V24l4.086-2.242c1.09.301 2.246.464 3.442.464 6.627 0 12-4.974 12-11.111C24 4.975 18.627 0 12 0zm1.193 14.963l-3.056-3.259-5.963 3.259L10.733 8.1l3.13 3.259L19.752 8.1l-6.559 6.863z"/></svg>' +
            '<span style="font-size:13px;font-weight:600;color:#0084FF">Messenger</span>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text2);margin-top:4px">Send: <strong>JOIN ' + esc(t.qr_token) + '</strong></div>' +
            '</div>';
        }
        messagingQRs += '</div>';
      }

      app.innerHTML = renderHeader().replace(tr('Welcome - Take a ticket below'), tr('Your ticket is ready!')) +
        '<div class="kiosk-body"><div class="kiosk-content">' +
        '<div class="result-card scale-in">' +
        '<div class="result-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>' +
        '<div class="result-title">' + tr('Your ticket is ready!') + '</div>' +
        '<div class="ticket-box">' +
        '<div class="label">' + tr('YOUR TICKET NUMBER') + '</div>' +
        '<div class="number">' + esc(t.ticket_number) + '</div>' +
        '<div class="card-meta" style="justify-content:center;font-size:15px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> ' + tr('#{position} in queue', { position: t.position }) + '</div>' +
        '</div>' +
        (waitMin ? '<div style="text-align:center;margin-top:12px;padding:10px 20px;background:rgba(59,130,246,0.08);border-radius:10px;font-size:16px;font-weight:600;color:var(--brand)">&#9202; ' + tr('Estimated wait: ~{minutes} minutes', { minutes: waitMin }) + '</div>' : '') +
        whatsappBadge +
        '<div class="result-divider"></div>' +
        '<div class="qr-section">' +
        '<div class="qr-box">' + qrHtml + '</div>' +
        '<div class="qr-text"><strong>' + tr('Track Your Position') + '</strong>' + tr('Scan this QR code to follow your place in the queue from your phone.') + '</div>' +
        '</div>' +
        messagingQRs +
        '</div>' +
        '<button class="btn btn-done btn-large" onclick="reset()">' + tr('Done') + '</button>' +
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
  setInterval(pingKiosk, 10000);

  // ── SSE: live updates from Station (with heartbeat detection) ──

  var sseAlive = false;
  var lastSSEHeartbeat = 0;
  var queueDebounce = null;

  function debouncedQueueFetch() {
    if (queueDebounce) clearTimeout(queueDebounce);
    queueDebounce = setTimeout(function() { queueDebounce = null; fetchQueueCounts(); }, 200);
  }

  function connectSSE() {
    try {
      var es = new EventSource(API + '/api/events');
      es.onopen = function() { sseAlive = true; lastSSEHeartbeat = Date.now(); };
      es.onmessage = function (e) {
        lastSSEHeartbeat = Date.now();
        sseAlive = true;
        if (e.data === 'connected' || e.data === 'heartbeat') return; // keep-alive, no action
        debouncedQueueFetch();
      };
      es.onerror = function () {
        sseAlive = false;
        es.close();
        var delay = Math.min(3000 * Math.pow(2, Math.floor(Math.random() * 3)), 15000);
        setTimeout(connectSSE, delay);
      };
    } catch (e) {}
  }
  connectSSE();

  // Heartbeat watchdog — detect silent SSE drops
  setInterval(function() {
    if (sseAlive && (Date.now() - lastSSEHeartbeat) > 25000) {
      sseAlive = false;
      connectSSE();
    }
    // Fallback poll only when SSE is down
    if (!sseAlive) fetchQueueCounts();
  }, 15000);

  // ── Start ──────────────────────────────────────────────────────
  init();
})();
