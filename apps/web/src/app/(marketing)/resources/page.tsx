'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useI18n } from '@/components/providers/locale-provider';
import {
  Download, FileText, BookOpen, Play, ChevronDown,
  MessageCircle, Monitor, Smartphone, QrCode, Users, BarChart3,
  Bell, Globe, Shield, Clock, ArrowRight, Check, Star,
  HelpCircle, Zap, Building2, Stethoscope, Landmark, GraduationCap,
  ShoppingBag, Mail, MapPin, ExternalLink, Sparkles,
  CalendarCheck, WifiOff, Phone, Send, AlertTriangle,
  XCircle, CheckCircle2, Timer, TrendingUp,
} from 'lucide-react';

type L = 'en' | 'fr' | 'ar';
type T3 = Record<L, string>;

function t3(locale: string, obj: T3) {
  return obj[locale as L] || obj.en;
}

/* ═══════════════════════════════════════════════ */
/*  ANIMATED COUNTER                               */
/* ═══════════════════════════════════════════════ */

function AnimatedCounter({ target, suffix = '', prefix = '' }: { target: number; suffix?: string; prefix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const duration = 2000;
          const steps = 60;
          const increment = target / steps;
          let current = 0;
          const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
              setCount(target);
              clearInterval(timer);
            } else {
              setCount(Math.floor(current));
            }
          }, duration / steps);
        }
      },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target]);

  return (
    <div ref={ref} className="text-4xl font-black md:text-5xl">
      {prefix}{count}{suffix}
    </div>
  );
}

/* ═══════════════════════════════════════════════ */
/*  STATIC LABELS                                  */
/* ═══════════════════════════════════════════════ */

const labels = {
  heroBadge: { en: 'Queue Management for Algeria', fr: 'Gestion de file d\'attente pour l\'Algerie', ar: 'ادارة الطوابير للجزائر' },
  heroTitle1: { en: 'Your customers wait for hours.', fr: 'Vos clients font la queue pendant des heures.', ar: 'عملاؤك ينتظرون لساعات.' },
  heroTitle2: { en: 'WhatsApp changes everything.', fr: 'WhatsApp change tout.', ar: 'واتساب يغير كل شيء.' },
  heroSub: { en: '90% of Algerians use WhatsApp. With Qflo, your customers join the queue right now OR book a future appointment — all via WhatsApp. No app to download.', fr: '90% des Algeriens utilisent WhatsApp. Avec Qflo, vos clients rejoignent la file immediatement OU reservent un rendez-vous futur — tout via WhatsApp. Aucune app a telecharger.', ar: '90% من الجزائريين يستخدمون واتساب. مع Qflo، عملاؤك ينضمون للطابور فورا او يحجزون موعدا مسبقا — كلها عبر واتساب. لا تطبيق للتحميل.' },
  heroStart: { en: 'Get started', fr: 'Commencer', ar: 'ابدا الان' },
  heroDemo: { en: 'Request a demo', fr: 'Demander une demo', ar: 'اطلب عرضا توضيحيا' },
  heroStat1: { en: 'WhatsApp usage in Algeria', fr: 'Utilisation WhatsApp en Algerie', ar: 'استخدام واتساب في الجزائر' },
  heroStat2: { en: 'Nothing to download', fr: 'Rien a telecharger', ar: 'لا شيء للتحميل' },
  heroStat3: { en: 'Same-day + Future bookings', fr: 'File immediate + RDV futur', ar: 'طابور فوري + موعد مسبق' },

  problemBadge: { en: 'The Problem', fr: 'Le Probleme', ar: 'المشكلة' },
  problemTitle: { en: 'These problems cost you customers every day', fr: 'Ces problemes vous font perdre des clients chaque jour', ar: 'هذه المشاكل تكلفك عملاء كل يوم' },
  problemSub: { en: 'Sound familiar? Qflo solves all of them.', fr: 'Ca vous dit quelque chose ? Qflo resout tout.', ar: 'يبدو مالوفا؟ Qflo يحل كل شيء.' },

  whatsappBadge: { en: 'WhatsApp & Messenger', fr: 'WhatsApp & Messenger', ar: 'واتساب و ماسنجر' },
  whatsappTitle: { en: 'The queue is now in their pocket', fr: 'La file d\'attente est maintenant dans leur poche', ar: 'الطابور الان في جيبهم' },
  whatsappSub: { en: 'Your customers already have WhatsApp. That\'s all they need.', fr: 'Vos clients ont deja WhatsApp. C\'est tout ce qu\'il faut.', ar: 'عملاؤك لديهم واتساب بالفعل. هذا كل ما يحتاجونه.' },
  whatsappJoinLabel: { en: 'Join now (same-day)', fr: 'Rejoindre maintenant (meme jour)', ar: 'انضم الان (نفس اليوم)' },
  whatsappTrackLabel: { en: 'Track position', fr: 'Suivre la position', ar: 'تتبع الموقع' },
  whatsappNotifyLabel: { en: 'Get called', fr: 'Etre appele', ar: 'يتم استدعاؤك' },
  whatsappBookLabel: { en: 'Book future appointment', fr: 'Reserver un RDV futur', ar: 'حجز موعد مسبق' },
  whatsappZeroApp: { en: 'Works on ANY phone with WhatsApp — no download needed', fr: 'Fonctionne sur TOUT telephone avec WhatsApp — aucun telechargement', ar: 'يعمل على اي هاتف به واتساب — لا تحميل' },
  whatsappMessenger: { en: 'Also works with Facebook Messenger', fr: 'Fonctionne aussi avec Facebook Messenger', ar: 'يعمل ايضا مع فيسبوك ماسنجر' },

  appointmentBadge: { en: 'Two Modes', fr: 'Deux Modes', ar: 'طريقتان' },
  appointmentTitle: { en: 'Same-day queue OR future appointment', fr: 'File d\'attente immediate OU rendez-vous futur', ar: 'طابور فوري او موعد مسبق' },
  appointmentSub: { en: 'REJOINDRE: your customer joins the queue right now and gets a ticket immediately. RESERVER: they book an appointment for a future date and time. Both via WhatsApp.', fr: 'REJOINDRE : votre client rejoint la file maintenant et recoit un ticket immediatement. RESERVER : il reserve un rendez-vous pour une date et heure future. Les deux via WhatsApp.', ar: 'انضم: عميلك ينضم للطابور الان ويحصل على تذكرة فورا. احجز: يحجز موعدا لتاريخ ووقت مستقبلي. كلاهما عبر واتساب.' },
  appointmentStep1: { en: 'Same-day: "REJOINDRE CLINIQUE-CENTRE" — instant ticket, join queue NOW', fr: 'Meme jour : "REJOINDRE CLINIQUE-CENTRE" — ticket instantane, file d\'attente MAINTENANT', ar: 'نفس اليوم: "REJOINDRE CLINIQUE-CENTRE" — تذكرة فورية، انضم للطابور الان' },
  appointmentStep2: { en: 'Future: "RESERVER CLINIQUE-CENTRE" — Qflo shows available dates & time slots', fr: 'Futur : "RESERVER CLINIQUE-CENTRE" — Qflo affiche les dates et creneaux disponibles', ar: 'حجز مسبق: "RESERVER CLINIQUE-CENTRE" — Qflo يعرض التواريخ والاوقات المتاحة' },
  appointmentStep3: { en: 'Customer picks a future date & time slot', fr: 'Le client choisit une date et un creneau futur', ar: 'العميل يختار تاريخا ووقتا مسبقا' },
  appointmentStep4: { en: 'Confirmation + automatic reminder before the appointment', fr: 'Confirmation + rappel automatique avant le rendez-vous', ar: 'تاكيد + تذكير تلقائي قبل الموعد' },
  appointmentIdeal: { en: 'Ideal for clinics, restaurants, barbershops, government offices, and any queue or appointment-based service', fr: 'Ideal pour cliniques, restaurants, barbiers, administrations, et tout service a file d\'attente ou sur rendez-vous', ar: 'مثالي للعيادات، المطاعم، الحلاقين، الادارات، واي خدمة بالطوابير او المواعيد' },

  guideBadge: { en: 'How it works', fr: 'Comment ca marche', ar: 'كيف يعمل' },
  guideTitle: { en: 'The customer journey, step by step', fr: 'Le parcours client, etape par etape', ar: 'رحلة العميل، خطوة بخطوة' },
  guideSub: { en: 'Click each step to see exactly what happens.', fr: 'Cliquez sur chaque etape pour voir exactement ce qui se passe.', ar: 'اضغط على كل خطوة لترى بالضبط ما يحدث.' },
  prevStep: { en: '\u2190 Previous step', fr: '\u2190 Etape precedente', ar: 'الخطوة السابقة \u2192' },
  nextStep: { en: 'Next step \u2192', fr: 'Etape suivante \u2192', ar: '\u2190 الخطوة التالية' },
  stepLabel: { en: 'Step', fr: 'Etape', ar: 'خطوة' },

  featuresBadge: { en: 'Features', fr: 'Fonctionnalites', ar: 'المميزات' },
  featuresTitle: { en: 'A complete platform', fr: 'Une plateforme complete', ar: 'منصة متكاملة' },
  featuresSub: { en: 'Everything to digitize queues and appointments, from day one.', fr: 'Tout pour digitaliser files d\'attente et rendez-vous, des le premier jour.', ar: 'كل ما تحتاجه لرقمنة الطوابير والمواعيد، من اليوم الاول.' },

  statsBadge: { en: 'Key Numbers', fr: 'Chiffres Cles', ar: 'ارقام رئيسية' },
  statsTitle: { en: 'Built for Algeria', fr: 'Concu pour l\'Algerie', ar: 'مصمم للجزائر' },

  sectorsBadge: { en: 'Sectors', fr: 'Secteurs', ar: 'القطاعات' },
  sectorsTitle: { en: 'For every sector in Algeria', fr: 'Pour tous les secteurs en Algerie', ar: 'لكل القطاعات في الجزائر' },
  sectorsSub: { en: 'Qflo adapts to any Algerian business that manages queues or appointments.', fr: 'Qflo s\'adapte a tout etablissement algerien qui gere des files d\'attente ou des rendez-vous.', ar: 'Qflo يتكيف مع اي مؤسسة جزائرية تدير طوابير او مواعيد.' },

  dlBadge: { en: 'Downloads', fr: 'Telechargements', ar: 'التحميلات' },
  dlTitle: { en: 'Print-ready documents', fr: 'Documents prets a imprimer', ar: 'وثائق جاهزة للطباعة' },
  dlSub: { en: 'Flyers, brochures and cards in French and Arabic. Download, print, distribute.', fr: 'Flyers, brochures et cartes en francais et arabe. Telechargez, imprimez, distribuez.', ar: 'منشورات، كتيبات وبطاقات بالفرنسية والعربية. حمل، اطبع، وزع.' },
  dlPdf: { en: 'Open & Print', fr: 'Ouvrir & Imprimer', ar: 'فتح وطباعة' },
  dlHint: { en: 'Open HTML files in Chrome \u2192 Ctrl+P \u2192 Save as PDF \u2192 Print', fr: 'Ouvrez les fichiers HTML dans Chrome \u2192 Ctrl+P \u2192 Enregistrer en PDF \u2192 Imprimer', ar: 'افتح ملفات HTML في Chrome \u2192 Ctrl+P \u2192 حفظ ك PDF \u2192 طباعة' },

  faqBadge: { en: 'FAQ', fr: 'FAQ', ar: 'اسئلة شائعة' },
  faqTitle: { en: 'Frequently asked questions', fr: 'Questions frequentes', ar: 'الاسئلة الشائعة' },
  faqSub: { en: 'Everything you need to know before getting started.', fr: 'Tout ce que vous devez savoir avant de commencer.', ar: 'كل ما تحتاج معرفته قبل البدء.' },

  ctaTitle: { en: 'Digitize your queue in 15 minutes', fr: 'Digitalisez votre file d\'attente en 15 minutes', ar: 'رقمن طابورك في 15 دقيقة' },
  ctaSub: { en: 'Join hundreds of Algerian businesses that have eliminated chaotic queues.', fr: 'Rejoignez les etablissements algeriens qui ont elimine le chaos des files d\'attente.', ar: 'انضم للمؤسسات الجزائرية التي تخلصت من فوضى الطوابير.' },
  ctaStart: { en: 'Get started now', fr: 'Commencer maintenant', ar: 'ابدا الان' },
  ctaDemo: { en: 'Request a demo', fr: 'Demander une demo', ar: 'اطلب عرضا توضيحيا' },
  ctaTag1: { en: 'Same-day + Future bookings', fr: 'File immediate + RDV futur', ar: 'طابور فوري + موعد مسبق' },
  ctaTag2: { en: 'FR/AR Support', fr: 'Support FR/AR', ar: 'دعم FR/AR' },
  ctaTag3: { en: 'Works offline', fr: 'Fonctionne hors-ligne', ar: 'يعمل بدون انترنت' },
} satisfies Record<string, T3>;

/* ═══════════════════════════════════════════════ */
/*  DATA                                           */
/* ═══════════════════════════════════════════════ */

const painPoints: { icon: typeof AlertTriangle; before: T3; after: T3; title: T3 }[] = [
  {
    icon: Users,
    title: { en: 'Overcrowded waiting rooms', fr: 'Salles d\'attente bondees', ar: 'قاعات انتظار مكتظة' },
    before: { en: 'Patients packed shoulder-to-shoulder, no space to sit, tensions rising', fr: 'Patients entasses les uns sur les autres, plus de place, tensions qui montent', ar: 'مرضى متكدسون، لا مكان للجلوس، التوتر يتصاعد' },
    after: { en: 'Customers wait at home or in their car — they come only when called via WhatsApp', fr: 'Les clients attendent chez eux ou dans leur voiture — ils viennent uniquement quand ils sont appeles via WhatsApp', ar: 'العملاء ينتظرون في المنزل او السيارة — ياتون فقط عند استدعائهم عبر واتساب' },
  },
  {
    icon: XCircle,
    title: { en: 'Customers leaving', fr: 'Clients qui partent', ar: 'عملاء يغادرون' },
    before: { en: 'Long waits with no visibility — frustrated customers leave and don\'t come back', fr: 'Longues attentes sans visibilite — les clients frustres partent et ne reviennent pas', ar: 'انتظار طويل بلا رؤية — العملاء المحبطون يغادرون ولا يعودون' },
    after: { en: 'Real-time position updates on WhatsApp — customers know exactly when to come', fr: 'Mises a jour en temps reel sur WhatsApp — les clients savent exactement quand venir', ar: 'تحديثات مباشرة على واتساب — العملاء يعرفون بالضبط متى ياتون' },
  },
  {
    icon: Timer,
    title: { en: 'No wait time visibility', fr: 'Aucune visibilite sur l\'attente', ar: 'لا رؤية لوقت الانتظار' },
    before: { en: '"How long will it take?" Nobody knows. Frustration and arguments at the counter', fr: '"Ca va prendre combien de temps ?" Personne ne sait. Frustrations et disputes au guichet', ar: '"كم سياخذ من الوقت؟" لا احد يعرف. احباط وجدال عند الشباك' },
    after: { en: 'Estimated wait time sent automatically — transparent and calm', fr: 'Temps d\'attente estime envoye automatiquement — transparent et serein', ar: 'وقت الانتظار المقدر يرسل تلقائيا — شفاف وهادئ' },
  },
  {
    icon: FileText,
    title: { en: 'Paper-based chaos', fr: 'Chaos du papier', ar: 'فوضى الورق' },
    before: { en: 'Handwritten numbers, lost tickets, arguments about who\'s next', fr: 'Numeros ecrits a la main, tickets perdus, disputes sur qui est le prochain', ar: 'ارقام مكتوبة بخط اليد، تذاكر مفقودة، جدال حول من التالي' },
    after: { en: 'Digital tickets via WhatsApp — automatic, fair, no disputes', fr: 'Tickets numeriques via WhatsApp — automatique, equitable, zero dispute', ar: 'تذاكر رقمية عبر واتساب — تلقائي، عادل، لا نزاعات' },
  },
];

const downloadables = [
  { title: { en: 'Flyer — French', fr: 'Flyer — Francais', ar: 'نشرة اعلانية — فرنسية' }, desc: { en: 'A4 front/back, print-ready', fr: 'Recto-verso A4, pret a imprimer', ar: 'A4 وجهين، جاهز للطباعة' }, file: '/resources/flyer-fr.html', icon: FileText, color: 'bg-blue-50 text-blue-600', tag: 'A4' },
  { title: { en: 'Flyer — Arabic', fr: 'نشرة اعلانية — عربية', ar: 'نشرة اعلانية — عربية' }, desc: { en: 'A4 front/back, RTL', fr: 'A4 recto-verso, RTL', ar: 'A4 وجهين، من اليمين لليسار' }, file: '/resources/flyer-ar.html', icon: FileText, color: 'bg-emerald-50 text-emerald-600', tag: 'A4' },
  { title: { en: 'Brochure — French', fr: 'Brochure — Francais', ar: 'كتيب — فرنسية' }, desc: { en: 'Tri-fold A4 landscape, 6 panels', fr: 'Tri-fold A4 paysage, 6 panneaux', ar: 'ثلاثي الطي A4، 6 الواح' }, file: '/resources/brochure-fr.html', icon: BookOpen, color: 'bg-purple-50 text-purple-600', tag: 'Tri-fold' },
  { title: { en: 'Brochure — Arabic', fr: 'كتيب — عربية', ar: 'كتيب — عربية' }, desc: { en: 'Tri-fold A4 landscape, RTL', fr: 'Tri-fold A4 paysage, RTL', ar: 'ثلاثي الطي A4، من اليمين لليسار' }, file: '/resources/brochure-ar.html', icon: BookOpen, color: 'bg-amber-50 text-amber-600', tag: 'Tri-fold' },
  { title: { en: 'Quick Card — French', fr: 'Carte rapide — Francais', ar: 'بطاقة سريعة — فرنسية' }, desc: { en: 'A5 landscape, hand out on-site', fr: 'A5 paysage, a distribuer sur place', ar: 'A5 افقي، للتوزيع في المكان' }, file: '/resources/quickcard-fr.html', icon: Zap, color: 'bg-rose-50 text-rose-600', tag: 'A5' },
  { title: { en: 'Quick Card — Arabic', fr: 'بطاقة سريعة — عربية', ar: 'بطاقة سريعة — عربية' }, desc: { en: 'A5 landscape, RTL', fr: 'A5 paysage, RTL', ar: 'A5 افقي، من اليمين لليسار' }, file: '/resources/quickcard-ar.html', icon: Zap, color: 'bg-cyan-50 text-cyan-600', tag: 'A5' },
  { title: { en: 'Brand Guidelines', fr: 'Brand Guidelines', ar: 'دليل الهوية البصرية' }, desc: { en: 'Logo, colors, typography, tone', fr: 'Logo, couleurs, typographie, ton', ar: 'الشعار، الالوان، الخطوط، النبرة' }, file: '/resources/brand-guidelines.html', icon: Sparkles, color: 'bg-indigo-50 text-indigo-600', tag: '2 pages' },
  { title: { en: 'Calendar Showcase — French', fr: 'Calendrier — Français', ar: 'عرض التقويم — فرنسية' }, desc: { en: 'A4 calendar feature showcase', fr: 'Vitrine A4 du calendrier de rendez-vous', ar: 'عرض A4 لميزة التقويم' }, file: '/resources/calendar-showcase-fr.html', icon: CalendarCheck, color: 'bg-green-50 text-green-600', tag: 'A4' },
  { title: { en: 'Calendar Showcase — Arabic', fr: 'عرض التقويم — عربية', ar: 'عرض التقويم — عربية' }, desc: { en: 'A4 calendar feature showcase, RTL', fr: 'Vitrine A4 du calendrier, RTL', ar: 'عرض A4 لميزة التقويم، من اليمين لليسار' }, file: '/resources/calendar-showcase-ar.html', icon: CalendarCheck, color: 'bg-teal-50 text-teal-600', tag: 'A4' },
];

const journeySteps = [
  {
    emoji: '\uD83D\uDCF1',
    title: { en: 'Customer joins the queue', fr: 'Le client rejoint la file', ar: 'العميل ينضم للطابور' },
    desc: { en: 'Via WhatsApp, Messenger, QR code, web link or on-site kiosk.', fr: 'Via WhatsApp, Messenger, QR code, lien web ou borne kiosque sur place.', ar: 'عبر واتساب، ماسنجر، رمز QR، رابط ويب او كشك الخدمة الذاتية.' },
    details: {
      en: ['Send REJOINDRE + code (e.g. REJOINDRE ELAZHAR)', 'Scan the displayed QR code', 'Click the link on the welcome page', 'Use the on-site touch kiosk'],
      fr: ['Envoyez REJOINDRE + code (ex: REJOINDRE ELAZHAR)', 'Scannez le QR code affiche', 'Cliquez sur le lien de la page d\'accueil', 'Utilisez la borne tactile sur place'],
      ar: ['ارسل ELAZHAR انضم', 'امسح رمز QR المعروض', 'اضغط على الرابط في صفحة الاستقبال', 'استخدم كشك الخدمة الذاتية في المكان'],
    },
    visual: 'join',
  },
  {
    emoji: '\uD83C\uDFAB',
    title: { en: 'Instant ticket', fr: 'Ticket instantane', ar: 'تذكرة فورية' },
    desc: { en: 'A ticket number is assigned automatically with the queue position.', fr: 'Un numero de ticket est attribue automatiquement avec la position dans la file.', ar: 'يتم منح رقم تذكرة تلقائيا مع الموقع في الطابور.' },
    details: {
      en: ['Unique number (e.g. A-12)', 'Queue position shown in real-time', 'Web link for live tracking', 'Works on any smartphone'],
      fr: ['Numero unique (ex: A-12)', 'Position en file affichee en temps reel', 'Lien web pour suivre en direct', 'Fonctionne sur tout smartphone'],
      ar: ['رقم فريد (مثال: A-12)', 'موقع في الطابور معروض مباشرة', 'رابط ويب للمتابعة المباشرة', 'يعمل على اي هاتف ذكي'],
    },
    visual: 'ticket',
  },
  {
    emoji: '\uD83D\uDCCD',
    title: { en: 'Live tracking', fr: 'Suivi en direct', ar: 'تتبع مباشر' },
    desc: { en: 'The customer tracks their position in the queue in real-time from their phone.', fr: 'Le client suit sa position dans la file en temps reel depuis son telephone.', ar: 'العميل يتابع موقعه في الطابور مباشرة من هاتفه.' },
    details: {
      en: ['Position updated automatically', 'Via WhatsApp / Messenger / web link', 'Estimated wait time', 'Customer can leave and come back on time'],
      fr: ['Position mise a jour automatiquement', 'Via WhatsApp / Messenger / lien web', 'Temps d\'attente estime', 'Le client peut partir et revenir a temps'],
      ar: ['الموقع يتحدث تلقائيا', 'عبر واتساب / ماسنجر / رابط ويب', 'وقت الانتظار التقديري', 'يمكن للعميل المغادرة والعودة في الوقت المناسب'],
    },
    visual: 'track',
  },
  {
    emoji: '\uD83D\uDCE2',
    title: { en: 'Customer called', fr: 'Appel du client', ar: 'استدعاء العميل' },
    desc: { en: 'The operator calls the next customer with one click. The customer is notified everywhere.', fr: 'L\'operateur appelle le prochain en un clic. Le client est notifie partout.', ar: 'الموظف يستدعي التالي بنقرة واحدة. يتم اشعار العميل في كل مكان.' },
    details: {
      en: ['Instant WhatsApp / Messenger notification', 'Announcement on TV display screen', 'Sound alert in the waiting room', 'Desk number clearly indicated'],
      fr: ['Notification WhatsApp / Messenger instantanee', 'Annonce sur l\'ecran d\'affichage TV', 'Alerte sonore dans la salle d\'attente', 'Numero de guichet indique clairement'],
      ar: ['اشعار واتساب / ماسنجر فوري', 'عرض على شاشة التلفزيون', 'تنبيه صوتي في قاعة الانتظار', 'رقم الشباك محدد بوضوح'],
    },
    visual: 'call',
  },
  {
    emoji: '\u2705',
    title: { en: 'Service completed', fr: 'Service termine', ar: 'تمت الخدمة' },
    desc: { en: 'The operator marks the customer as served. Statistics are updated.', fr: 'L\'operateur marque le client comme servi. Les statistiques sont mises a jour.', ar: 'الموظف يحدد العميل ك "تمت خدمته". يتم تحديث الاحصائيات.' },
    details: {
      en: ['Service duration recorded', 'Performance stats updated', 'Next customer called automatically', 'Full history preserved'],
      fr: ['Duree de service enregistree', 'Statistiques de performance mises a jour', 'Le prochain client est appele automatiquement', 'Historique complet conserve'],
      ar: ['مدة الخدمة مسجلة', 'احصائيات الاداء محدثة', 'العميل التالي يستدعى تلقائيا', 'السجل الكامل محفوظ'],
    },
    visual: 'done',
  },
];

const features: { icon: typeof MessageCircle; title: T3; desc: T3; color: string; bg: string; span?: boolean }[] = [
  { icon: MessageCircle, title: { en: 'WhatsApp & Messenger', fr: 'WhatsApp & Messenger', ar: 'واتساب و ماسنجر' }, desc: { en: 'Customers join queues and book appointments via WhatsApp or Messenger. 90% of Algerians already have it. Zero app to download.', fr: 'Les clients rejoignent la file et reservent des RDV via WhatsApp ou Messenger. 90% des Algeriens l\'ont deja. Zero app a telecharger.', ar: 'العملاء ينضمون للطوابير ويحجزون مواعيد عبر واتساب او ماسنجر. 90% من الجزائريين لديه بالفعل. لا تطبيق للتحميل.' }, color: 'text-green-500', bg: 'bg-green-50', span: true },
  { icon: CalendarCheck, title: { en: 'Appointment Booking', fr: 'Prise de rendez-vous', ar: 'حجز المواعيد' }, desc: { en: 'Customers book appointments via WhatsApp message. Pick service, date, time — confirmed instantly.', fr: 'Les clients reservent via message WhatsApp. Choix du service, date, heure — confirme instantanement.', ar: 'العملاء يحجزون عبر رسالة واتساب. اختيار الخدمة، التاريخ، الوقت — تاكيد فوري.' }, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  { icon: Monitor, title: { en: 'TV Display Screen', fr: 'Ecran d\'affichage TV', ar: 'شاشة عرض تلفزيون' }, desc: { en: 'Connect any screen to show calls in real-time. Light/dark themes, customizable.', fr: 'Connectez n\'importe quel ecran pour afficher les appels en temps reel. Themes clair/sombre.', ar: 'وصل اي شاشة لعرض الاستدعاءات مباشرة. سمات فاتحة/داكنة.' }, color: 'text-blue-500', bg: 'bg-blue-50' },
  { icon: QrCode, title: { en: 'QR Code + Kiosk (Local & Remote)', fr: 'QR Code + Kiosque (local & distant)', ar: 'QR + كشك (محلي وبعيد)' }, desc: { en: 'On-site touch kiosk, remote web kiosk, or QR code scan. Multiple entry points for joining the queue or booking.', fr: 'Borne tactile sur place, kiosque web distant, ou scan QR code. Plusieurs points d\'acces pour rejoindre la file ou reserver.', ar: 'كشك لمس في المكان، كشك ويب بعيد، او مسح QR. عدة نقاط دخول للانضمام للطابور او الحجز.' }, color: 'text-amber-500', bg: 'bg-amber-50' },
  { icon: MapPin, title: { en: 'Live Tracking via URL', fr: 'Suivi en direct via URL', ar: 'تتبع مباشر عبر رابط' }, desc: { en: 'Customers track their position via WhatsApp, Messenger, or their unique ticket URL. Real-time estimated wait.', fr: 'Le client suit sa position via WhatsApp, Messenger ou le lien URL unique de sa tذكرة. Temps d\'attente estime.', ar: 'العميل يتابع موقعه عبر واتساب، ماسنجر او رابط URL الفريد لتذكرته. وقت انتظار تقديري.' }, color: 'text-red-500', bg: 'bg-red-50' },
  { icon: Bell, title: { en: 'Instant Notifications', fr: 'Notifications instantanees', ar: 'اشعارات فورية' }, desc: { en: 'Customer notified automatically when called — via WhatsApp, Messenger and display.', fr: 'Client notifie automatiquement a son tour — via WhatsApp, Messenger et ecran.', ar: 'العميل يتلقى اشعار تلقائي عند دوره — عبر واتساب، ماسنجر والشاشة.' }, color: 'text-rose-500', bg: 'bg-rose-50' },
  { icon: Users, title: { en: 'Multi-Department', fr: 'Multi-departements', ar: 'متعدد الاقسام' }, desc: { en: 'Manage multiple services and desks. Separate queues per department.', fr: 'Gerez plusieurs services et guichets. Files separees par departement.', ar: 'ادارة عدة خدمات وشبابيك. طوابير منفصلة لكل قسم.' }, color: 'text-indigo-500', bg: 'bg-indigo-50' },
  { icon: BarChart3, title: { en: 'Analytics Dashboard', fr: 'Tableau de bord analytique', ar: 'لوحة تحكم تحليلية' }, desc: { en: 'Wait times, volume per hour, desk performance. CSV and PDF export.', fr: 'Temps d\'attente, volume par heure, performance guichets. Export CSV et PDF.', ar: 'اوقات الانتظار، الحجم بالساعة، اداء الشبابيك. تصدير CSV و PDF.' }, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  { icon: Globe, title: { en: 'Multilingual FR/AR/EN', fr: 'Multilingue FR/AR/EN', ar: 'متعدد اللغات FR/AR/EN' }, desc: { en: 'Full interface in French, Arabic and English. Auto-detection. Complete RTL for Arabic.', fr: 'Interface complete en francais, arabe et anglais. Detection auto. RTL complet pour l\'arabe.', ar: 'واجهة كاملة بالفرنسية، العربية والانجليزية. كشف تلقائي. RTL كامل للعربية.' }, color: 'text-cyan-500', bg: 'bg-cyan-50' },
  { icon: WifiOff, title: { en: 'Offline Mode', fr: 'Mode hors-ligne', ar: 'وضع بدون انترنت' }, desc: { en: 'Works without internet. Queues managed locally, syncs when connection returns. Essential for Algeria.', fr: 'Fonctionne sans internet. Files gerees localement, synchronisation au retour de la connexion. Essentiel pour l\'Algerie.', ar: 'يعمل بدون انترنت. الطوابير تدار محليا، تزامن عند عودة الاتصال. اساسي للجزائر.' }, color: 'text-slate-500', bg: 'bg-slate-50' },
  { icon: Clock, title: { en: 'Setup in 15 minutes', fr: 'Installation en 15 minutes', ar: 'تثبيت في 15 دقيقة' }, desc: { en: 'Create account, configure services, share QR code. Operational in 15 minutes.', fr: 'Creez votre compte, configurez vos services, partagez le QR code. Operationnel en 15 min.', ar: 'انشئ حسابك، اضبط خدماتك، شارك رمز QR. جاهز في 15 دقيقة.' }, color: 'text-orange-500', bg: 'bg-orange-50' },
  { icon: Zap, title: { en: 'Zero app for customers', fr: 'Zero app pour le client', ar: 'لا تطبيق للعميل' }, desc: { en: 'Customers use WhatsApp or Messenger — already on their phones. Nothing to download.', fr: 'Vos clients utilisent WhatsApp ou Messenger — deja sur leur telephone. Rien a telecharger.', ar: 'عملاؤك يستخدمون واتساب او ماسنجر — مثبتين مسبقا. لا حاجة للتحميل.' }, color: 'text-yellow-500', bg: 'bg-yellow-50' },
];

const sectors = [
  { icon: Stethoscope, name: { en: 'Healthcare', fr: 'Sante', ar: 'الصحة' }, examples: { en: 'Clinics, Hospitals, Health Centers', fr: 'Cliniques, Hopitaux, Centres de sante', ar: 'عيادات، مستشفيات، مراكز صحية' }, color: 'text-red-500', bg: 'bg-red-50' },
  { icon: Landmark, name: { en: 'Banks', fr: 'Banques', ar: 'البنوك' }, examples: { en: 'BNA, CPA, BEA, BADR, BDL...', fr: 'BNA, CPA, BEA, BADR, BDL...', ar: 'BNA, CPA, BEA, BADR, BDL...' }, color: 'text-blue-500', bg: 'bg-blue-50' },
  { icon: Building2, name: { en: 'Government', fr: 'Administration', ar: 'الادارة' }, examples: { en: 'APC, Da\u00EFra, Civil Registry', fr: 'APC, Da\u00EFra, Etat Civil', ar: 'البلدية، الدائرة، الحالة المدنية' }, color: 'text-slate-500', bg: 'bg-slate-50' },
  { icon: ShoppingBag, name: { en: 'Restaurants, Barbershops & Retail', fr: 'Restaurants, Barbiers & Commerces', ar: 'المطاعم، الحلاقين والمحلات' }, examples: { en: 'Restaurants, Barbershops, Salons, Stores', fr: 'Restaurants, Barbiers, Salons, Magasins', ar: 'المطاعم، الحلاقين، الصالونات، المتاجر' }, color: 'text-purple-500', bg: 'bg-purple-50' },
  { icon: GraduationCap, name: { en: 'Universities', fr: 'Universites', ar: 'الجامعات' }, examples: { en: 'Registration, Scholarships, Admin', fr: 'Inscriptions, Bourses, Scolarite', ar: 'التسجيلات، المنح، الادارة' }, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  { icon: Phone, name: { en: 'Telecom', fr: 'Telecom', ar: 'الاتصالات' }, examples: { en: 'Djezzy, Ooredoo, Mobilis', fr: 'Djezzy, Ooredoo, Mobilis', ar: 'جيزي، اوريدو، موبيليس' }, color: 'text-pink-500', bg: 'bg-pink-50' },
];

const faqs: { q: T3; a: T3 }[] = [
  {
    q: { en: 'What is the difference between joining a queue and booking an appointment?', fr: 'Quelle est la difference entre rejoindre une file et reserver un rendez-vous ?', ar: 'ما الفرق بين الانضمام للطابور وحجز موعد؟' },
    a: { en: 'REJOINDRE = join the queue right now (same-day, walk-in). You get a ticket and wait your turn today. RESERVER = book an appointment for a future date and time. You choose when to come. Both work via WhatsApp.', fr: 'REJOINDRE = rejoindre la file maintenant (meme jour, sans rendez-vous). Vous recevez un ticket et attendez votre tour aujourd\'hui. RESERVER = prendre rendez-vous pour une date et heure future. Vous choisissez quand venir. Les deux fonctionnent via WhatsApp.', ar: 'انضم = انضم للطابور الان (نفس اليوم، بدون موعد). تحصل على تذكرة وتنتظر دورك اليوم. احجز = حجز موعد لتاريخ ووقت مستقبلي. تختار متى تاتي. كلاهما عبر واتساب.' },
  },
  {
    q: { en: 'Do customers need to download an app?', fr: 'Les clients doivent-ils telecharger une application ?', ar: 'هل يحتاج العملاء لتحميل تطبيق؟' },
    a: { en: 'No. Customers use WhatsApp or Messenger — apps they already have. They can also scan a QR code or use a web link. Nothing to install.', fr: 'Non. Les clients utilisent WhatsApp ou Messenger — des apps qu\'ils ont deja. Ils peuvent aussi scanner un QR code ou utiliser un lien web. Rien a installer.', ar: 'لا. العملاء يستخدمون واتساب او ماسنجر — تطبيقات لديهم بالفعل. يمكنهم ايضا مسح رمز QR او استخدام رابط ويب. لا شيء للتثبيت.' },
  },
  {
    q: { en: 'Does it work with WhatsApp Business?', fr: 'Ca marche avec WhatsApp Business ?', ar: 'هل يعمل مع واتساب بيزنس؟' },
    a: { en: 'Yes. Qflo integrates with the WhatsApp Business API. Your customers interact with your official business number.', fr: 'Oui. Qflo s\'integre a l\'API WhatsApp Business. Vos clients interagissent avec votre numero professionnel officiel.', ar: 'نعم. Qflo يتكامل مع واجهة واتساب بيزنس. عملاؤك يتفاعلون مع رقمك المهني الرسمي.' },
  },
  {
    q: { en: 'Can customers book a future appointment via WhatsApp?', fr: 'Les clients peuvent-ils reserver un rendez-vous futur via WhatsApp ?', ar: 'هل يمكن للعملاء حجز موعد مسبق عبر واتساب؟' },
    a: { en: 'Yes! Customers send RESERVER + the business code, pick a service, choose a future date and time, and receive instant confirmation with an automatic reminder before the appointment.', fr: 'Oui ! Les clients envoient RESERVER + le code, choisissent un service, une date et heure future, et recoivent une confirmation instantanee avec un rappel automatique avant le rendez-vous.', ar: 'نعم! العملاء يرسلون احجز + الرمز، يختارون خدمة، تاريخ ووقت مستقبلي، ويتلقون تاكيد فوري مع تذكير تلقائي قبل الموعد.' },
  },
  {
    q: { en: 'How does the customer join the queue?', fr: 'Comment le client rejoint la file ?', ar: 'كيف ينضم العميل للطابور؟' },
    a: { en: 'The customer sends a WhatsApp message with the command (e.g. REJOINDRE ELAZHAR), scans a QR code, clicks a web link, or uses the on-site kiosk.', fr: 'Le client envoie un message WhatsApp avec la commande (ex: REJOINDRE ELAZHAR), scanne un QR code, clique sur un lien web, ou utilise la borne sur place.', ar: 'العميل يرسل رسالة واتساب بالامر (مثال: انضم ELAZHAR)، يمسح رمز QR، يضغط على رابط ويب، او يستخدم الكشك.' },
  },
  {
    q: { en: 'Does it work without internet?', fr: 'Ca marche sans internet ?', ar: 'هل يعمل بدون انترنت؟' },
    a: { en: 'Yes. The operator app works fully offline. Queues are managed locally and sync when the connection returns. Essential for Algeria where internet can be unstable.', fr: 'Oui. L\'application operateur fonctionne entierement hors-ligne. Les files sont gerees localement et se synchronisent au retour de la connexion. Essentiel en Algerie ou l\'internet peut etre instable.', ar: 'نعم. تطبيق الموظف يعمل بالكامل بدون انترنت. الطوابير تدار محليا وتزامن عند عودة الاتصال. اساسي في الجزائر حيث الانترنت قد يكون غير مستقر.' },
  },
  {
    q: { en: 'How long does setup take?', fr: 'Combien de temps pour l\'installation ?', ar: 'كم يستغرق التثبيت؟' },
    a: { en: '15 minutes. Create your account, configure departments, share the QR code. Our team helps you get set up.', fr: '15 minutes. Creez votre compte, configurez vos departements, partagez le QR code. Notre equipe vous accompagne.', ar: '15 دقيقة. انشئ حسابك، اضبط الاقسام، شارك رمز QR. فريقنا يرافقك.' },
  },
  {
    q: { en: 'What languages are supported?', fr: 'Quelles langues sont supportees ?', ar: 'ما اللغات المدعومة؟' },
    a: { en: 'French, Arabic and English. Client language is detected automatically. Full RTL support for Arabic.', fr: 'Francais, arabe et anglais. La langue du client est detectee automatiquement. Support RTL complet pour l\'arabe.', ar: 'الفرنسية، العربية والانجليزية. يتم كشف لغة العميل تلقائيا. دعم RTL كامل للعربية.' },
  },
  {
    q: { en: 'Can a customer join the queue AND book a future appointment?', fr: 'Un client peut-il rejoindre la file ET reserver un rendez-vous futur ?', ar: 'هل يمكن للعميل الانضمام للطابور وحجز موعد مسبق؟' },
    a: { en: 'Yes! Both modes are available simultaneously. A walk-in customer sends REJOINDRE to get a ticket right now. Someone who wants to plan ahead sends RESERVER to pick a future date and time.', fr: 'Oui ! Les deux modes sont disponibles simultanement. Un client sans rendez-vous envoie REJOINDRE pour obtenir un ticket maintenant. Quelqu\'un qui veut planifier envoie RESERVER pour choisir une date et heure future.', ar: 'نعم! كلا الوضعين متاحان في نفس الوقت. عميل بدون موعد يرسل انضم للحصول على تذكرة الان. من يريد التخطيط يرسل احجز لاختيار تاريخ ووقت مستقبلي.' },
  },
  {
    q: { en: 'Can we manage multiple departments?', fr: 'Peut-on gerer plusieurs departements ?', ar: 'هل يمكن ادارة عدة اقسام؟' },
    a: { en: 'Yes. Create unlimited departments (e.g. Teller, Claims, VIP), each with its own queue and operators.', fr: 'Oui. Creez autant de departements que necessaire (ex: Caisse, Reclamations, VIP), chacun avec sa propre file et ses operateurs.', ar: 'نعم. انشئ اقسام بلا حدود (مثال: الصندوق، الشكاوى، VIP)، كل قسم بطابوره وموظفيه.' },
  },
];

/* ═══════════════════════════════════════════════ */
/*  COMPONENTS                                     */
/* ═══════════════════════════════════════════════ */

function WhatsAppChatBubble({ from, children, delay }: { from: 'user' | 'bot'; children: React.ReactNode; delay?: number }) {
  const [visible, setVisible] = useState(!delay);
  useEffect(() => {
    if (delay) {
      const t = setTimeout(() => setVisible(true), delay);
      return () => clearTimeout(t);
    }
  }, [delay]);

  if (!visible) return <div className="h-8" />;

  return (
    <div className={`flex ${from === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[11px] leading-relaxed shadow-sm ${from === 'user' ? 'bg-[#dcf8c6] text-gray-800' : 'bg-white text-gray-800'}`}>
        {children}
      </div>
    </div>
  );
}

function WhatsAppPhoneMockup({ flow, locale }: { flow: 'queue' | 'appointment'; locale: string }) {
  const l = locale as L;

  const queueFlow = (
    <div className="space-y-2">
      <WhatsAppChatBubble from="user">
        <div className="font-bold">REJOINDRE CLINIQUE-CENTRE</div>
      </WhatsAppChatBubble>
      <WhatsAppChatBubble from="bot" delay={400}>
        <div className="font-bold text-[#25d366]">
          {t3(l, { en: 'Welcome to Clinique Centre!', fr: 'Bienvenue a Clinique Centre !', ar: '!مرحبا بك في عيادة المركز' })}
        </div>
        <div className="mt-1">
          {t3(l, { en: 'Your ticket:', fr: 'Votre ticket :', ar: 'تذكرتك:' })} <span className="font-black text-sm">A-12</span>
        </div>
        <div>{t3(l, { en: 'Position: 3rd', fr: 'Position : 3e', ar: 'الموقع: الثالث' })}</div>
        <div className="text-gray-500">{t3(l, { en: 'Wait: ~15 min', fr: 'Attente : ~15 min', ar: 'الانتظار: ~15 دقيقة' })}</div>
      </WhatsAppChatBubble>
      <WhatsAppChatBubble from="bot" delay={800}>
        <div className="font-bold text-blue-600">
          {t3(l, { en: 'Update:', fr: 'Mise a jour :', ar: 'تحديث:' })}
        </div>
        <div>{t3(l, { en: 'You are now 1st! ~3 min', fr: 'Vous etes 1er ! ~3 min', ar: 'انت الاول الان! ~3 دقائق' })}</div>
      </WhatsAppChatBubble>
      <WhatsAppChatBubble from="bot" delay={1200}>
        <div className="font-black text-[#25d366] text-xs">
          {t3(l, { en: "IT'S YOUR TURN!", fr: 'C\'EST VOTRE TOUR !', ar: 'حان دورك!' })}
        </div>
        <div className="font-bold">{t3(l, { en: 'Desk 3', fr: 'Guichet 3', ar: 'الشباك 3' })}</div>
      </WhatsAppChatBubble>
    </div>
  );

  const appointmentFlow = (
    <div className="space-y-2">
      <WhatsAppChatBubble from="user">
        <div className="font-bold">RESERVER CLINIQUE-CENTRE</div>
      </WhatsAppChatBubble>
      <WhatsAppChatBubble from="bot" delay={400}>
        <div className="font-bold text-[#25d366]">
          {t3(l, { en: 'Available slots:', fr: 'Creneaux disponibles :', ar: 'الاوقات المتاحة:' })}
        </div>
        <div className="mt-1 space-y-0.5">
          <div>1. {t3(l, { en: 'Mon 14 Apr - 09:00', fr: 'Lun 14 Avr - 09:00', ar: 'الاثنين 14 ابريل - 09:00' })}</div>
          <div>2. {t3(l, { en: 'Mon 14 Apr - 10:30', fr: 'Lun 14 Avr - 10:30', ar: 'الاثنين 14 ابريل - 10:30' })}</div>
          <div>3. {t3(l, { en: 'Tue 15 Apr - 08:00', fr: 'Mar 15 Avr - 08:00', ar: 'الثلاثاء 15 ابريل - 08:00' })}</div>
        </div>
        <div className="text-gray-500 mt-1">{t3(l, { en: 'Reply with the number', fr: 'Repondez avec le numero', ar: 'رد بالرقم' })}</div>
      </WhatsAppChatBubble>
      <WhatsAppChatBubble from="user" delay={800}>
        <div className="font-bold">1</div>
      </WhatsAppChatBubble>
      <WhatsAppChatBubble from="bot" delay={1200}>
        <div className="font-black text-[#25d366] text-xs">
          {t3(l, { en: 'Confirmed!', fr: 'Confirme !', ar: 'تم التاكيد!' })}
        </div>
        <div>{t3(l, { en: 'Mon 14 Apr at 09:00', fr: 'Lun 14 Avr a 09:00', ar: 'الاثنين 14 ابريل الساعة 09:00' })}</div>
        <div className="text-gray-500 mt-1">{t3(l, { en: 'Reminder 1h before', fr: 'Rappel 1h avant', ar: 'تذكير قبل ساعة' })}</div>
      </WhatsAppChatBubble>
    </div>
  );

  return (
    <div className="mx-auto w-[220px] shrink-0">
      <div className="rounded-[24px] border-[3px] border-gray-800 bg-gray-900 p-1 shadow-2xl">
        {/* Notch */}
        <div className="mx-auto mb-1 h-4 w-20 rounded-b-xl bg-gray-800" />
        {/* Screen */}
        <div className="rounded-[18px] bg-[#ece5dd] p-3 min-h-[280px]">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-300/50">
            <div className="h-6 w-6 rounded-full bg-[#25d366] flex items-center justify-center">
              <MessageCircle className="h-3.5 w-3.5 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-bold text-gray-800">Qflo</div>
              <div className="text-[8px] text-gray-500">online</div>
            </div>
          </div>
          {flow === 'queue' ? queueFlow : appointmentFlow}
        </div>
      </div>
    </div>
  );
}

function PhoneMockup({ type, locale }: { type: string; locale: string }) {
  const l = locale as L;
  const msgs = {
    join: { cmd: { en: 'REJOINDRE ELAZHAR', fr: 'REJOINDRE ELAZHAR', ar: 'ELAZHAR انضم' }, welcome: { en: 'Welcome!', fr: 'Bienvenue !', ar: '!اهلا' }, ticket: { en: 'Your ticket:', fr: 'Votre ticket :', ar: 'تذكرتك:' }, pos: { en: 'Position: 3rd', fr: 'Position : 3e', ar: 'الموقع: الثالث' } },
    track: { update: { en: 'Update', fr: 'Mise a jour', ar: 'تحديث' }, pos2: { en: 'You are now 2nd in line', fr: 'Vous etes maintenant 2e en file', ar: 'انت الان الثاني في الطابور' }, wait: { en: '~5 min wait', fr: '~5 min d\'attente', ar: '~5 دقائق انتظار' }, almost: { en: 'Almost your turn!', fr: 'Presque votre tour !', ar: 'اقترب دورك!' }, next: { en: 'You are next', fr: 'Vous etes le prochain', ar: 'انت التالي' } },
    call: { turn: { en: 'IT\'S YOUR TURN!', fr: 'C\'EST VOTRE TOUR !', ar: 'حان دورك!' }, desk: { en: 'Desk 2', fr: 'Guichet 2', ar: 'الشباك 2' }, proceed: { en: 'Please proceed', fr: 'Veuillez vous presenter', ar: 'يرجى التقدم' } },
    ticket_screen: { label: { en: 'YOUR TICKET', fr: 'VOTRE TICKET', ar: 'تذكرتك' }, position: { en: 'Position', fr: 'Position', ar: 'الموقع' }, wait: { en: 'Wait', fr: 'Attente', ar: 'الانتظار' } },
    done: { title: { en: 'Service completed', fr: 'Service termine', ar: 'تمت الخدمة' }, served: { en: 'Ticket A-12 served', fr: 'Ticket A-12 servi', ar: 'التذكرة A-12 تمت خدمتها' }, duration: { en: 'Duration: 4 min', fr: 'Duree : 4 min', ar: 'المدة: 4 دقائق' }, thanks: { en: 'Thank you for your visit', fr: 'Merci pour votre visite', ar: 'شكرا لزيارتك' } },
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
          <div className="text-lg">{'\uD83D\uDCE2'}</div>
          <div className="text-[11px] font-black text-green-800">{msgs.call.turn[l]}</div>
          <div className="text-[10px] text-green-700 font-semibold mt-1">{msgs.call.desk[l]}</div>
          <div className="text-[9px] text-green-600 mt-0.5">{msgs.call.proceed[l]}</div>
        </div>
      </div>
    ),
    done: (
      <div className="rounded-xl bg-white p-3 text-center shadow-sm">
        <div className="text-2xl mb-1">{'\u2705'}</div>
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
  const [whatsappTab, setWhatsappTab] = useState<'queue' | 'appointment'>('queue');
  const { locale } = useI18n();
  const l = (locale || 'en') as L;
  const _ = (obj: T3) => t3(l, obj);

  return (
    <>
      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-blue-600 to-blue-800 py-20 md:py-28">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.08),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.05),transparent_40%)]" />
        <div className="relative mx-auto max-w-7xl px-6">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Left: Text */}
            <div className="flex-1 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/80 backdrop-blur-sm mb-6">
                <MessageCircle className="h-3.5 w-3.5" />
                {_(labels.heroBadge)}
              </div>
              <h1 className="text-3xl font-black tracking-tight text-white md:text-5xl lg:text-6xl leading-tight">
                {_(labels.heroTitle1)}<br />
                <span className="text-[#25d366]">{_(labels.heroTitle2)}</span>
              </h1>
              <p className="mt-6 max-w-xl text-base text-white/70 md:text-lg leading-relaxed">
                {_(labels.heroSub)}
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center lg:justify-start gap-3">
                <Link href="/contact" className="inline-flex items-center gap-2 rounded-xl bg-[#25d366] px-6 py-3.5 text-sm font-bold text-white shadow-lg transition-all hover:shadow-xl hover:scale-[1.02] hover:bg-[#20bd5a]">
                  <Send className="h-4 w-4" />{_(labels.heroStart)}
                </Link>
                <Link href="/contact" className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20">
                  <Play className="h-4 w-4" />{_(labels.heroDemo)}
                </Link>
              </div>
              {/* Mini stats */}
              <div className="mt-8 flex flex-wrap items-center justify-center lg:justify-start gap-6 text-sm">
                <span className="flex items-center gap-2 text-white/80">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#25d366]/20 text-[#25d366]"><TrendingUp className="h-4 w-4" /></span>
                  <span><strong className="text-white">90%</strong> {_(labels.heroStat1)}</span>
                </span>
                <span className="flex items-center gap-2 text-white/80">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10"><Zap className="h-4 w-4 text-yellow-300" /></span>
                  <span>{_(labels.heroStat2)}</span>
                </span>
                <span className="flex items-center gap-2 text-white/80">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10"><Check className="h-4 w-4 text-emerald-300" /></span>
                  <span>{_(labels.heroStat3)}</span>
                </span>
              </div>
            </div>
            {/* Right: WhatsApp phone mockup */}
            <div className="shrink-0">
              <WhatsAppPhoneMockup flow="queue" locale={l} />
            </div>
          </div>
        </div>
      </section>

      {/* ─── PROBLEM-AGITATION ─── */}
      <section className="py-20 md:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-red-50 px-4 py-1.5 text-xs font-bold text-red-600 mb-4">
              <AlertTriangle className="h-3.5 w-3.5" />{_(labels.problemBadge)}
            </div>
            <h2 className="text-3xl font-black md:text-4xl">{_(labels.problemTitle)}</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">{_(labels.problemSub)}</p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {painPoints.map((p, i) => (
              <div key={i} className="group rounded-2xl border border-border bg-card overflow-hidden transition-all hover:shadow-lg">
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="rounded-xl bg-red-50 p-2.5">
                      <p.icon className="h-5 w-5 text-red-500" />
                    </div>
                    <h3 className="text-base font-bold">{_(p.title)}</h3>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-red-50/50 border border-red-100 p-4">
                      <div className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-2">
                        {t3(l, { en: 'Before Qflo', fr: 'Avant Qflo', ar: 'قبل Qflo' })}
                      </div>
                      <p className="text-sm text-red-700/80 leading-relaxed">{_(p.before)}</p>
                    </div>
                    <div className="rounded-xl bg-green-50/50 border border-green-100 p-4">
                      <div className="text-[10px] font-bold text-green-600 uppercase tracking-wider mb-2">
                        {t3(l, { en: 'After Qflo', fr: 'Apres Qflo', ar: 'بعد Qflo' })}
                      </div>
                      <p className="text-sm text-green-700/80 leading-relaxed">{_(p.after)}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── WHATSAPP/MESSENGER SHOWCASE ─── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#25d366]/5 via-green-50/50 to-white py-20 md:py-24 border-y border-border">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#25d366]/10 px-4 py-1.5 text-xs font-bold text-[#25d366] mb-4">
              <MessageCircle className="h-3.5 w-3.5" />{_(labels.whatsappBadge)}
            </div>
            <h2 className="text-3xl font-black md:text-4xl">{_(labels.whatsappTitle)}</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">{_(labels.whatsappSub)}</p>
          </div>

          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Phone mockup */}
            <div className="shrink-0 order-1 lg:order-none">
              <div className="flex justify-center gap-2 mb-6">
                <button
                  onClick={() => setWhatsappTab('queue')}
                  className={`rounded-full px-4 py-2 text-xs font-bold transition-all ${whatsappTab === 'queue' ? 'bg-[#25d366] text-white shadow-lg' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {_(labels.whatsappJoinLabel)}
                </button>
                <button
                  onClick={() => setWhatsappTab('appointment')}
                  className={`rounded-full px-4 py-2 text-xs font-bold transition-all ${whatsappTab === 'appointment' ? 'bg-[#25d366] text-white shadow-lg' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {_(labels.whatsappBookLabel)}
                </button>
              </div>
              <WhatsAppPhoneMockup flow={whatsappTab} locale={l} />
            </div>

            {/* Right: Steps */}
            <div className="flex-1">
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  { icon: Send, label: labels.whatsappJoinLabel, desc: { en: 'Send REJOINDRE + code — get a ticket and join the queue RIGHT NOW. Walk-in, same-day.', fr: 'Envoyez REJOINDRE + code — obtenez un ticket et rejoignez la file MAINTENANT. Sans rendez-vous, meme jour.', ar: 'ارسل انضم + الرمز — احصل على تذكرة وانضم للطابور الان. بدون موعد، نفس اليوم.' } as T3, color: 'bg-[#25d366]' },
                  { icon: MapPin, label: labels.whatsappTrackLabel, desc: { en: 'Real-time position updates sent to WhatsApp', fr: 'Mises a jour de position envoyees en temps reel sur WhatsApp', ar: 'تحديثات الموقع ترسل مباشرة على واتساب' } as T3, color: 'bg-blue-500' },
                  { icon: Bell, label: labels.whatsappNotifyLabel, desc: { en: '"It\'s your turn! Desk 3" — instant notification', fr: '"C\'est votre tour ! Guichet 3" — notification instantanee', ar: '"حان دورك! الشباك 3" — اشعار فوري' } as T3, color: 'bg-amber-500' },
                  { icon: CalendarCheck, label: labels.whatsappBookLabel, desc: { en: 'Send RESERVER + code — pick a FUTURE date and time slot. Confirmation + automatic reminder.', fr: 'Envoyez RESERVER + code — choisissez une date et heure FUTURE. Confirmation + rappel automatique.', ar: 'ارسل احجز + الرمز — اختر تاريخا ووقتا مسبقا. تاكيد + تذكير تلقائي.' } as T3, color: 'bg-purple-500' },
                ].map((item, i) => (
                  <div key={i} className="rounded-2xl border border-border bg-card p-5 transition-all hover:shadow-md hover:-translate-y-0.5">
                    <div className={`inline-flex rounded-xl ${item.color} p-2.5 mb-3`}>
                      <item.icon className="h-4 w-4 text-white" />
                    </div>
                    <h4 className="text-sm font-bold mb-1">{_(item.label)}</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">{_(item.desc)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <div className="flex items-center gap-2 rounded-xl bg-[#25d366]/10 px-4 py-2.5 text-xs font-semibold text-[#25d366]">
                  <Smartphone className="h-4 w-4" />
                  {_(labels.whatsappZeroApp)}
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-[#0084ff]/10 px-4 py-2.5 text-xs font-semibold text-[#0084ff]">
                  <MessageCircle className="h-4 w-4" />
                  {_(labels.whatsappMessenger)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── APPOINTMENT BOOKING ─── */}
      <section className="py-20 md:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Left: Content */}
            <div className="flex-1">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-xs font-bold text-emerald-600 mb-4">
                <CalendarCheck className="h-3.5 w-3.5" />{_(labels.appointmentBadge)}
              </div>
              <h2 className="text-3xl font-black md:text-4xl mb-4">{_(labels.appointmentTitle)}</h2>
              <p className="text-muted-foreground mb-8 max-w-lg leading-relaxed">{_(labels.appointmentSub)}</p>

              <div className="space-y-4 mb-8">
                {[labels.appointmentStep1, labels.appointmentStep2, labels.appointmentStep3, labels.appointmentStep4].map((step, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-white text-sm font-black">
                      {i + 1}
                    </div>
                    <div className="pt-1 text-sm font-medium">{_(step)}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-muted/40 px-5 py-3 text-sm text-muted-foreground">
                <Sparkles className="inline h-4 w-4 text-emerald-500 mr-2" />
                {_(labels.appointmentIdeal)}
              </div>
            </div>
            {/* Right: Phone mockup */}
            <div className="shrink-0">
              <WhatsAppPhoneMockup flow="appointment" locale={l} />
            </div>
          </div>
        </div>
      </section>

      {/* ─── INTERACTIVE JOURNEY GUIDE ─── */}
      <section id="guide" className="scroll-mt-20 py-20 md:py-24 bg-muted/20 border-y border-border">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary mb-4"><Play className="h-3.5 w-3.5" />{_(labels.guideBadge)}</div>
            <h2 className="text-3xl font-black md:text-4xl">{_(labels.guideTitle)}</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">{_(labels.guideSub)}</p>
          </div>

          {/* Step indicators */}
          <div className="flex flex-wrap justify-center gap-2 mb-12">
            {journeySteps.map((s, i) => (
              <button key={i} onClick={() => setActiveStep(i)} className={`group flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-200 ${activeStep === i ? 'bg-primary text-white shadow-lg shadow-primary/25 scale-105' : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <span className="text-lg">{s.emoji}</span>
                <span className="hidden sm:inline">{_(s.title)}</span>
                <span className="sm:hidden">{_(labels.stepLabel)} {i + 1}</span>
              </button>
            ))}
          </div>

          {/* Progress bar */}
          <div className="max-w-2xl mx-auto mb-8">
            <div className="flex items-center gap-1">
              {journeySteps.map((_, i) => (
                <div key={i} className="flex-1 flex items-center">
                  <div className={`h-2 w-full rounded-full transition-all duration-500 ${i <= activeStep ? 'bg-primary' : 'bg-muted-foreground/20'}`} />
                </div>
              ))}
            </div>
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
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
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
      <section className="py-20 md:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary mb-4"><Sparkles className="h-3.5 w-3.5" />{_(labels.featuresBadge)}</div>
            <h2 className="text-3xl font-black md:text-4xl">{_(labels.featuresTitle)}</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">{_(labels.featuresSub)}</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={_(f.title)} className={`group rounded-2xl border transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 ${f.span ? 'sm:col-span-2 border-[#25d366]/30 bg-gradient-to-br from-[#25d366]/5 to-transparent p-8' : 'border-border bg-card p-6 hover:border-primary/20'}`}>
                <div className={`inline-flex rounded-xl ${f.span ? 'bg-[#25d366]/10' : f.bg} p-3 mb-4`}>
                  <f.icon className={`h-5 w-5 ${f.span ? 'text-[#25d366]' : f.color}`} />
                </div>
                <h3 className={`font-bold mb-2 ${f.span ? 'text-lg' : 'text-base'}`}>{_(f.title)}</h3>
                <p className={`text-muted-foreground leading-relaxed ${f.span ? 'text-base' : 'text-sm'}`}>{_(f.desc)}</p>
                {f.span && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {['WhatsApp', 'Messenger', 'QR Code', 'Web Link'].map(tag => (
                      <span key={tag} className="rounded-full bg-[#25d366]/10 px-3 py-1 text-xs font-semibold text-[#25d366]">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── KEY STATS / SOCIAL PROOF ─── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-blue-600 to-blue-800 py-20 md:py-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(255,255,255,0.06),transparent_50%)]" />
        <div className="relative mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-bold text-white/80 backdrop-blur-sm mb-4">
              <TrendingUp className="h-3.5 w-3.5" />{_(labels.statsBadge)}
            </div>
            <h2 className="text-3xl font-black text-white md:text-4xl">{_(labels.statsTitle)}</h2>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { target: 90, suffix: '%', label: { en: 'WhatsApp usage in Algeria', fr: 'Utilisation WhatsApp en Algerie', ar: 'استخدام واتساب في الجزائر' } as T3 },
              { target: 15, suffix: ' min', label: { en: 'Setup time', fr: 'Temps d\'installation', ar: 'وقت التثبيت' } as T3 },
              { target: 2, suffix: '', label: { en: 'Modes: Same-day + Future', fr: 'Modes : Immediat + Futur', ar: 'طريقتان: فوري + مستقبلي' } as T3 },
              { target: 5, suffix: '+', label: { en: 'Booking channels', fr: 'Canaux de reservation', ar: 'قنوات الحجز' } as T3 },
              { target: 3, suffix: '', label: { en: 'Languages: FR/AR/EN', fr: 'Langues : FR/AR/EN', ar: 'لغات: FR/AR/EN' } as T3 },
            ].map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-white">
                  <AnimatedCounter target={stat.target} suffix={stat.suffix} />
                </div>
                <div className="mt-2 text-sm text-white/60">{_(stat.label)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── SECTORS ─── */}
      <section className="py-20 md:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary mb-4"><Building2 className="h-3.5 w-3.5" />{_(labels.sectorsBadge)}</div>
            <h2 className="text-3xl font-black md:text-4xl">{_(labels.sectorsTitle)}</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">{_(labels.sectorsSub)}</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 max-w-5xl mx-auto">
            {sectors.map((s) => (
              <div key={_(s.name)} className="group rounded-2xl border border-border bg-card p-5 transition-all hover:shadow-lg hover:border-primary/20 hover:-translate-y-0.5">
                <div className={`rounded-xl ${s.bg} p-3 inline-flex mb-3`}><s.icon className={`h-6 w-6 ${s.color}`} /></div>
                <div className="font-bold text-sm mb-1">{_(s.name)}</div>
                <div className="text-xs text-muted-foreground">{_(s.examples)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── DOWNLOADS ─── */}
      <section id="downloads" className="scroll-mt-20 bg-muted/20 py-20 md:py-24 border-y border-border">
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
      <section className="py-20 md:py-24">
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
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-blue-600 to-blue-800 py-20 md:py-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_60%,rgba(255,255,255,0.06),transparent_50%)]" />
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-black text-white md:text-4xl leading-tight">{_(labels.ctaTitle)}</h2>
          <p className="mt-4 text-lg text-white/70">{_(labels.ctaSub)}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/contact" className="inline-flex items-center gap-2 rounded-xl bg-[#25d366] px-8 py-4 text-base font-bold text-white shadow-lg transition-all hover:shadow-xl hover:scale-[1.02] hover:bg-[#20bd5a]">
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
