import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  fetchKioskInfo,
  fetchBookingSlots,
  createBooking,
  type KioskInfoResponse,
} from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { useTheme, borderRadius, fontSize, spacing } from '@/lib/theme';

type Step = 'loading' | 'department' | 'service' | 'date' | 'time' | 'info' | 'confirm' | 'success' | 'error';

function nextNDays(n: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

function formatDate(dateStr: string, t?: (key: string) => string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  if (dateStr === today) return t ? t('bookAppointment.today') : 'Today';
  if (dateStr === tomorrow) return t ? t('bookAppointment.tomorrow') : 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(slot: string): string {
  const [h, m] = slot.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m === 0 ? '00' : m} ${ampm}`;
}

export default function BookAppointmentScreen() {
  const { t } = useTranslation();
  const { slug, deptId: initialDeptId, serviceId: initialServiceId } =
    useLocalSearchParams<{ slug: string; deptId?: string; serviceId?: string }>();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { customerName: savedName, customerPhone: savedPhone, setCustomerInfo, addAppointment } = useAppStore();
  const [notes, setNotes] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const timeSlotsY = useRef(0);

  const [step, setStep] = useState<Step>('loading');
  const [info, setInfo] = useState<KioskInfoResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Selections
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');

  // Available slots
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  // Customer info — pre-fills from saved profile (Zustand persist rehydrates
  // asynchronously, so we also watch for changes after mount).
  const [name, setName] = useState(savedName);
  const [phone, setPhone] = useState(savedPhone);
  useEffect(() => {
    if (savedName && !name) setName(savedName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedName]);
  useEffect(() => {
    if (savedPhone && !phone) setPhone(savedPhone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPhone]);

  // Result
  const [appointmentId, setAppointmentId] = useState('');
  const [confirmedAt, setConfirmedAt] = useState('');

  const horizonDays = info?.settings?.booking_horizon_days ?? 90;
  const availableDates = nextNDays(horizonDays);

  const loadInfo = useCallback(async () => {
    if (!slug) return;
    setStep('loading');
    const data = await fetchKioskInfo(slug);
    if (!data) {
      setErrorMsg(t('bookAppointment.businessNotFound'));
      setStep('error');
      return;
    }
    if (data.settings?.booking_mode === 'disabled') {
      setErrorMsg(t('bookAppointment.bookingDisabled'));
      setStep('error');
      return;
    }
    setInfo(data);
    // Pre-select dept if provided
    if (initialDeptId && data.departments.some((d) => d.id === initialDeptId)) {
      setSelectedDeptId(initialDeptId);
      if (initialServiceId && data.services.some((s) => s.id === initialServiceId && s.department_id === initialDeptId)) {
        setSelectedServiceId(initialServiceId);
        setStep('date');
      } else {
        setStep('service');
      }
    } else {
      setStep('department');
    }
  }, [slug, initialDeptId, initialServiceId]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const loadSlots = useCallback(async (date: string) => {
    if (!slug || !selectedServiceId) return;
    setSlotsLoading(true);
    setSlots([]);
    const result = await fetchBookingSlots(slug, selectedServiceId, date);
    setSlotsLoading(false);
    setSlots(result?.slots ?? []);
    // Auto-scroll to time slots after loading
    setTimeout(() => {
      if (timeSlotsY.current > 0) {
        scrollRef.current?.scrollTo({ y: timeSlotsY.current - 20, animated: true });
      }
    }, 100);
  }, [slug, selectedServiceId]);

  useEffect(() => {
    if (step === 'date' && selectedDate) {
      loadSlots(selectedDate);
    }
  }, [step, selectedDate, loadSlots]);

  const handleSelectDept = (id: string) => {
    Haptics.selectionAsync();
    setSelectedDeptId(id);
    setSelectedServiceId('');
    setStep('service');
  };

  const handleSelectService = (id: string) => {
    Haptics.selectionAsync();
    setSelectedServiceId(id);
    setStep('date');
  };

  const handleSelectDate = (date: string) => {
    Haptics.selectionAsync();
    setSelectedDate(date);
    setSelectedSlot('');
    // Stay on 'date' step — slots load inline below the calendar
  };

  const handleSelectSlot = (slot: string) => {
    Haptics.selectionAsync();
    setSelectedSlot(slot);
    setStep('info');
  };

  const handleSubmitInfo = () => {
    if (!name.trim()) return;
    setCustomerInfo(name.trim(), phone.trim());
    setStep('confirm');
  };

  const handleConfirm = async () => {
    if (!info || !selectedDeptId || !selectedServiceId || !selectedDate || !selectedSlot) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const scheduledAt = `${selectedDate}T${selectedSlot}:00`;

    const result = await createBooking({
      officeId: info.office.id,
      departmentId: selectedDeptId,
      serviceId: selectedServiceId,
      customerName: name.trim(),
      customerPhone: phone.trim() || undefined,
      scheduledAt,
      notes: notes.trim() || undefined,
    });

    if ('error' in result) {
      setErrorMsg(result.error);
      setStep('error');
      return;
    }

    setAppointmentId(result.appointment.id);
    setConfirmedAt(result.appointment.scheduled_at);

    // Stash token + meta locally so the "My appointments" screen can list,
    // refresh, cancel and check in without any login.
    if (result.appointment.calendar_token) {
      addAppointment({
        id: result.appointment.id,
        calendarToken: result.appointment.calendar_token,
        officeId: result.appointment.office_id,
        placeId: result.appointment.office_id,
        kioskSlug: typeof slug === 'string' ? slug : null,
        businessName: info.office.name,
        serviceName: service?.name ?? null,
        departmentName: dept?.name ?? null,
        scheduledAt: result.appointment.scheduled_at,
        status: result.appointment.status,
        lastSyncedAt: new Date().toISOString(),
      });
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('success');
  };

  const dept = info?.departments.find((d) => d.id === selectedDeptId);
  const service = info?.services.find((s) => s.id === selectedServiceId);
  const deptServices = info?.services.filter((s) => s.department_id === selectedDeptId) ?? [];

  // ---- LOADING ----
  if (step === 'loading') {
    return (
      <View style={[s.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ---- ERROR ----
  if (step === 'error') {
    return (
      <View style={[s.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={[s.iconCircle, { backgroundColor: colors.error + '18' }]}>
          <Ionicons name="alert-circle-outline" size={44} color={colors.error} />
        </View>
        <Text style={[s.errorTitle, { color: colors.text }]}>{t('bookAppointment.bookingUnavailable')}</Text>
        <Text style={[s.errorSub, { color: colors.textSecondary }]}>{errorMsg}</Text>
        <TouchableOpacity style={[s.outlineBtn, { borderColor: colors.border }]} onPress={() => router.back()}>
          <Text style={[s.outlineBtnText, { color: colors.textSecondary }]}>{t('bookAppointment.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---- SUCCESS ----
  if (step === 'success') {
    const d = new Date(confirmedAt);
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={[s.content, { paddingTop: insets.top + spacing.md }]}>
        <View style={[s.successCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
          <View style={[s.iconCircle, { backgroundColor: colors.success + '18' }]}>
            <Ionicons name="checkmark-circle" size={56} color={colors.success} />
          </View>
          <Text style={[s.successTitle, { color: colors.text }]}>{t('bookAppointment.appointmentBooked')}</Text>
          <Text style={[s.successSub, { color: colors.textSecondary }]}>
            {t('bookAppointment.appointmentConfirmed')}
          </Text>

          <View style={[s.summaryBlock, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderLight }]}>
            <Row label={t('bookAppointment.business')} value={info?.office.name ?? ''} colors={colors} />
            <Row label={t('bookAppointment.service')} value={service?.name ?? ''} colors={colors} />
            <Row label={t('bookAppointment.date')} value={formatDate(selectedDate, t)} colors={colors} />
            <Row label={t('bookAppointment.time')} value={formatTime(selectedSlot)} colors={colors} />
            <Row label={t('bookAppointment.name')} value={name} colors={colors} />
          </View>
        </View>

        <TouchableOpacity
          style={[s.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.replace('/' as any)}
          activeOpacity={0.8}
        >
          <Text style={s.primaryBtnText}>{t('common.done')}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView ref={scrollRef} contentContainerStyle={[s.content, { paddingTop: insets.top + spacing.md }]} keyboardShouldPersistTaps="handled">
        {/* Back row */}
        <TouchableOpacity style={s.backRow} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color={colors.primary} />
          <Text style={[s.backText, { color: colors.primary }]}>{t('common.back')}</Text>
        </TouchableOpacity>

        {/* Header */}
        <View style={s.header}>
          <View style={[s.headerIcon, { backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : colors.infoLight }]}>
            <Ionicons name="calendar-outline" size={26} color={colors.primary} />
          </View>
          <Text style={[s.pageTitle, { color: colors.text }]}>{t('bookAppointment.bookAppointment')}</Text>
          {info && <Text style={[s.pageSub, { color: colors.textSecondary }]}>{info.office.name}</Text>}
        </View>

        {/* Progress */}
        <StepProgress step={step} colors={colors} />

        {/* ---- DEPARTMENT ---- */}
        {step === 'department' && (
          <View>
            <Text style={[s.sectionTitle, { color: colors.text }]}>{t('bookAppointment.selectDepartment')}</Text>
            {info?.departments.map((dept) => (
              <TouchableOpacity
                key={dept.id}
                style={[s.choiceCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
                onPress={() => handleSelectDept(dept.id)}
                activeOpacity={0.75}
              >
                <View style={[s.choiceIcon, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name="people-outline" size={20} color={colors.primary} />
                </View>
                <Text style={[s.choiceName, { color: colors.text }]}>{dept.name}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ---- SERVICE ---- */}
        {step === 'service' && (
          <View>
            <Text style={[s.sectionTitle, { color: colors.text }]}>{t('bookAppointment.selectService')}</Text>
            <Text style={[s.sectionSub, { color: colors.textSecondary }]}>{dept?.name}</Text>
            {deptServices.map((svc) => (
              <TouchableOpacity
                key={svc.id}
                style={[s.choiceCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
                onPress={() => handleSelectService(svc.id)}
                activeOpacity={0.75}
              >
                <View style={[s.choiceIcon, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name="clipboard-outline" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.choiceName, { color: colors.text }]}>{svc.name}</Text>
                  {svc.description ? (
                    <Text style={[s.choiceDesc, { color: colors.textSecondary }]} numberOfLines={1}>
                      {svc.description}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.backLink} onPress={() => setStep('department')}>
              <Text style={[s.backLinkText, { color: colors.textSecondary }]}>{t('bookAppointment.changeDepartment')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ---- DATE ---- */}
        {/* ---- DATE & TIME (combined) ---- */}
        {step === 'date' && (
          <View>
            <Text style={[s.sectionTitle, { color: colors.text }]}>{t('bookAppointment.selectDateTime')}</Text>
            <Text style={[s.sectionSub, { color: colors.textSecondary }]}>
              {service?.name} · {dept?.name}
            </Text>
            <MiniCalendar
              availableDates={availableDates}
              selectedDate={selectedDate}
              onSelect={handleSelectDate}
              colors={colors}
              isDark={isDark}
            />

            {/* Time slots appear inline after selecting a date */}
            {selectedDate ? (
              <View style={{ marginTop: spacing.md }} onLayout={(e) => { timeSlotsY.current = e.nativeEvent.layout.y; }}>
                <Text style={[s.timeSectionLabel, { color: colors.text }]}>
                  <Ionicons name="time-outline" size={16} color={colors.primary} />
                  {'  '}{t('bookAppointment.availableTimesFor', { date: formatDate(selectedDate, t) })}
                </Text>
                {slotsLoading ? (
                  <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg, marginBottom: spacing.md }} />
                ) : slots.length === 0 ? (
                  <View style={[s.emptySlots, { borderColor: colors.borderLight }]}>
                    <Ionicons name="calendar-clear-outline" size={32} color={colors.textMuted} />
                    <Text style={[s.emptySlotsText, { color: colors.textSecondary }]}>
                      {t('bookAppointment.noSlotsOnDay')}
                    </Text>
                  </View>
                ) : (
                  <View style={s.slotsGrid}>
                    {slots.map((slot) => (
                      <TouchableOpacity
                        key={slot}
                        style={[
                          s.slotChip,
                          { backgroundColor: colors.surface, borderColor: colors.borderLight },
                          selectedSlot === slot && { backgroundColor: colors.primary, borderColor: colors.primary },
                        ]}
                        onPress={() => handleSelectSlot(slot)}
                        activeOpacity={0.75}
                      >
                        <Text style={[s.slotText, { color: selectedSlot === slot ? '#fff' : colors.text }]}>
                          {formatTime(slot)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <View style={[s.pickDateHint, { borderColor: colors.borderLight }]}>
                <Ionicons name="hand-left-outline" size={22} color={colors.textMuted} />
                <Text style={[s.pickDateHintText, { color: colors.textSecondary }]}>
                  {t('bookAppointment.tapDateToSeeTimes')}
                </Text>
              </View>
            )}

            <TouchableOpacity style={s.backLink} onPress={() => setStep('service')}>
              <Text style={[s.backLinkText, { color: colors.textSecondary }]}>{t('bookAppointment.changeService')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ---- CUSTOMER INFO ---- */}
        {step === 'info' && (
          <View>
            <Text style={[s.sectionTitle, { color: colors.text }]}>{t('bookAppointment.yourDetails')}</Text>
            <Text style={[s.sectionSub, { color: colors.textSecondary }]}>
              {formatDate(selectedDate, t)} · {formatTime(selectedSlot)}
            </Text>

            <Text style={[s.fieldLabel, { color: colors.textSecondary }]}>{t('bookAppointment.fullName')}</Text>
            <TextInput
              style={[
                s.textInput,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
              value={name}
              onChangeText={setName}
              placeholder={t('bookAppointment.fullNamePlaceholder')}
              placeholderTextColor={colors.textMuted}
              autoFocus
              returnKeyType="next"
            />

            <Text style={[s.fieldLabel, { color: colors.textSecondary }]}>{t('bookAppointment.phoneOptional')}</Text>
            <TextInput
              style={[
                s.textInput,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('bookAppointment.phonePlaceholder')}
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              returnKeyType="next"
            />

            <Text style={[s.fieldLabel, { color: colors.textSecondary }]}>{t('bookAppointment.notesOptional')}</Text>
            <TextInput
              style={[
                s.textInput,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text, minHeight: 72, textAlignVertical: 'top' },
              ]}
              value={notes}
              onChangeText={setNotes}
              placeholder={t('bookAppointment.notesPlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
              returnKeyType="done"
            />

            <TouchableOpacity
              style={[
                s.primaryBtn,
                { backgroundColor: name.trim() ? colors.primary : colors.border },
                { marginTop: spacing.lg },
              ]}
              onPress={handleSubmitInfo}
              disabled={!name.trim()}
              activeOpacity={0.8}
            >
              <Text style={[s.primaryBtnText, { color: name.trim() ? '#fff' : colors.textMuted }]}>
                {t('bookAppointment.reviewBooking')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ---- CONFIRM ---- */}
        {step === 'confirm' && (
          <View>
            <Text style={[s.sectionTitle, { color: colors.text }]}>{t('bookAppointment.confirmBooking')}</Text>

            <View style={[s.summaryBlock, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
              <Row label={t('bookAppointment.business')} value={info?.office.name ?? ''} colors={colors} />
              <Row label={t('bookAppointment.department')} value={dept?.name ?? ''} colors={colors} />
              <Row label={t('bookAppointment.service')} value={service?.name ?? ''} colors={colors} />
              <Row label={t('bookAppointment.date')} value={formatDate(selectedDate, t)} colors={colors} />
              <Row label={t('bookAppointment.time')} value={formatTime(selectedSlot)} colors={colors} />
              <Row label={t('bookAppointment.name')} value={name} colors={colors} />
              {phone ? <Row label={t('bookAppointment.phone')} value={phone} colors={colors} /> : null}
              {notes.trim() ? <Row label={t('bookAppointment.notes')} value={notes.trim()} colors={colors} /> : null}
            </View>

            <TouchableOpacity
              style={[s.primaryBtn, { backgroundColor: colors.primary, marginTop: spacing.lg }]}
              onPress={handleConfirm}
              activeOpacity={0.8}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
              <Text style={[s.primaryBtnText, { marginLeft: 6 }]}>{t('bookAppointment.confirmAppointment')}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.backLink} onPress={() => setStep('info')}>
              <Text style={[s.backLinkText, { color: colors.textSecondary }]}>{t('bookAppointment.editDetails')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ---- Mini Calendar Component ---- */
function MiniCalendar({
  availableDates,
  selectedDate,
  onSelect,
  colors,
  isDark,
}: {
  availableDates: string[];
  selectedDate: string;
  onSelect: (date: string) => void;
  colors: ReturnType<typeof useTheme>['colors'];
  isDark: boolean;
}) {
  const { t } = useTranslation();
  const availableSet = new Set(availableDates);
  const todayStr = new Date().toISOString().split('T')[0];

  // Start with the month of the first available date
  const initialMonth = availableDates[0]
    ? new Date(availableDates[0] + 'T12:00:00')
    : new Date();
  const [viewYear, setViewYear] = useState(initialMonth.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialMonth.getMonth());

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  // Use UTC noon to avoid local timezone shifting the day
  const firstDayOfWeek = (() => {
    const dateKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
    return new Date(dateKey + 'T12:00:00Z').getUTCDay(); // 0=Sun
  })();

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  // Can navigate to prev/next only if there are available dates in that month
  const canGoPrev = (() => {
    const pm = viewMonth === 0 ? 11 : viewMonth - 1;
    const py = viewMonth === 0 ? viewYear - 1 : viewYear;
    return availableDates.some((d) => {
      const dt = new Date(d + 'T12:00:00');
      return dt.getFullYear() === py && dt.getMonth() === pm;
    });
  })();

  const canGoNext = (() => {
    const nm = viewMonth === 11 ? 0 : viewMonth + 1;
    const ny = viewMonth === 11 ? viewYear + 1 : viewYear;
    return availableDates.some((d) => {
      const dt = new Date(d + 'T12:00:00');
      return dt.getFullYear() === ny && dt.getMonth() === nm;
    });
  })();

  const goPrev = () => {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  };
  const goNext = () => {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  };

  // Build grid rows (6 weeks max)
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const toDateStr = (day: number) => {
    const mm = String(viewMonth + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${viewYear}-${mm}-${dd}`;
  };

  return (
    <View style={[cs.container, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      {/* Month navigation */}
      <View style={cs.monthHeader}>
        <TouchableOpacity onPress={goPrev} disabled={!canGoPrev} activeOpacity={0.6} style={cs.navBtn}>
          <Ionicons name="chevron-back" size={20} color={canGoPrev ? colors.text : colors.borderLight} />
        </TouchableOpacity>
        <Text style={[cs.monthLabel, { color: colors.text }]}>{monthLabel}</Text>
        <TouchableOpacity onPress={goNext} disabled={!canGoNext} activeOpacity={0.6} style={cs.navBtn}>
          <Ionicons name="chevron-forward" size={20} color={canGoNext ? colors.text : colors.borderLight} />
        </TouchableOpacity>
      </View>

      {/* Weekday headers */}
      <View style={cs.weekRow}>
        {WEEKDAYS.map((wd) => (
          <View key={wd} style={cs.dayCell}>
            <Text style={[cs.weekdayText, { color: colors.textMuted }]}>{wd}</Text>
          </View>
        ))}
      </View>

      {/* Day grid */}
      {weeks.map((week, wi) => (
        <View key={wi} style={cs.weekRow}>
          {week.map((day, di) => {
            if (day === null) {
              return <View key={`e${di}`} style={cs.dayCell} />;
            }
            const dateStr = toDateStr(day);
            const isAvailable = availableSet.has(dateStr);
            const isSelected = dateStr === selectedDate;
            const isToday = dateStr === todayStr;

            return (
              <TouchableOpacity
                key={day}
                style={cs.dayCell}
                disabled={!isAvailable}
                onPress={() => onSelect(dateStr)}
                activeOpacity={0.6}
              >
                <View
                  style={[
                    cs.dayCircle,
                    isSelected && { backgroundColor: colors.primary },
                    isToday && !isSelected && {
                      borderWidth: 2,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      cs.dayText,
                      { color: isSelected ? '#fff' : isAvailable ? colors.text : colors.textMuted + '40' },
                      isToday && !isSelected && { color: colors.primary, fontWeight: '700' },
                      isSelected && { fontWeight: '700' },
                    ]}
                  >
                    {day}
                  </Text>
                </View>
                {isAvailable && !isSelected && (
                  <View style={[cs.availDot, { backgroundColor: colors.success }]} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      {/* Legend */}
      <View style={cs.legend}>
        <View style={cs.legendItem}>
          <View style={[cs.legendDot, { backgroundColor: colors.success }]} />
          <Text style={[cs.legendText, { color: colors.textMuted }]}>{t('bookAppointment.available')}</Text>
        </View>
        <View style={cs.legendItem}>
          <View style={[cs.legendDot, { backgroundColor: colors.primary }]} />
          <Text style={[cs.legendText, { color: colors.textMuted }]}>{t('bookAppointment.selected')}</Text>
        </View>
      </View>
    </View>
  );
}

const cs = StyleSheet.create({
  container: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: 4,
  },
  navBtn: { padding: 6 },
  monthLabel: { fontSize: fontSize.lg, fontWeight: '700' },
  weekRow: { flexDirection: 'row' },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  weekdayText: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { fontSize: fontSize.md, fontWeight: '500' },
  availDot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11 },
});

function Row({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[s.rowValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function StepProgress({
  step,
  colors,
}: {
  step: Step;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const steps: Step[] = ['department', 'service', 'date', 'info', 'confirm'];
  const idx = steps.indexOf(step);
  if (idx < 0) return null;
  return (
    <View style={s.progressRow}>
      {steps.map((s_, i) => (
        <View
          key={s_}
          style={[
            s.progressDot,
            {
              backgroundColor:
                i < idx
                  ? colors.success
                  : i === idx
                  ? colors.primary
                  : colors.borderLight,
            },
          ]}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  errorTitle: { fontSize: fontSize.xl, fontWeight: '700' },
  errorSub: { fontSize: fontSize.md, textAlign: 'center', maxWidth: 280, lineHeight: 22 },
  outlineBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
  },
  outlineBtnText: { fontSize: fontSize.md, fontWeight: '600' },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  backText: { fontSize: fontSize.md, fontWeight: '600' },

  header: { alignItems: 'center', marginBottom: spacing.lg },
  headerIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  pageTitle: { fontSize: fontSize.xl, fontWeight: '800' },
  pageSub: { fontSize: fontSize.sm, marginTop: 2 },

  progressRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: spacing.lg },
  progressDot: { width: 8, height: 8, borderRadius: 4 },

  sectionTitle: { fontSize: fontSize.lg, fontWeight: '700', marginBottom: 2 },
  sectionSub: { fontSize: fontSize.sm, marginBottom: spacing.md },

  choiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  choiceIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  choiceName: { flex: 1, fontSize: fontSize.md, fontWeight: '600' },
  choiceDesc: { fontSize: fontSize.sm, marginTop: 2 },

  backLink: { marginTop: spacing.md, alignItems: 'center' },
  backLinkText: { fontSize: fontSize.sm },

  timeSectionLabel: {
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  pickDateHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.lg,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    borderStyle: 'dashed',
  },
  pickDateHintText: { fontSize: fontSize.md },

  slotsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slotChip: {
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    minWidth: 80,
    alignItems: 'center',
  },
  slotText: { fontSize: fontSize.sm, fontWeight: '600' },

  emptySlots: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  emptySlotsText: { fontSize: fontSize.md, textAlign: 'center' },

  fieldLabel: { fontSize: fontSize.sm, fontWeight: '600', marginBottom: 6, marginTop: spacing.md },
  textInput: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
  },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md + 2,
    borderRadius: borderRadius.lg,
  },
  primaryBtnText: { fontSize: fontSize.lg, fontWeight: '700', color: '#fff' },

  summaryBlock: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  rowLabel: { fontSize: fontSize.sm },
  rowValue: { fontSize: fontSize.sm, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },

  successCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  successTitle: { fontSize: fontSize.xl, fontWeight: '800' },
  successSub: { fontSize: fontSize.md, textAlign: 'center' },
});
