'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/components/providers/locale-provider';
import {
  Download, FileText, BookOpen, Play, ChevronDown,
  MessageCircle, Monitor, Smartphone, QrCode, Users, BarChart3,
  Bell, Globe, Shield, Clock, ArrowRight, Check, Star,
  HelpCircle, Zap, Building2, Stethoscope, Landmark, GraduationCap,
  ShoppingBag, Mail, MapPin, ExternalLink, Sparkles,
} from 'lucide-react';

type L = 'en' | 'fr' | 'ar';
type T3 = Record<L, string>;

function t3(locale: string, obj: T3) {
  return obj[locale as L] || obj.en;
}

/* ═══════════════════════════════════════════════ */
/*  STATIC LABELS                                  */
/* ═══════════════════════════════════════════════ */

const labels = {
  heroBadge: { en: 'Resource Center', fr: 'Centre de Ressources', ar: 'مركز الموارد' },
  heroTitle1: { en: 'Everything you need to', fr: 'Tout ce qu\'il faut pour', ar: 'كل ما تحتاجه' },
  heroTitle2: { en: 'convince and train', fr: 'convaincre et former', ar: 'للإقناع والتدريب' },
  heroSub: { en: 'Interactive guides, print-ready documents, FAQ and demos. Everything to understand, sell and deploy Qflo.', fr: 'Guides interactifs, documents prêts à imprimer, FAQ et démonstrations. Tout pour comprendre, vendre et déployer Qflo.', ar: 'أدلة تفاعلية، وثائق جاهزة للطباعة، أسئلة شائعة وعروض توضيحية. كل شيء لفهم وبيع ونشر Qflo.' },
  guideBtn: { en: 'Interactive guide', fr: 'Guide interactif', ar: 'دليل تفاعلي' },
  downloadBtn: { en: 'Download documents', fr: 'Documents à télécharger', ar: 'تحميل الوثائق' },
  guideBadge: { en: 'Interactive guide', fr: 'Guide interactif', ar: 'دليل تفاعلي' },
  guideTitle: { en: 'The customer journey, step by step', fr: 'Le parcours client, étape par étape', ar: 'رحلة العميل، خطوة بخطوة' },
  guideSub: { en: 'Click each step to see exactly what the customer and operator experience.', fr: 'Cliquez sur chaque étape pour voir exactement ce que vit le client et l\'opérateur.', ar: 'اضغط على كل خطوة لترى بالضبط ما يعيشه العميل والموظف.' },
  prevStep: { en: '\u2190 Previous step', fr: '\u2190 Étape précédente', ar: 'الخطوة السابقة \u2192' },
  nextStep: { en: 'Next step \u2192', fr: 'Étape suivante \u2192', ar: '\u2190 الخطوة التالية' },
  stepLabel: { en: 'Step', fr: 'Étape', ar: 'خطوة' },
  featuresBadge: { en: 'Features', fr: 'Fonctionnalités', ar: 'المميزات' },
  featuresTitle: { en: 'Everything you need', fr: 'Tout ce dont vous avez besoin', ar: 'كل ما تحتاجه' },
  featuresSub: { en: 'A complete solution to digitize your queues.', fr: 'Une solution complète pour digitaliser vos files d\'attente.', ar: 'حل متكامل لرقمنة طوابيرك.' },
  sectorsBadge: { en: 'Sectors', fr: 'Secteurs', ar: 'القطاعات' },
  sectorsTitle: { en: 'For all sectors', fr: 'Pour tous les secteurs', ar: 'لجميع القطاعات' },
  sectorsSub: { en: 'Qflo adapts to any business that manages queues.', fr: 'Qflo s\'adapte à tous les établissements qui gèrent des files d\'attente.', ar: 'Qflo يتكيف مع أي مؤسسة تدير طوابير.' },
  dlBadge: { en: 'Downloads', fr: 'Téléchargements', ar: 'التحميلات' },
  dlTitle: { en: 'Print-ready documents', fr: 'Documents prêts à imprimer', ar: 'وثائق جاهزة للطباعة' },
  dlSub: { en: 'Flyers, brochures and cards in French and Arabic. Download, print, distribute.', fr: 'Flyers, brochures et cartes en français et arabe. Téléchargez, imprimez, distribuez.', ar: 'منشورات، كتيبات وبطاقات بالفرنسية والعربية. حمّل، اطبع، وزّع.' },
  dlPdf: { en: 'Open & Print', fr: 'Ouvrir & Imprimer', ar: 'فتح وطباعة' },
  dlHint: { en: 'Open HTML files in Chrome \u2192 Ctrl+P \u2192 Save as PDF \u2192 Print', fr: 'Ouvrez les fichiers HTML dans Chrome \u2192 Ctrl+P \u2192 Enregistrer en PDF \u2192 Imprimer', ar: 'افتح ملفات HTML في Chrome \u2192 Ctrl+P \u2192 حفظ كـ PDF \u2192 طباعة' },
  faqBadge: { en: 'FAQ', fr: 'FAQ', ar: 'أسئلة شائعة' },
  faqTitle: { en: 'Frequently asked questions', fr: 'Questions fréquentes', ar: 'الأسئلة الشائعة' },
  faqSub: { en: 'Everything your potential clients want to know.', fr: 'Tout ce que vos clients potentiels veulent savoir.', ar: 'كل ما يريد عملاؤك المحتملون معرفته.' },
  ctaTitle: { en: 'Ready to eliminate queues?', fr: 'Prêt à éliminer les files d\'attente ?', ar: 'مستعد للتخلص من الطوابير؟' },
  ctaSub: { en: '14-day free trial. Setup in 15 minutes. No credit card required.', fr: 'Essai gratuit de 14 jours. Installation en 15 minutes. Aucune carte bancaire requise.', ar: 'تجربة مجانية 14 يوم. تثبيت في 15 دقيقة. لا تحتاج بطاقة بنكية.' },
  ctaStart: { en: 'Get started free', fr: 'Commencer gratuitement', ar: 'ابدأ مجاناً' },
  ctaDemo: { en: 'Request a demo', fr: 'Demander une démo', ar: 'اطلب عرضاً توضيحياً' },
  ctaTag1: { en: 'No credit card', fr: 'Sans carte bancaire', ar: 'بدون بطاقة بنكية' },
  ctaTag2: { en: 'WhatsApp included', fr: 'WhatsApp inclus', ar: 'واتساب مشمول' },
  ctaTag3: { en: 'FR/AR support', fr: 'Support FR/AR', ar: 'دعم FR/AR' },
} satisfies Record<string, T3>;

/* ═══════════════════════════════════════════════ */
/*  DATA                                           */
/* ═══════════════════════════════════════════════ */

const downloadables = [
  { title: { en: 'Flyer — French', fr: 'Flyer — Français', ar: 'نشرة إعلانية — فرنسية' }, desc: { en: 'A4 front/back, print-ready', fr: 'Recto-verso A4, prêt à imprimer', ar: 'A4 وجهين، جاهز للطباعة' }, file: '/resources/flyer-fr.html', icon: FileText, color: 'bg-blue-50 text-blue-600', tag: 'A4' },
  { title: { en: 'Flyer — Arabic', fr: 'نشرة إعلانية — عربية', ar: 'نشرة إعلانية — عربية' }, desc: { en: 'A4 front/back, RTL', fr: 'A4 recto-verso, RTL', ar: 'A4 وجهين، من اليمين لليسار' }, file: '/resources/flyer-ar.html', icon: FileText, color: 'bg-emerald-50 text-emerald-600', tag: 'A4' },
  { title: { en: 'Brochure — French', fr: 'Brochure — Français', ar: 'كتيب — فرنسية' }, desc: { en: 'Tri-fold A4 landscape, 6 panels', fr: 'Tri-fold A4 paysage, 6 panneaux', ar: 'ثلاثي الطي A4، 6 ألواح' }, file: '/resources/brochure-fr.html', icon: BookOpen, color: 'bg-purple-50 text-purple-600', tag: 'Tri-fold' },
  { title: { en: 'Brochure — Arabic', fr: 'كتيب — عربية', ar: 'كتيب — عربية' }, desc: { en: 'Tri-fold A4 landscape, RTL', fr: 'Tri-fold A4 paysage, RTL', ar: 'ثلاثي الطي A4، من اليمين لليسار' }, file: '/resources/brochure-ar.html', icon: BookOpen, color: 'bg-amber-50 text-amber-600', tag: 'Tri-fold' },
  { title: { en: 'Quick Card — French', fr: 'Carte rapide — Français', ar: 'بطاقة سريعة — فرنسية' }, desc: { en: 'A5 landscape, hand out on-site', fr: 'A5 paysage, à distribuer sur place', ar: 'A5 أفقي، للتوزيع في المكان' }, file: '/resources/quickcard-fr.html', icon: Zap, color: 'bg-rose-50 text-rose-600', tag: 'A5' },
  { title: { en: 'Quick Card — Arabic', fr: 'بطاقة سريعة — عربية', ar: 'بطاقة سريعة — عربية' }, desc: { en: 'A5 landscape, RTL', fr: 'A5 paysage, RTL', ar: 'A5 أفقي، من اليمين لليسار' }, file: '/resources/quickcard-ar.html', icon: Zap, color: 'bg-cyan-50 text-cyan-600', tag: 'A5' },
  { title: { en: 'Brand Guidelines', fr: 'Brand Guidelines', ar: 'دليل الهوية البصرية' }, desc: { en: 'Logo, colors, typography, tone', fr: 'Logo, couleurs, typographie, ton', ar: 'الشعار، الألوان، الخطوط، النبرة' }, file: '/resources/brand-guidelines.html', icon: Sparkles, color: 'bg-indigo-50 text-indigo-600', tag: '2 pages' },
];

const journeySteps = [
  {
    emoji: '📱',
    title: { en: 'Customer joins the queue', fr: 'Le client rejoint la file', ar: 'العميل ينضم للطابور' },
    desc: { en: 'Via WhatsApp, Messenger, QR code, web link or on-site kiosk.', fr: 'Via WhatsApp, Messenger, QR code, lien web ou borne kiosque sur place.', ar: 'عبر واتساب، ماسنجر، رمز QR، رابط ويب أو كشك الخدمة الذاتية.' },
    details: {
      en: ['Send REJOINDRE + code (e.g. REJOINDRE ELAZHAR)', 'Scan the displayed QR code', 'Click the link on the welcome page', 'Use the on-site touch kiosk'],
      fr: ['Envoyez REJOINDRE + code (ex: REJOINDRE ELAZHAR)', 'Scannez le QR code affiché', 'Cliquez sur le lien de la page d\'accueil', 'Utilisez la borne tactile sur place'],
      ar: ['أرسل ELAZHAR انضم', 'امسح رمز QR المعروض', 'اضغط على الرابط في صفحة الاستقبال', 'استخدم كشك الخدمة الذاتية في المكان'],
    },
    visual: 'join',
  },
  {
    emoji: '🎫',
    title: { en: 'Instant ticket', fr: 'Ticket instantané', ar: 'تذكرة فورية' },
    desc: { en: 'A ticket number is assigned automatically with the queue position.', fr: 'Un numéro de ticket est attribué automatiquement avec la position dans la file.', ar: 'يتم منح رقم تذكرة تلقائياً مع الموقع في الطابور.' },
    details: {
      en: ['Unique number (e.g. A-12)', 'Queue position shown in real-time', 'Web link for live tracking', 'Works on any smartphone'],
      fr: ['Numéro unique (ex: A-12)', 'Position en file affichée en temps réel', 'Lien web pour suivre en direct', 'Fonctionne sur tout smartphone'],
      ar: ['رقم فريد (مثال: A-12)', 'موقع في الطابور معروض مباشرة', 'رابط ويب للمتابعة المباشرة', 'يعمل على أي هاتف ذكي'],
    },
    visual: 'ticket',
  },
  {
    emoji: '📍',
    title: { en: 'Live tracking', fr: 'Suivi en direct', ar: 'تتبع مباشر' },
    desc: { en: 'The customer tracks their position in the queue in real-time from their phone.', fr: 'Le client suit sa position dans la file en temps réel depuis son téléphone.', ar: 'العميل يتابع موقعه في الطابور مباشرة من هاتفه.' },
    details: {
      en: ['Position updated automatically', 'Via WhatsApp / Messenger / web link', 'Estimated wait time', 'Customer can leave and come back on time'],
      fr: ['Position mise à jour automatiquement', 'Via WhatsApp / Messenger / lien web', 'Temps d\'attente estimé', 'Le client peut partir et revenir à temps'],
      ar: ['الموقع يتحدث تلقائياً', 'عبر واتساب / ماسنجر / رابط ويب', 'وقت الانتظار التقديري', 'يمكن للعميل المغادرة والعودة في الوقت المناسب'],
    },
    visual: 'track',
  },
  {
    emoji: '📢',
    title: { en: 'Customer called', fr: 'Appel du client', ar: 'استدعاء العميل' },
    desc: { en: 'The operator calls the next customer with one click. The customer is notified everywhere.', fr: 'L\'opérateur appelle le prochain en un clic. Le client est notifié partout.', ar: 'الموظف يستدعي التالي بنقرة واحدة. يتم إشعار العميل في كل مكان.' },
    details: {
      en: ['Instant WhatsApp / Messenger notification', 'Announcement on TV display screen', 'Sound alert in the waiting room', 'Desk number clearly indicated'],
      fr: ['Notification WhatsApp / Messenger instantanée', 'Annonce sur l\'écran d\'affichage TV', 'Alerte sonore dans la salle d\'attente', 'Numéro de guichet indiqué clairement'],
      ar: ['إشعار واتساب / ماسنجر فوري', 'عرض على شاشة التلفزيون', 'تنبيه صوتي في قاعة الانتظار', 'رقم الشباك محدد بوضوح'],
    },
    visual: 'call',
  },
  {
    emoji: '✅',
    title: { en: 'Service completed', fr: 'Service terminé', ar: 'تمت الخدمة' },
    desc: { en: 'The operator marks the customer as served. Statistics are updated.', fr: 'L\'opérateur marque le client comme servi. Les statistiques sont mises à jour.', ar: 'الموظف يحدد العميل كـ "تمت خدمته". يتم تحديث الإحصائيات.' },
    details: {
      en: ['Service duration recorded', 'Performance stats updated', 'Next customer called automatically', 'Full history preserved'],
      fr: ['Durée de service enregistrée', 'Statistiques de performance mises à jour', 'Le prochain client est appelé automatiquement', 'Historique complet conservé'],
      ar: ['مدة الخدمة مسجلة', 'إحصائيات الأداء محدثة', 'العميل التالي يُستدعى تلقائياً', 'السجل الكامل محفوظ'],
    },
    visual: 'done',
  },
];

const features: { icon: typeof MessageCircle; title: T3; desc: T3; color: string; bg: string }[] = [
  { icon: MessageCircle, title: { en: 'WhatsApp & Messenger', fr: 'WhatsApp & Messenger', ar: 'واتساب و ماسنجر' }, desc: { en: 'Customers join the queue without downloading any app. WhatsApp and Facebook Messenger natively supported.', fr: 'Les clients rejoignent la file sans télécharger d\'application. WhatsApp et Facebook Messenger sont supportés nativement.', ar: 'العملاء ينضمون للطابور بدون تحميل أي تطبيق. واتساب وماسنجر مدعومان أصلاً.' }, color: 'text-green-500', bg: 'bg-green-50' },
  { icon: Monitor, title: { en: 'TV Display Screen', fr: 'Écran d\'affichage TV', ar: 'شاشة عرض تلفزيون' }, desc: { en: 'Connect any screen to show calls in real-time. Light/dark themes, customizable.', fr: 'Connectez n\'importe quel écran pour afficher les appels en temps réel. Thèmes clair/sombre, personnalisable.', ar: 'وصّل أي شاشة لعرض الاستدعاءات مباشرة. سمات فاتحة/داكنة، قابلة للتخصيص.' }, color: 'text-blue-500', bg: 'bg-blue-50' },
  { icon: Smartphone, title: { en: 'Operator App', fr: 'Application opérateur', ar: 'تطبيق الموظف' }, desc: { en: 'Desktop and mobile. Call next, transfer, mark absent — all in one click.', fr: 'Desktop et mobile. Appelez le suivant, transférez, marquez absent — tout en un clic.', ar: 'سطح المكتب والهاتف. استدعِ التالي، حوّل، سجّل غياب — كل شيء بنقرة.' }, color: 'text-purple-500', bg: 'bg-purple-50' },
  { icon: QrCode, title: { en: 'Self-Service Kiosk', fr: 'Borne Kiosque', ar: 'كشك خدمة ذاتية' }, desc: { en: 'On-site touch kiosk for customers without smartphones. Thermal ticket printing available.', fr: 'Borne tactile sur place pour les clients sans smartphone. Impression thermique de ticket disponible.', ar: 'كشك لمس في المكان للعملاء بدون هاتف ذكي. طباعة حرارية للتذاكر متوفرة.' }, color: 'text-amber-500', bg: 'bg-amber-50' },
  { icon: MapPin, title: { en: 'Live Tracking', fr: 'Suivi en direct', ar: 'تتبع مباشر' }, desc: { en: 'Customers track their position via WhatsApp, Messenger or a web link. Real-time estimated wait.', fr: 'Le client suit sa position via WhatsApp, Messenger ou un lien web. Temps d\'attente estimé en temps réel.', ar: 'العميل يتابع موقعه عبر واتساب، ماسنجر أو رابط ويب. وقت انتظار تقديري مباشر.' }, color: 'text-red-500', bg: 'bg-red-50' },
  { icon: Bell, title: { en: 'Instant Notifications', fr: 'Notifications instantanées', ar: 'إشعارات فورية' }, desc: { en: 'The customer is notified automatically when it\'s their turn, via WhatsApp, Messenger and the display.', fr: 'Le client est notifié automatiquement quand c\'est son tour, via WhatsApp, Messenger et l\'écran d\'affichage.', ar: 'يتم إشعار العميل تلقائياً عندما يحين دوره، عبر واتساب، ماسنجر وشاشة العرض.' }, color: 'text-rose-500', bg: 'bg-rose-50' },
  { icon: Globe, title: { en: 'Multilingual FR/AR/EN', fr: 'Multilingue FR/AR/EN', ar: 'متعدد اللغات FR/AR/EN' }, desc: { en: 'Interface in French, Arabic and English. Automatic language detection. Full RTL for Arabic.', fr: 'Interface en français, arabe et anglais. Détection automatique de la langue du client. RTL complet pour l\'arabe.', ar: 'واجهة بالفرنسية، العربية والإنجليزية. كشف تلقائي للغة. RTL كامل للعربية.' }, color: 'text-cyan-500', bg: 'bg-cyan-50' },
  { icon: Users, title: { en: 'Multi-Department', fr: 'Multi-départements', ar: 'متعدد الأقسام' }, desc: { en: 'Manage multiple services and desks in the same location. Separate queues per department.', fr: 'Gérez plusieurs services et guichets dans le même établissement. Files séparées par département.', ar: 'إدارة عدة خدمات وشبابيك في نفس المكان. طوابير منفصلة لكل قسم.' }, color: 'text-indigo-500', bg: 'bg-indigo-50' },
  { icon: BarChart3, title: { en: 'Analytics Dashboard', fr: 'Tableau de bord analytique', ar: 'لوحة تحكم تحليلية' }, desc: { en: 'Average wait time, volume per hour, desk performance. CSV and PDF export.', fr: 'Temps d\'attente moyen, volume par heure, performance des guichets. Export CSV et PDF.', ar: 'متوسط وقت الانتظار، الحجم بالساعة، أداء الشبابيك. تصدير CSV و PDF.' }, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  { icon: Shield, title: { en: 'Secure & Reliable', fr: 'Sécurisé & Fiable', ar: 'آمن وموثوق' }, desc: { en: 'Encrypted data, secure cloud hosting. Built-in offline mode to continue without internet.', fr: 'Données chiffrées, hébergement cloud sécurisé. Mode hors-ligne intégré pour continuer sans internet.', ar: 'بيانات مشفرة، استضافة سحابية آمنة. وضع بدون إنترنت مدمج للاستمرار.' }, color: 'text-slate-500', bg: 'bg-slate-50' },
  { icon: Clock, title: { en: 'Setup in 15 minutes', fr: 'Installation en 15 minutes', ar: 'تثبيت في 15 دقيقة' }, desc: { en: 'Create your account, configure services, share the QR code. Operational in 15 minutes.', fr: 'Créez votre compte, configurez vos services, partagez le QR code. Opérationnel en un quart d\'heure.', ar: 'أنشئ حسابك، اضبط خدماتك، شارك رمز QR. جاهز للعمل في 15 دقيقة.' }, color: 'text-orange-500', bg: 'bg-orange-50' },
  { icon: Zap, title: { en: 'Zero app for customers', fr: 'Zéro app pour le client', ar: 'لا تطبيق للعميل' }, desc: { en: 'Your customers use WhatsApp or Messenger — already on their phones. Nothing to download.', fr: 'Vos clients utilisent WhatsApp ou Messenger — déjà installés sur leur téléphone. Rien à télécharger.', ar: 'عملاؤك يستخدمون واتساب أو ماسنجر — مثبتين مسبقاً. لا حاجة للتحميل.' }, color: 'text-yellow-500', bg: 'bg-yellow-50' },
];

const sectors = [
  { icon: Stethoscope, name: { en: 'Clinics & Hospitals', fr: 'Cliniques & Hôpitaux', ar: 'العيادات والمستشفيات' }, color: 'text-red-500', bg: 'bg-red-50' },
  { icon: Landmark, name: { en: 'Banks & Insurance', fr: 'Banques & Assurances', ar: 'البنوك والتأمينات' }, color: 'text-blue-500', bg: 'bg-blue-50' },
  { icon: Building2, name: { en: 'Government Offices', fr: 'Administrations publiques', ar: 'الإدارات العمومية' }, color: 'text-slate-500', bg: 'bg-slate-50' },
  { icon: Mail, name: { en: 'Post Offices', fr: 'Bureaux de poste', ar: 'مكاتب البريد' }, color: 'text-amber-500', bg: 'bg-amber-50' },
  { icon: ShoppingBag, name: { en: 'Retail & Services', fr: 'Commerces & Services', ar: 'المحلات التجارية' }, color: 'text-purple-500', bg: 'bg-purple-50' },
  { icon: GraduationCap, name: { en: 'Universities', fr: 'Universités', ar: 'الجامعات' }, color: 'text-emerald-500', bg: 'bg-emerald-50' },
];

const faqs: { q: T3; a: T3 }[] = [
  { q: { en: 'Do customers need to download an app?', fr: 'Est-ce que les clients doivent télécharger une application ?', ar: 'هل يحتاج العملاء لتحميل تطبيق؟' }, a: { en: 'No. Customers use WhatsApp, Messenger or scan a QR code from their browser. No app to download.', fr: 'Non. Les clients utilisent WhatsApp, Messenger ou scannent un QR code depuis leur navigateur. Aucune application à télécharger.', ar: 'لا. العملاء يستخدمون واتساب، ماسنجر أو يمسحون رمز QR من المتصفح. لا تطبيق للتحميل.' } },
  { q: { en: 'How does the customer join the queue?', fr: 'Comment le client rejoint la file ?', ar: 'كيف ينضم العميل للطابور؟' }, a: { en: 'The customer sends a WhatsApp/Messenger message with the command (e.g. REJOINDRE ELAZHAR), scans a QR code, clicks a web link, or uses the on-site kiosk.', fr: 'Le client envoie un message WhatsApp/Messenger avec la commande (ex: REJOINDRE ELAZHAR), scanne un QR code, clique sur un lien web, ou utilise la borne kiosque sur place.', ar: 'العميل يرسل رسالة واتساب/ماسنجر بالأمر (مثال: انضم ELAZHAR)، يمسح رمز QR، يضغط على رابط ويب، أو يستخدم كشك الخدمة الذاتية.' } },
  { q: { en: 'Can the customer track their position live?', fr: 'Le client peut suivre sa position en direct ?', ar: 'هل يمكن للعميل متابعة موقعه مباشرة؟' }, a: { en: 'Yes. The customer receives a web link with their real-time position. They can also ask via WhatsApp or Messenger at any time.', fr: 'Oui. Le client reçoit un lien web avec sa position en temps réel. Il peut aussi demander sa position via WhatsApp ou Messenger à tout moment.', ar: 'نعم. العميل يتلقى رابط ويب بموقعه المباشر. يمكنه أيضاً السؤال عبر واتساب أو ماسنجر في أي وقت.' } },
  { q: { en: 'How is the customer notified when it\'s their turn?', fr: 'Comment le client est notifié quand c\'est son tour ?', ar: 'كيف يتم إشعار العميل عندما يحين دوره؟' }, a: { en: 'The customer receives an instant notification via WhatsApp or Messenger, with the desk number. The call is also shown on the TV display.', fr: 'Le client reçoit une notification instantanée via WhatsApp ou Messenger, avec le numéro de guichet. L\'appel est aussi affiché sur l\'écran TV.', ar: 'العميل يتلقى إشعاراً فورياً عبر واتساب أو ماسنجر، مع رقم الشباك. يظهر الاستدعاء أيضاً على شاشة التلفزيون.' } },
  { q: { en: 'How long does it take to set up?', fr: 'Combien de temps faut-il pour installer ?', ar: 'كم يستغرق التثبيت؟' }, a: { en: '15 minutes. Create your account, configure departments and services, print the QR code. Our team helps if needed.', fr: '15 minutes. Créez votre compte, configurez vos départements et services, imprimez le QR code. Notre équipe vous accompagne si besoin.', ar: '15 دقيقة. أنشئ حسابك، اضبط الأقسام والخدمات، اطبع رمز QR. فريقنا يرافقك عند الحاجة.' } },
  { q: { en: 'Does it work without internet?', fr: 'Ça marche sans internet ?', ar: 'هل يعمل بدون إنترنت؟' }, a: { en: 'Yes. The operator app works offline. Queues are managed locally and sync when the connection returns.', fr: 'Oui. L\'application opérateur fonctionne en mode hors-ligne. Les files sont gérées localement et se synchronisent quand la connexion revient.', ar: 'نعم. تطبيق الموظف يعمل بدون إنترنت. الطوابير تُدار محلياً وتُزامن عند عودة الاتصال.' } },
  { q: { en: 'How much does it cost?', fr: 'Combien ça coûte ?', ar: 'كم التكلفة؟' }, a: { en: '14-day free trial. Then pricing depends on volume and features. Contact us for a custom quote.', fr: 'Essai gratuit de 14 jours. Ensuite, les tarifs dépendent du volume et des fonctionnalités. Contactez-nous pour un devis adapté.', ar: 'تجربة مجانية 14 يوم. ثم الأسعار حسب الحجم والمميزات. تواصل معنا للحصول على عرض سعر مخصص.' } },
  { q: { en: 'What languages are supported?', fr: 'Les langues supportées ?', ar: 'ما اللغات المدعومة؟' }, a: { en: 'French, Arabic and English. The client\'s language is detected automatically. The full interface is available in RTL for Arabic.', fr: 'Français, arabe et anglais. La langue du client est détectée automatiquement. L\'interface complète est disponible en RTL pour l\'arabe.', ar: 'الفرنسية، العربية والإنجليزية. يتم كشف لغة العميل تلقائياً. الواجهة كاملة متوفرة بـ RTL للعربية.' } },
  { q: { en: 'Can we manage multiple departments?', fr: 'Peut-on gérer plusieurs départements ?', ar: 'هل يمكن إدارة عدة أقسام؟' }, a: { en: 'Yes. You can create as many departments as needed (e.g. Teller, Claims, VIP), each with its own queue.', fr: 'Oui. Vous pouvez créer autant de départements que nécessaire (ex: Caisse, Réclamations, VIP), chacun avec sa propre file.', ar: 'نعم. يمكنك إنشاء أقسام بلا حدود (مثال: الصندوق، الشكاوى، VIP)، كل قسم بطابوره الخاص.' } },
  { q: { en: 'How do operators manage the queue?', fr: 'Comment les opérateurs gèrent la file ?', ar: 'كيف يدير الموظفون الطابور؟' }, a: { en: 'From the desktop or mobile app. One button to call next, one to mark as served. Transfer between departments in one click.', fr: 'Depuis l\'application desktop ou mobile. Un bouton pour appeler le suivant, un pour marquer comme servi. Transfert entre départements en un clic.', ar: 'من تطبيق سطح المكتب أو الهاتف. زر لاستدعاء التالي، وزر لتحديده كـ "تمت خدمته". التحويل بين الأقسام بنقرة واحدة.' } },
];

/* ═══════════════════════════════════════════════ */
/*  COMPONENTS                                     */
/* ═══════════════════════════════════════════════ */

function PhoneMockup({ type, locale }: { type: string; locale: string }) {
  const l = locale as L;
  const msgs = {
    join: { cmd: { en: 'REJOINDRE ELAZHAR', fr: 'REJOINDRE ELAZHAR', ar: 'ELAZHAR انضم' }, welcome: { en: 'Welcome!', fr: 'Bienvenue !', ar: '!أهلاً' }, ticket: { en: 'Your ticket:', fr: 'Votre ticket :', ar: 'تذكرتك:' }, pos: { en: 'Position: 3rd', fr: 'Position : 3e', ar: 'الموقع: الثالث' } },
    track: { update: { en: 'Update', fr: 'Mise à jour', ar: 'تحديث' }, pos2: { en: 'You are now 2nd in line', fr: 'Vous êtes maintenant 2e en file', ar: 'أنت الآن الثاني في الطابور' }, wait: { en: '~5 min wait', fr: '~5 min d\'attente', ar: '~5 دقائق انتظار' }, almost: { en: 'Almost your turn!', fr: 'Presque votre tour !', ar: 'اقترب دورك!' }, next: { en: 'You are next', fr: 'Vous êtes le prochain', ar: 'أنت التالي' } },
    call: { turn: { en: 'IT\'S YOUR TURN!', fr: 'C\'EST VOTRE TOUR !', ar: 'حان دورك!' }, desk: { en: 'Desk 2', fr: 'Guichet 2', ar: 'الشباك 2' }, proceed: { en: 'Please proceed', fr: 'Veuillez vous présenter', ar: 'يرجى التقدم' } },
    ticket_screen: { label: { en: 'YOUR TICKET', fr: 'VOTRE TICKET', ar: 'تذكرتك' }, position: { en: 'Position', fr: 'Position', ar: 'الموقع' }, wait: { en: 'Wait', fr: 'Attente', ar: 'الانتظار' } },
    done: { title: { en: 'Service completed', fr: 'Service terminé', ar: 'تمت الخدمة' }, served: { en: 'Ticket A-12 served', fr: 'Ticket A-12 servi', ar: 'التذكرة A-12 تمت خدمتها' }, duration: { en: 'Duration: 4 min', fr: 'Durée : 4 min', ar: 'المدة: 4 دقائق' }, thanks: { en: 'Thank you for your visit', fr: 'Merci pour votre visite', ar: 'شكراً لزيارتك' } },
  };

  const screens: Record<string, React.ReactNode> = {
    join: (
      <div className="space-y-2">
        <div className="rounded-lg bg-white p-2 text-[10px] shadow-sm">{msgs.join.cmd[l] || msgs.join.cmd.en}</div>
        <div className="rounded-lg bg-green-50 p-2 text-[10px] text-green-800 shadow-sm">
          <div className="font-bold">{msgs.join.welcome[l] || msgs.join.welcome.en}</div>
          <div>{msgs.join.ticket[l] || msgs.join.ticket.en} <span className="font-bold">A-12</span></div>
          <div>{msgs.join.pos[l] || msgs.join.pos.en}</div>
        </div>
      </div>
    ),
    ticket: (
      <div className="rounded-xl bg-white p-3 text-center shadow-sm">
        <div className="text-[9px] text-gray-400 font-semibold">{msgs.ticket_screen.label[l] || msgs.ticket_screen.label.en}</div>
        <div className="text-2xl font-black text-blue-600 mt-1">A-12</div>
        <div className="mt-2 flex justify-between text-[9px]"><span className="text-gray-500">{msgs.ticket_screen.position[l]}</span><span className="font-bold">3</span></div>
        <div className="flex justify-between text-[9px]"><span className="text-gray-500">{msgs.ticket_screen.wait[l]}</span><span className="font-bold">~8 min</span></div>
        <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full w-2/3 rounded-full bg-blue-500" /></div>
      </div>
    ),
    track: (
      <div className="space-y-2">
        <div className="rounded-lg bg-blue-50 p-2 text-[10px] text-blue-800 shadow-sm">
          <div className="font-bold">{msgs.track.update[l]}</div>
          <div>{msgs.track.pos2[l]}</div>
          <div className="text-[9px] text-blue-500 mt-1">{msgs.track.wait[l]}</div>
        </div>
        <div className="rounded-lg bg-blue-50 p-2 text-[10px] text-blue-800 shadow-sm">
          <div className="font-bold">{msgs.track.almost[l]}</div>
          <div>{msgs.track.next[l]}</div>
        </div>
      </div>
    ),
    call: (
      <div className="space-y-2">
        <div className="rounded-lg bg-green-100 p-3 text-center shadow-sm animate-pulse">
          <div className="text-lg">📢</div>
          <div className="text-[11px] font-black text-green-800">{msgs.call.turn[l]}</div>
          <div className="text-[10px] text-green-700 font-semibold mt-1">{msgs.call.desk[l]}</div>
          <div className="text-[9px] text-green-600 mt-0.5">{msgs.call.proceed[l]}</div>
        </div>
      </div>
    ),
    done: (
      <div className="rounded-xl bg-white p-3 text-center shadow-sm">
        <div className="text-2xl mb-1">✅</div>
        <div className="text-[11px] font-bold text-gray-800">{msgs.done.title[l]}</div>
        <div className="text-[9px] text-gray-500 mt-1">{msgs.done.served[l]}</div>
        <div className="text-[9px] text-gray-400">{msgs.done.duration[l]}</div>
        <div className="mt-2 flex gap-1 justify-center">
          {[1,2,3,4,5].map(s => (<Star key={s} className={`h-3 w-3 ${s <= 4 ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`} />))}
        </div>
        <div className="text-[8px] text-gray-400 mt-1">{msgs.done.thanks[l]}</div>
      </div>
    ),
  };

  return (
    <div className="mx-auto w-[140px] shrink-0">
      <div className="rounded-[20px] border-2 border-gray-200 bg-gray-50 p-2.5 shadow-lg">
        <div className="mb-2 flex items-center gap-1.5 px-1">
          <div className="h-1.5 w-1.5 rounded-full bg-green-400" />
          <span className="text-[8px] font-bold text-gray-400">WhatsApp</span>
        </div>
        {screens[type]}
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-4 py-5 text-left transition-colors hover:text-primary">
        <span className="text-sm font-semibold md:text-base">{q}</span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ${open ? 'max-h-40 pb-5' : 'max-h-0'}`}>
        <p className="text-sm leading-relaxed text-muted-foreground">{a}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════ */
/*  PAGE                                           */
/* ═══════════════════════════════════════════════ */

export default function ResourcesPage() {
  const [activeStep, setActiveStep] = useState(0);
  const { locale } = useI18n();
  const l = (locale || 'en') as L;
  const _ = (obj: T3) => t3(l, obj);

  return (
    <>
      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-blue-600 to-blue-800 py-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.08),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.05),transparent_40%)]" />
        <div className="relative mx-auto max-w-7xl px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/80 backdrop-blur-sm mb-6">
            <BookOpen className="h-3.5 w-3.5" />
            {_(labels.heroBadge)}
          </div>
          <h1 className="text-4xl font-black tracking-tight text-white md:text-6xl">
            {_(labels.heroTitle1)}<br />
            <span className="text-emerald-300">{_(labels.heroTitle2)}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-white/70">{_(labels.heroSub)}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a href="#guide" className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-bold text-primary shadow-lg transition-all hover:shadow-xl hover:scale-[1.02]">
              <Play className="h-4 w-4" />{_(labels.guideBtn)}
            </a>
            <a href="#downloads" className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20">
              <Download className="h-4 w-4" />{_(labels.downloadBtn)}
            </a>
          </div>
        </div>
      </section>

      {/* ─── INTERACTIVE JOURNEY GUIDE ─── */}
      <section id="guide" className="scroll-mt-20 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary mb-4"><Play className="h-3.5 w-3.5" />{_(labels.guideBadge)}</div>
            <h2 className="text-3xl font-black md:text-4xl">{_(labels.guideTitle)}</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">{_(labels.guideSub)}</p>
          </div>

          <div className="flex flex-wrap justify-center gap-2 mb-12">
            {journeySteps.map((s, i) => (
              <button key={i} onClick={() => setActiveStep(i)} className={`group flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-200 ${activeStep === i ? 'bg-primary text-white shadow-lg shadow-primary/25 scale-105' : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <span className="text-lg">{s.emoji}</span>
                <span className="hidden sm:inline">{_(s.title)}</span>
                <span className="sm:hidden">{_(labels.stepLabel)} {i + 1}</span>
              </button>
            ))}
          </div>

          <div className="mx-auto max-w-5xl">
            {journeySteps.map((s, i) => (
              <div key={i} className={`transition-all duration-500 ${activeStep === i ? 'block' : 'hidden'}`}>
                <div className="rounded-3xl border border-border bg-card p-8 shadow-xl md:p-12">
                  <div className="flex flex-col md:flex-row gap-10 items-center">
                    <PhoneMockup type={s.visual} locale={l} />
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white font-black text-lg">{i + 1}</div>
                        <h3 className="text-2xl font-black">{_(s.title)}</h3>
                      </div>
                      <p className="text-muted-foreground leading-relaxed mb-6">{_(s.desc)}</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {(s.details[l] || s.details.en).map((d, j) => (
                          <div key={j} className="flex items-start gap-2.5 rounded-xl bg-muted/40 px-4 py-3">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                            <span className="text-sm">{d}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
                        <button onClick={() => setActiveStep(Math.max(0, i - 1))} className={`text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors ${i === 0 ? 'invisible' : ''}`}>{_(labels.prevStep)}</button>
                        <div className="flex gap-1.5">{journeySteps.map((_, j) => (<button key={j} onClick={() => setActiveStep(j)} className={`h-2 rounded-full transition-all ${activeStep === j ? 'w-6 bg-primary' : 'w-2 bg-muted-foreground/20 hover:bg-muted-foreground/40'}`} />))}</div>
                        <button onClick={() => setActiveStep(Math.min(journeySteps.length - 1, i + 1))} className={`text-sm font-semibold text-primary hover:text-primary/80 transition-colors ${i === journeySteps.length - 1 ? 'invisible' : ''}`}>{_(labels.nextStep)}</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FEATURES GRID ─── */}
      <section className="bg-muted/20 py-24 border-y border-border">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary mb-4"><Sparkles className="h-3.5 w-3.5" />{_(labels.featuresBadge)}</div>
            <h2 className="text-3xl font-black md:text-4xl">{_(labels.featuresTitle)}</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">{_(labels.featuresSub)}</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={_(f.title)} className="group rounded-2xl border border-border bg-card p-6 transition-all duration-200 hover:shadow-lg hover:border-primary/20 hover:-translate-y-0.5">
                <div className={`inline-flex rounded-xl ${f.bg} p-3 mb-4`}><f.icon className={`h-5 w-5 ${f.color}`} /></div>
                <h3 className="text-base font-bold mb-2">{_(f.title)}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{_(f.desc)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── SECTORS ─── */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary mb-4"><Building2 className="h-3.5 w-3.5" />{_(labels.sectorsBadge)}</div>
            <h2 className="text-3xl font-black md:text-4xl">{_(labels.sectorsTitle)}</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">{_(labels.sectorsSub)}</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl mx-auto">
            {sectors.map((s) => (
              <div key={_(s.name)} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 transition-all hover:shadow-md hover:border-primary/20">
                <div className={`rounded-xl ${s.bg} p-3`}><s.icon className={`h-6 w-6 ${s.color}`} /></div>
                <div className="font-bold text-sm">{_(s.name)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── DOWNLOADS ─── */}
      <section id="downloads" className="scroll-mt-20 bg-muted/20 py-24 border-y border-border">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary mb-4"><Download className="h-3.5 w-3.5" />{_(labels.dlBadge)}</div>
            <h2 className="text-3xl font-black md:text-4xl">{_(labels.dlTitle)}</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">{_(labels.dlSub)}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 max-w-6xl mx-auto">
            {downloadables.map((d) => (
              <a key={_(d.title)} href={d.file} target="_blank" rel="noopener noreferrer" className="group relative flex flex-col rounded-2xl border border-border bg-card p-5 transition-all duration-200 hover:shadow-lg hover:border-primary/20 hover:-translate-y-0.5">
                <div className="flex items-start justify-between mb-3">
                  <div className={`rounded-xl ${d.color} p-2.5`}><d.icon className="h-5 w-5" /></div>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-bold text-muted-foreground">{d.tag}</span>
                </div>
                <h3 className="text-sm font-bold mb-1">{_(d.title)}</h3>
                <p className="text-xs text-muted-foreground mb-4">{_(d.desc)}</p>
                <div className="mt-auto flex items-center gap-1.5 text-xs font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  <Download className="h-3.5 w-3.5" />{_(labels.dlPdf)}
                </div>
              </a>
            ))}
          </div>
          <div className="mt-8 text-center"><p className="text-xs text-muted-foreground">{_(labels.dlHint)}</p></div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className="py-24">
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary mb-4"><HelpCircle className="h-3.5 w-3.5" />{_(labels.faqBadge)}</div>
            <h2 className="text-3xl font-black md:text-4xl">{_(labels.faqTitle)}</h2>
            <p className="mt-3 text-muted-foreground">{_(labels.faqSub)}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 md:p-8 shadow-sm">
            {faqs.map((faq, i) => (<FaqItem key={i} q={_(faq.q)} a={_(faq.a)} />))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-blue-600 to-blue-800 py-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_60%,rgba(255,255,255,0.06),transparent_50%)]" />
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-black text-white md:text-4xl">{_(labels.ctaTitle)}</h2>
          <p className="mt-4 text-lg text-white/70">{_(labels.ctaSub)}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/register" className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-bold text-primary shadow-lg transition-all hover:shadow-xl hover:scale-[1.02]">
              {_(labels.ctaStart)}<ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/contact" className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-8 py-4 text-base font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20">
              {_(labels.ctaDemo)}<ExternalLink className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-white/60">
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> {_(labels.ctaTag1)}</span>
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> {_(labels.ctaTag2)}</span>
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> {_(labels.ctaTag3)}</span>
          </div>
        </div>
      </section>
    </>
  );
}
