'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useI18n } from '@/components/providers/locale-provider';
import {
  ArrowRight, Check, Settings, QrCode, Monitor, Smartphone,
  MessageCircle, Users, CalendarCheck, Bell, WifiOff,
  Share2, Tablet, Tv, ScanLine, Play, RotateCcw,
} from 'lucide-react';

type L = 'en' | 'fr' | 'ar';
type T3 = Record<L, string>;
function t3(locale: string, obj: T3) { return obj[locale as L] || obj.en; }

/* ═══════════════════════════════════════════════ */
/*  ANIMATED WHATSAPP DEMO                          */
/* ═══════════════════════════════════════════════ */

type ChatMsg = { from: 'user' | 'bot'; lines: T3[]; delay: number; highlight?: boolean };

const demoMessages: ChatMsg[] = [
  { from: 'user', delay: 0, lines: [
    { en: 'REJOINDRE CLINIQUE-CENTRE', fr: 'REJOINDRE CLINIQUE-CENTRE', ar: 'REJOINDRE CLINIQUE-CENTRE' },
  ]},
  { from: 'bot', delay: 1200, lines: [
    { en: 'Welcome to Clinique Centre!', fr: 'Bienvenue a Clinique Centre !', ar: 'مرحبا بك في عيادة المركز!' },
    { en: 'Your ticket: A-12', fr: 'Votre ticket : A-12', ar: 'تذكرتك: A-12' },
    { en: 'Position: 3rd in line', fr: 'Position : 3e en file', ar: 'الموقع: الثالث في الطابور' },
    { en: 'Estimated wait: ~12 min', fr: 'Attente estimee : ~12 min', ar: 'الانتظار المقدر: ~12 دقيقة' },
  ]},
  { from: 'bot', delay: 3500, lines: [
    { en: 'Update: You moved to position 2', fr: 'Mise a jour : Vous etes maintenant 2e', ar: 'تحديث: انتقلت للموقع الثاني' },
    { en: '~5 min remaining', fr: '~5 min restantes', ar: '~5 دقائق متبقية' },
  ]},
  { from: 'bot', delay: 5500, lines: [
    { en: 'Almost there! You are next.', fr: 'Presque ! Vous etes le prochain.', ar: 'اقتربت! انت التالي.' },
  ]},
  { from: 'bot', delay: 7200, highlight: true, lines: [
    { en: "IT'S YOUR TURN!", fr: 'C\'EST VOTRE TOUR !', ar: 'حان دورك!' },
    { en: 'Please go to Desk 3', fr: 'Veuillez vous presenter au Guichet 3', ar: 'يرجى التوجه الى الشباك 3' },
  ]},
  { from: 'bot', delay: 9500, lines: [
    { en: 'Service completed! Duration: 4 min', fr: 'Service termine ! Duree : 4 min', ar: 'تمت الخدمة! المدة: 4 دقائق' },
    { en: 'Thank you for your visit', fr: 'Merci pour votre visite', ar: 'شكرا لزيارتك' },
    { en: 'Rate your experience: ★★★★★', fr: 'Notez votre experience : ★★★★★', ar: 'قيم تجربتك: ★★★★★' },
  ]},
];

const phaseLabels: T3[] = [
  { en: 'Customer joins queue', fr: 'Le client rejoint la file', ar: 'العميل ينضم للطابور' },
  { en: 'Instant ticket received', fr: 'Ticket instantane recu', ar: 'تذكرة فورية' },
  { en: 'Position update', fr: 'Mise a jour position', ar: 'تحديث الموقع' },
  { en: 'Almost there...', fr: 'Presque...', ar: 'اقتربت...' },
  { en: "It's your turn!", fr: 'C\'est votre tour !', ar: 'حان دورك!' },
  { en: 'Service complete', fr: 'Service termine', ar: 'تمت الخدمة' },
];

function AnimatedDemo({ locale }: { locale: string }) {
  const l = locale as L;
  const [visibleCount, setVisibleCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const startDemo = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setVisibleCount(0);
    setDone(false);
    setPlaying(true);
    demoMessages.forEach((msg, i) => {
      const t = setTimeout(() => {
        setVisibleCount(i + 1);
        if (i === demoMessages.length - 1) {
          setTimeout(() => { setDone(true); setPlaying(false); }, 2000);
        }
      }, msg.delay);
      timersRef.current.push(t);
    });
  }, []);

  const restart = useCallback(() => {
    startedRef.current = true;
    startDemo();
  }, [startDemo]);

  // Auto-start when scrolled into view
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !startedRef.current) {
          startedRef.current = true;
          startDemo();
        }
      },
      { threshold: 0.4 }
    );
    observerRef.current.observe(el);
    return () => {
      observerRef.current?.disconnect();
      timersRef.current.forEach(clearTimeout);
    };
  }, [startDemo]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    const chat = containerRef.current?.querySelector('[data-chat]');
    if (chat) chat.scrollTop = chat.scrollHeight;
  }, [visibleCount]);

  const currentPhase = Math.min(visibleCount, phaseLabels.length) - 1;

  return (
    <div ref={containerRef} className="mx-auto max-w-md">
      {/* Phone frame */}
      <div className="rounded-[32px] border-[3px] border-gray-800 bg-gray-900 p-1.5 shadow-2xl">
        {/* Notch */}
        <div className="mx-auto mb-1 h-5 w-24 rounded-b-2xl bg-gray-800" />
        {/* Screen */}
        <div className="rounded-[24px] overflow-hidden bg-[#ece5dd]">
          {/* WhatsApp header */}
          <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3">
            <div className="h-8 w-8 rounded-full bg-[#25d366] flex items-center justify-center">
              <MessageCircle className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">Qflo</div>
              <div className="text-[10px] text-white/70">online</div>
            </div>
          </div>
          {/* Chat area */}
          <div data-chat className="h-[340px] overflow-y-auto px-3 py-3 space-y-2 scroll-smooth">
            {!playing && visibleCount === 0 && (
              <div className="flex items-center justify-center h-full">
                <button
                  onClick={restart}
                  className="flex items-center gap-2 rounded-full bg-[#25d366] px-6 py-3 text-sm font-bold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl"
                >
                  <Play className="h-4 w-4" />
                  {t3(l, { en: 'Watch demo', fr: 'Voir la demo', ar: 'شاهد العرض' })}
                </button>
              </div>
            )}
            {demoMessages.slice(0, visibleCount).map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'} animate-[fadeSlideUp_0.4s_ease-out]`}
              >
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[12px] leading-relaxed shadow-sm ${
                  msg.highlight
                    ? 'bg-[#25d366] text-white'
                    : msg.from === 'user'
                    ? 'bg-[#dcf8c6] text-gray-800'
                    : 'bg-white text-gray-800'
                }`}>
                  {msg.lines.map((line, j) => (
                    <div key={j} className={j === 0 && msg.highlight ? 'font-black text-sm' : j === 0 ? 'font-bold' : ''}>
                      {line[l] || line.en}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {playing && visibleCount < demoMessages.length && (
              <div className="flex justify-start">
                <div className="rounded-xl bg-white px-4 py-2 shadow-sm">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Phase indicator + progress */}
      <div className="mt-6 text-center">
        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 mb-3">
          {phaseLabels.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i <= currentPhase ? 'w-6 bg-[#25d366]' : 'w-1.5 bg-gray-300'
              }`}
            />
          ))}
        </div>
        {/* Phase label */}
        <div className="h-6">
          {currentPhase >= 0 && (
            <p className="text-sm font-semibold text-muted-foreground animate-[fadeSlideUp_0.3s_ease-out]">
              {phaseLabels[currentPhase][l] || phaseLabels[currentPhase].en}
            </p>
          )}
        </div>
        {/* Replay button */}
        {done && (
          <button
            onClick={restart}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-4 py-2 text-xs font-semibold text-muted-foreground transition-all hover:bg-muted-foreground/10"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t3(l, { en: 'Replay', fr: 'Rejouer', ar: 'اعادة' })}
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════ */
/*  DATA                                            */
/* ═══════════════════════════════════════════════ */

const setupSteps = [
  {
    icon: Settings,
    title: { en: 'Create account & configure', fr: 'Creez votre compte & configurez', ar: 'انشئ حسابك وقم بالتهيئة' },
    desc: {
      en: 'Sign up in 30 seconds. Configure your departments, services, desks, business hours, and priority rules from the admin dashboard.',
      fr: 'Inscription en 30 secondes. Configurez vos departements, services, guichets, horaires et regles de priorite depuis le tableau de bord admin.',
      ar: 'التسجيل في 30 ثانية. قم بتهيئة الاقسام والخدمات والشبابيك وساعات العمل وقواعد الاولوية من لوحة الادارة.',
    },
    details: {
      en: ['Industry templates (clinic, bank, retail, etc.)', 'Custom intake forms per service', 'Priority categories (elderly, VIP, etc.)'],
      fr: ['Modeles par secteur (clinique, banque, commerce...)', 'Formulaires personnalises par service', 'Categories de priorite (personnes agees, VIP...)'],
      ar: ['قوالب حسب القطاع (عيادة، بنك، تجارة...)', 'نماذج مخصصة لكل خدمة', 'فئات الاولوية (كبار السن، VIP...)'],
    },
  },
  {
    icon: Smartphone,
    title: { en: 'Connect WhatsApp', fr: 'Connectez WhatsApp', ar: 'اربط واتساب' },
    desc: {
      en: 'Your customers message the Qflo WhatsApp number with your unique business code. Enable WhatsApp in your Qflo admin settings — that\'s it. Qflo handles everything: message routing, ticket creation, notifications. No separate WhatsApp account needed from you.',
      fr: 'Vos clients envoient un message au numero WhatsApp Qflo avec votre code unique. Activez WhatsApp dans vos parametres admin Qflo — c\'est tout. Qflo gere tout : routage des messages, creation de tickets, notifications. Aucun compte WhatsApp separe requis de votre part.',
      ar: 'عملاؤك يراسلون رقم واتساب Qflo برمز مؤسستك الفريد. فعل واتساب في اعدادات Qflo — هذا كل شيء. Qflo يتكفل بكل شيء: توجيه الرسائل، انشاء التذاكر، الاشعارات. لا حاجة لحساب واتساب منفصل.',
    },
    details: {
      en: ['No app for customers to download — WhatsApp is already on 90% of Algerian phones', 'Customers send simple commands: REJOINDRE or RESERVER + your business code', 'Same-day queue AND future appointment booking via WhatsApp'],
      fr: ['Aucune application a telecharger — WhatsApp est deja sur 90% des telephones algeriens', 'Les clients envoient des commandes simples : REJOINDRE ou RESERVER + votre code', 'File d\'attente immediate ET prise de rendez-vous futur via WhatsApp'],
      ar: ['لا تطبيق لتحميله — واتساب موجود على 90% من هواتف الجزائريين', 'العملاء يرسلون اوامر بسيطة: REJOINDRE او RESERVER + رمز مؤسستك', 'طابور فوري وحجز مواعيد مستقبلية عبر واتساب'],
    },
  },
  {
    icon: MessageCircle,
    title: { en: 'Connect Messenger (optional)', fr: 'Connectez Messenger (optionnel)', ar: 'اربط ماسنجر (اختياري)' },
    desc: {
      en: 'Link your Facebook page to Qflo. Enable Messenger in settings, paste your Page ID and verification code. Customers can message your Facebook page with the same commands to join queues or book appointments.',
      fr: 'Liez votre page Facebook a Qflo. Activez Messenger dans les parametres, collez votre Page ID et code de verification. Les clients peuvent ecrire a votre page Facebook avec les memes commandes pour rejoindre une file ou prendre rendez-vous.',
      ar: 'اربط صفحتك على فيسبوك بـ Qflo. فعل ماسنجر في الاعدادات، الصق معرف الصفحة ورمز التحقق. يمكن للعملاء مراسلة صفحتك بنفس الاوامر للانضمام للطابور او حجز موعد.',
    },
    details: {
      en: ['Same REJOINDRE / RESERVER commands as WhatsApp', 'Reach customers who prefer Facebook over WhatsApp', 'All channels feed into the same queue'],
      fr: ['Memes commandes REJOINDRE / RESERVER que WhatsApp', 'Touchez les clients qui preferent Facebook a WhatsApp', 'Tous les canaux alimentent la meme file'],
      ar: ['نفس اوامر REJOINDRE / RESERVER كما في واتساب', 'تواصل مع العملاء الذين يفضلون فيسبوك', 'كل القنوات تصب في نفس الطابور'],
    },
  },
  {
    icon: Share2,
    title: { en: 'Share access points', fr: 'Partagez les points d\'acces', ar: 'شارك نقاط الوصول' },
    desc: {
      en: 'Print QR codes for your entrance, share web links on social media, set up a kiosk tablet for walk-ins, and connect a TV display for the waiting room.',
      fr: 'Imprimez des QR codes pour votre entree, partagez des liens web sur les reseaux sociaux, installez une tablette kiosque pour les clients sur place, et connectez un ecran TV pour la salle d\'attente.',
      ar: 'اطبع رموز QR لمدخلك، شارك روابط الويب على مواقع التواصل، جهز كشك لوحي للعملاء المباشرين، واربط شاشة TV لغرفة الانتظار.',
    },
    details: {
      en: ['QR code scan — no app download needed', 'Web link works on any browser', 'Kiosk mode for self-service tablet'],
      fr: ['Scan QR code — aucune app a telecharger', 'Lien web fonctionne sur tout navigateur', 'Mode kiosque pour tablette en libre-service'],
      ar: ['مسح رمز QR — لا حاجة لتحميل تطبيق', 'رابط ويب يعمل على اي متصفح', 'وضع كشك للوحي بالخدمة الذاتية'],
    },
  },
];

const customerSteps = [
  {
    emoji: '1',
    title: { en: 'Join the queue', fr: 'Rejoindre la file', ar: 'الانضمام للطابور' },
    wa: { en: 'REJOINDRE CLINIQUE-CENTRE', fr: 'REJOINDRE CLINIQUE-CENTRE', ar: 'REJOINDRE CLINIQUE-CENTRE' },
    result: {
      en: 'Instant ticket: "Welcome! You are A-12, position 3, ~15 min wait"',
      fr: 'Ticket instantane : "Bienvenue ! Vous etes A-12, position 3, ~15 min d\'attente"',
      ar: 'تذكرة فورية: "مرحبا! رقمك A-12، الموقع 3، ~15 دقيقة انتظار"',
    },
  },
  {
    emoji: '2',
    title: { en: 'Book an appointment', fr: 'Reserver un rendez-vous', ar: 'حجز موعد' },
    wa: { en: 'RESERVER CLINIQUE-CENTRE', fr: 'RESERVER CLINIQUE-CENTRE', ar: 'RESERVER CLINIQUE-CENTRE' },
    result: {
      en: 'Pick a date & time from available slots. Confirmed instantly + reminder 1h before.',
      fr: 'Choisissez date et heure parmi les creneaux disponibles. Confirme instantanement + rappel 1h avant.',
      ar: 'اختر التاريخ والوقت من الاوقات المتاحة. تاكيد فوري + تذكير قبل ساعة.',
    },
  },
  {
    emoji: '3',
    title: { en: 'Track your position', fr: 'Suivez votre position', ar: 'تتبع موقعك' },
    wa: null,
    result: {
      en: 'Real-time WhatsApp updates: "You moved to position 1! ~3 min"',
      fr: 'Mises a jour WhatsApp en temps reel : "Vous etes 1er ! ~3 min"',
      ar: 'تحديثات واتساب فورية: "انت الاول الان! ~3 دقائق"',
    },
  },
  {
    emoji: '4',
    title: { en: 'Get called', fr: 'Etre appele', ar: 'يتم استدعاؤك' },
    wa: null,
    result: {
      en: '"IT\'S YOUR TURN! Go to Desk 3" — notification on your phone',
      fr: '"C\'EST VOTRE TOUR ! Rendez-vous au Guichet 3" — notification sur votre telephone',
      ar: '"حان دورك! توجه الى الشباك 3" — اشعار على هاتفك',
    },
  },
];

const operatorFeatures = [
  { icon: Users, title: { en: 'Call next / mark served', fr: 'Appeler suivant / marquer servi', ar: 'استدعاء التالي / تحديد كمخدوم' } },
  { icon: ArrowRight, title: { en: 'Transfer between desks', fr: 'Transferer entre guichets', ar: 'تحويل بين الشبابيك' } },
  { icon: Monitor, title: { en: 'Web portal or desktop Station app', fr: 'Portail web ou application Station', ar: 'بوابة ويب او تطبيق Station' } },
  { icon: WifiOff, title: { en: 'Offline mode with auto-sync', fr: 'Mode hors ligne avec sync auto', ar: 'وضع عدم الاتصال مع مزامنة تلقائية' } },
];

const extraChannels = [
  {
    icon: Tablet,
    title: { en: 'Kiosk', fr: 'Kiosque', ar: 'كشك' },
    desc: { en: 'Self-service tablet for walk-in customers. Local or remote web kiosk mode.', fr: 'Tablette en libre-service pour les clients sur place. Mode kiosque local ou web distant.', ar: 'لوحي بالخدمة الذاتية للعملاء المباشرين. وضع كشك محلي او ويب.' },
  },
  {
    icon: Tv,
    title: { en: 'TV Display', fr: 'Ecran TV', ar: 'شاشة TV' },
    desc: { en: 'Real-time queue board on any screen. 3 layouts, dark/light themes.', fr: 'Tableau de file en temps reel sur n\'importe quel ecran. 3 mises en page, themes clair/sombre.', ar: 'لوحة طابور فورية على اي شاشة. 3 تصاميم، وضع ليلي/نهاري.' },
  },
  {
    icon: ScanLine,
    title: { en: 'QR Codes', fr: 'Codes QR', ar: 'رموز QR' },
    desc: { en: 'Print and place at entrance. Customers scan to join — no app needed.', fr: 'Imprimez et placez a l\'entree. Les clients scannent pour rejoindre — aucune app requise.', ar: 'اطبع وضع عند المدخل. العملاء يمسحون للانضمام — لا تطبيق مطلوب.' },
  },
];

/* ═══════════════════════════════════════════════ */
/*  PAGE                                            */
/* ═══════════════════════════════════════════════ */

export default function HowItWorksPage() {
  const { locale } = useI18n();
  const l = (locale || 'en') as L;
  const _ = (obj: T3) => t3(l, obj);

  return (
    <>
      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-blue-600 to-blue-800 py-20 md:py-28">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.08),transparent_50%)]" />
        <div className="mx-auto max-w-4xl px-6 text-center relative">
          <span className="inline-block rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-white/90 backdrop-blur mb-6">
            {_({ en: 'How It Works', fr: 'Comment ca marche', ar: 'كيف يعمل' })}
          </span>
          <h1 className="text-4xl font-extrabold tracking-tight text-white md:text-5xl lg:text-6xl">
            {_({ en: 'How Qflo Works', fr: 'Comment fonctionne Qflo', ar: 'كيف يعمل Qflo' })}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-white/80 leading-relaxed">
            {_({
              en: 'Transform your queue management with WhatsApp & Messenger. Your customers join the queue or book appointments by sending a simple message. No app to download.',
              fr: 'Transformez votre gestion de file d\'attente avec WhatsApp & Messenger. Vos clients rejoignent la file ou reservent un rendez-vous en envoyant un simple message. Aucune app a telecharger.',
              ar: 'حول ادارة طوابيرك مع واتساب وماسنجر. عملاؤك ينضمون للطابور او يحجزون مواعيد بارسال رسالة بسيطة. لا تطبيق للتحميل.',
            })}
          </p>
        </div>
      </section>

      {/* ─── ANIMATED DEMO ─── */}
      <section className="py-20 md:py-28 border-b border-border">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center mb-12">
            <span className="inline-block rounded-full bg-[#25d366]/10 px-4 py-1.5 text-sm font-semibold text-[#25d366] mb-4">
              <Play className="inline h-3.5 w-3.5 mr-1.5" />
              {_({ en: 'Live Demo', fr: 'Demo en direct', ar: 'عرض مباشر' })}
            </span>
            <h2 className="text-3xl font-bold md:text-4xl">
              {_({ en: 'See it in action', fr: 'Voyez comment ca marche', ar: 'شاهد كيف يعمل' })}
            </h2>
            <p className="mt-4 text-muted-foreground max-w-lg mx-auto">
              {_({
                en: 'A customer joins the queue via WhatsApp — from first message to service completion.',
                fr: 'Un client rejoint la file via WhatsApp — du premier message a la fin du service.',
                ar: 'عميل ينضم للطابور عبر واتساب — من الرسالة الاولى حتى انتهاء الخدمة.',
              })}
            </p>
          </div>
          <AnimatedDemo locale={l} />
        </div>
      </section>

      {/* ─── BUSINESS SETUP ─── */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center mb-16">
            <span className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-sm font-semibold text-primary mb-4">
              {_({ en: 'Business Setup', fr: 'Configuration', ar: 'اعداد المؤسسة' })}
            </span>
            <h2 className="text-3xl font-bold md:text-4xl">
              {_({ en: 'Get started in 4 steps', fr: 'Demarrez en 4 etapes', ar: 'ابدا في 4 خطوات' })}
            </h2>
          </div>

          <div className="space-y-12">
            {setupSteps.map((step, i) => {
              const Icon = step.icon;
              const accent = step.color || '#2563eb';
              return (
                <div key={i} className="relative flex gap-6 md:gap-10">
                  {i < setupSteps.length - 1 && (
                    <div className="absolute left-[27px] top-[68px] h-[calc(100%-20px)] w-0.5 bg-border md:left-[31px]" />
                  )}
                  <div className="shrink-0">
                    <div
                      className="flex h-14 w-14 items-center justify-center rounded-2xl text-white text-lg font-extrabold shadow-lg md:h-16 md:w-16"
                      style={{ backgroundColor: accent }}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </div>
                  </div>
                  <div className="flex-1 pb-4">
                    <h3 className="text-xl font-bold md:text-2xl">{_(step.title)}</h3>
                    <p className="mt-2 text-muted-foreground leading-relaxed">{_(step.desc)}</p>
                    <ul className="mt-4 space-y-2">
                      {step.details[l].map((d: string) => (
                        <li key={d} className="flex items-start gap-2 text-sm">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── CUSTOMER EXPERIENCE ─── */}
      <section className="border-y border-border bg-muted/30 py-20 md:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center mb-16">
            <span className="inline-block rounded-full bg-[#25d366]/10 px-4 py-1.5 text-sm font-semibold text-[#25d366] mb-4">
              {_({ en: 'Customer Experience', fr: 'Experience Client', ar: 'تجربة العميل' })}
            </span>
            <h2 className="text-3xl font-bold md:text-4xl">
              {_({ en: 'What your customers see', fr: 'Ce que voient vos clients', ar: 'ما يراه عملاؤك' })}
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              {_({
                en: 'Everything happens on WhatsApp. No app download, no account creation, no friction.',
                fr: 'Tout se passe sur WhatsApp. Pas d\'application a telecharger, pas de compte a creer, aucune friction.',
                ar: 'كل شيء يحدث على واتساب. لا تحميل تطبيق، لا انشاء حساب، بدون اي تعقيد.',
              })}
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {customerSteps.map((step) => (
              <div key={step.emoji} className="rounded-2xl border border-border bg-card p-6 md:p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#25d366] text-white text-sm font-bold">
                    {step.emoji}
                  </div>
                  <h3 className="text-lg font-bold">{_(step.title)}</h3>
                </div>
                {step.wa && (
                  <div className="mb-3 rounded-xl bg-[#25d366]/5 border border-[#25d366]/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground mb-1">{_({ en: 'Customer sends:', fr: 'Le client envoie :', ar: 'العميل يرسل:' })}</p>
                    <p className="font-mono text-sm font-bold text-[#25d366]">{_(step.wa)}</p>
                  </div>
                )}
                <p className="text-sm text-muted-foreground leading-relaxed">{_(step.result)}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl bg-gradient-to-r from-[#25d366]/5 via-[#0084ff]/5 to-primary/5 border border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {_({
                en: 'Also works via Messenger (same commands on your Facebook page), QR code scan, and web link — all channels feed into the same queue.',
                fr: 'Fonctionne aussi via Messenger (memes commandes sur votre page Facebook), scan QR code et lien web — tous les canaux alimentent la meme file.',
                ar: 'يعمل ايضا عبر ماسنجر (نفس الاوامر على صفحتك فيسبوك)، مسح QR ورابط ويب — كل القنوات تصب في نفس الطابور.',
              })}
            </p>
          </div>
        </div>
      </section>

      {/* ─── OPERATOR DASHBOARD ─── */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center mb-16">
            <span className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-sm font-semibold text-primary mb-4">
              {_({ en: 'Operator Dashboard', fr: 'Tableau de bord Operateur', ar: 'لوحة تحكم الموظف' })}
            </span>
            <h2 className="text-3xl font-bold md:text-4xl">
              {_({ en: 'Manage your queue effortlessly', fr: 'Gerez votre file sans effort', ar: 'ادر طابورك بسهولة' })}
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {operatorFeatures.map((f, i) => {
              const Icon = f.icon;
              return (
                <div key={i} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="font-medium">{_(f.title)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── EXTRA CHANNELS ─── */}
      <section className="border-y border-border bg-muted/20 py-20 md:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold md:text-4xl">
              {_({ en: 'More ways to connect', fr: 'Plus de facons de connecter', ar: 'طرق اخرى للتواصل' })}
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {extraChannels.map((ch, i) => {
              const Icon = ch.icon;
              return (
                <div key={i} className="rounded-2xl border border-border bg-card p-8 text-center">
                  <div className="mx-auto mb-4 inline-flex rounded-xl bg-primary/10 p-3 text-primary">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold">{_(ch.title)}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{_(ch.desc)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="bg-primary py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold text-primary-foreground">
            {_({ en: 'Ready to transform your queues?', fr: 'Pret a transformer vos files d\'attente ?', ar: 'مستعد لتحويل طوابيرك؟' })}
          </h2>
          <p className="mt-4 text-lg text-primary-foreground/80">
            {_({
              en: 'Join businesses across Algeria already using Qflo with WhatsApp.',
              fr: 'Rejoignez les entreprises a travers l\'Algerie qui utilisent deja Qflo avec WhatsApp.',
              ar: 'انضم للمؤسسات عبر الجزائر التي تستخدم Qflo مع واتساب.',
            })}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-semibold text-primary shadow-lg transition-all hover:shadow-xl"
            >
              {_({ en: 'Contact Us', fr: 'Contactez-nous', ar: 'تواصل معنا' })}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-xl border-2 border-white/30 px-8 py-4 text-base font-semibold text-white transition-all hover:bg-white/10"
            >
              {_({ en: 'View Pricing', fr: 'Voir les tarifs', ar: 'عرض الاسعار' })}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
