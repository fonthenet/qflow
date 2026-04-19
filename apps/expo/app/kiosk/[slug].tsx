import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  fetchKioskInfo,
  createKioskTicket,
  type KioskInfoResponse,
  type KioskTicketResult,
} from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { useTheme, borderRadius, fontSize, spacing, type ThemeColors } from '@/lib/theme';
import { getEnabledIntakeFields, type IntakeField } from '@qflo/shared';
import { IntakeForm, hasMissingRequired, type IntakeValues } from '@/components/IntakeForm';
import { useKeyboardPadding } from '@/lib/use-keyboard-padding';

type Step = 'loading' | 'home' | 'department' | 'service' | 'priority' | 'intake' | 'issued' | 'error';

const IDLE_TIMEOUT_MS = 60_000;

export default function KioskScreen() {
  const { t } = useTranslation();
  const { slug, deptId: initialDeptId, start: startParam } = useLocalSearchParams<{ slug: string; deptId?: string; start?: string }>();
  const router = useRouter();
  const {
    setActiveToken,
    setActiveKioskSlug,
    recordPlace,
    addToHistory,
    customerName: savedName,
    customerPhone: savedPhone,
    setCustomerInfo,
  } = useAppStore();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const { colors } = useTheme();
  const kbPad = useKeyboardPadding();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [step, setStep] = useState<Step>('loading');
  const [info, setInfo] = useState<KioskInfoResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Selections
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedPriorityId, setSelectedPriorityId] = useState('');
  const [selectedPriorityWeight, setSelectedPriorityWeight] = useState<number | undefined>();

  // Intake form values
  const [intakeValues, setIntakeValues] = useState<IntakeValues>({});

  // Result
  const [ticket, setTicket] = useState<KioskTicketResult['ticket'] | null>(null);

  // Derive enabled intake fields from business settings
  const intakeFields: IntakeField[] = useMemo(
    () => (info ? getEnabledIntakeFields(info.settings ?? {}) : []),
    [info]
  );

  // Prefill name/phone from saved profile when fields load
  useEffect(() => {
    if (!info || intakeFields.length === 0) return;
    setIntakeValues((prev) => {
      const next = { ...prev };
      for (const f of intakeFields) {
        const current = (next[f.key] ?? '').trim();
        if (current) continue;
        if (f.key === 'name' && savedName) next[f.key] = savedName;
        else if (f.key === 'phone' && savedPhone) next[f.key] = savedPhone;
      }
      return next;
    });
  }, [info, intakeFields, savedName, savedPhone]);

  // Idle timeout
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetIdleTimer = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      // Only reset if not on loading/error
      setStep((current) => {
        if (current === 'loading' || current === 'error' || current === 'home') return current;
        resetSelections();
        return 'home';
      });
    }, IDLE_TIMEOUT_MS);
  }, []);

  const touchActivity = useCallback(() => {
    resetIdleTimer();
  }, [resetIdleTimer]);

  useEffect(() => {
    resetIdleTimer();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [resetIdleTimer]);

  const resetSelections = () => {
    setSelectedDeptId('');
    setSelectedServiceId('');
    setSelectedPriorityId('');
    setSelectedPriorityWeight(undefined);
    setTicket(null);
    setErrorMsg('');
    setIntakeValues({});
  };

  // Fetch kiosk info
  const loadInfo = useCallback(async () => {
    if (!slug) return;
    setStep('loading');
    const data = await fetchKioskInfo(slug);
    if (!data) {
      setStep('error');
      setErrorMsg(t('kiosk.unavailableMsg'));
      return;
    }
    setInfo(data);

    // Save this business to Places immediately on first scan
    recordPlace({
      id: data.office.id,
      name: data.office.name,
      address: data.office.address,
      kioskSlug: slug,
      logo_url: data.organization?.logo_url ?? null,
      vertical: (data.settings?.vertical as string | undefined) ?? null,
      services: (data.services ?? []).map((s) => s.name.toLowerCase()),
      bookingMode: (data.settings?.booking_mode as string | undefined) ?? null,
    });

    // If a department was pre-selected (from queue peek), auto-jump to service step
    if (initialDeptId && data.departments.some((d) => d.id === initialDeptId)) {
      setSelectedDeptId(initialDeptId);
      setStep('service');
    } else if (startParam === 'pick') {
      // Coming from queue-peek's "Get a Ticket Now" — skip the welcome screen.
      // If the business only has one department, jump past dept selection too.
      const depts = [...data.departments].sort((a, b) => a.sort_order - b.sort_order);
      if (depts.length === 1) {
        setSelectedDeptId(depts[0].id);
        setStep('service');
      } else {
        setStep('department');
      }
    } else {
      setStep('home');
    }
  }, [slug, initialDeptId, startParam, recordPlace]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  // Derived data
  const departments = info
    ? [...info.departments].sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const servicesForDept = info
    ? [...info.services.filter((s) => s.department_id === selectedDeptId)].sort(
        (a, b) => a.sort_order - b.sort_order
      )
    : [];
  const priorities = info ? info.priorityCategories : [];
  const selectedDept = departments.find((d) => d.id === selectedDeptId);
  const selectedService = info?.services.find((s) => s.id === selectedServiceId);

  // Navigation helpers
  const goHome = () => {
    touchActivity();
    resetSelections();
    setStep('home');
  };

  const goToDepartments = () => {
    touchActivity();
    // If only 1 department, skip to services
    if (departments.length === 1) {
      setSelectedDeptId(departments[0].id);
      setStep('service');
      return;
    }
    setStep('department');
  };

  const selectDepartment = (deptId: string) => {
    touchActivity();
    setSelectedDeptId(deptId);
    setSelectedServiceId('');
    setStep('service');
  };

  const selectService = (serviceId: string) => {
    touchActivity();
    setSelectedServiceId(serviceId);
    if (priorities.length > 0) {
      setStep('priority');
    } else if (intakeFields.length > 0) {
      setStep('intake');
    } else {
      issueTicket(serviceId);
    }
  };

  const selectPriority = (priorityId: string, weight: number) => {
    touchActivity();
    setSelectedPriorityId(priorityId);
    setSelectedPriorityWeight(weight);
    if (intakeFields.length > 0) {
      setStep('intake');
    } else {
      issueTicket(selectedServiceId, priorityId, weight);
    }
  };

  const skipPriority = () => {
    touchActivity();
    if (intakeFields.length > 0) {
      setStep('intake');
    } else {
      issueTicket(selectedServiceId);
    }
  };

  const submitIntake = () => {
    touchActivity();
    if (hasMissingRequired(intakeFields, intakeValues)) {
      setErrorMsg(
        t('join.fillRequired', { defaultValue: 'Please fill in the required fields.' })
      );
      return;
    }
    setErrorMsg('');
    // Persist name/phone back to the store so other flows prefill too
    const name = (intakeValues.name ?? '').trim();
    const phone = (intakeValues.phone ?? '').trim();
    if (name || phone) setCustomerInfo(name || savedName, phone || savedPhone);
    issueTicket(selectedServiceId, selectedPriorityId || undefined, selectedPriorityWeight);
  };

  const issueTicket = async (
    serviceId: string,
    priorityCategoryId?: string,
    priority?: number
  ) => {
    if (!info) return;
    setStep('loading');
    // Build customerData from intake values (trim + drop empties)
    const customerData: Record<string, string> = {};
    let nameOut: string | undefined;
    let phoneOut: string | undefined;
    for (const f of intakeFields) {
      const v = (intakeValues[f.key] ?? '').trim();
      if (!v) continue;
      customerData[f.key] = v;
      if (f.key === 'name') nameOut = v;
      if (f.key === 'phone') phoneOut = v;
    }
    const result = await createKioskTicket({
      officeId: info.office.id,
      departmentId: selectedDeptId,
      serviceId,
      priorityCategoryId,
      priority,
      customerName: nameOut,
      customerPhone: phoneOut,
      customerData: Object.keys(customerData).length > 0 ? customerData : undefined,
    });
    if ('error' in result) {
      setErrorMsg(result.error);
      setStep('home');
      return;
    }
    setTicket(result.ticket);
    setStep('issued');
    // Record in history + remember as active so the Active tab lands on it
    // even if the user backs out without tapping "Track position".
    addToHistory({
      token: result.ticket.qr_token,
      ticketNumber: result.ticket.ticket_number,
      officeName: info.office.name,
      serviceName:
        info.services.find((sv) => sv.id === serviceId)?.name ??
        info.departments.find((d) => d.id === selectedDeptId)?.name ??
        'General',
      status: result.ticket.status,
      date: new Date().toISOString(),
      officeId: info.office.id,
      kioskSlug: slug ?? undefined,
    });
    setActiveKioskSlug(slug ?? null);
    setActiveToken(result.ticket.qr_token);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    resetIdleTimer();
  };

  const handleTrack = () => {
    if (!ticket) return;
    // activeToken/kioskSlug already set in issueTicket — just navigate
    router.replace('/(tabs)');
  };

  const handleBack = () => {
    touchActivity();
    const cameFromPeek = startParam === 'pick' || !!initialDeptId;
    switch (step) {
      case 'department':
        // If we skipped home (arrived from queue-peek), pop back to it.
        if (cameFromPeek) {
          router.back();
        } else {
          goHome();
        }
        break;
      case 'service':
        if (departments.length <= 1) {
          if (cameFromPeek) router.back();
          else goHome();
        } else {
          setStep('department');
        }
        break;
      case 'priority':
        setStep('service');
        break;
      case 'intake':
        if (priorities.length > 0) setStep('priority');
        else setStep('service');
        break;
      case 'issued':
        goHome();
        break;
      default:
        break;
    }
  };

  // ---- Responsive style helpers ----
  const containerMaxWidth = isTablet ? 700 : undefined;
  const cardMinHeight = isTablet ? 72 : 60;
  const gridColumns = isTablet ? 2 : 1;
  const headingSize = isTablet ? 36 : fontSize.xxl;
  const subheadingSize = isTablet ? fontSize.xl : fontSize.lg;
  const bodySize = isTablet ? fontSize.lg : fontSize.md;
  const containerPadding = isTablet ? spacing.xl : spacing.lg;

  // ---- Loading ----
  if (step === 'loading') {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={s.loadingText}>{t('kiosk.loadingKiosk')}</Text>
      </View>
    );
  }

  // ---- Error (fatal) ----
  if (step === 'error' && !info) {
    return (
      <View style={s.center}>
        <View style={s.errorCircle}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        </View>
        <Text style={s.errorTitle}>{t('kiosk.kioskUnavailable')}</Text>
        <Text style={s.errorSub}>{errorMsg}</Text>
        <TouchableOpacity style={s.outlineBtn} onPress={() => router.back()}>
          <Text style={s.outlineBtnText}>{t('kiosk.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---- Header ----
  const Header = ({ showBack }: { showBack?: boolean }) => (
    <View style={[s.header, { paddingHorizontal: containerPadding }]}>
      {showBack && (
        <TouchableOpacity style={s.backArrow} onPress={handleBack} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={isTablet ? 28 : 24} color={colors.text} />
        </TouchableOpacity>
      )}
      <View style={s.headerCenter}>
        <Text style={[s.orgName, isTablet && { fontSize: fontSize.md }]}>
          {info?.organization.name}
        </Text>
        {/* Only show office name when it differs from the org name —
            otherwise users see e.g. "DZD / DZD" which reads as a bug. */}
        {info?.office.name &&
          info.office.name.trim().toLowerCase() !==
            (info.organization.name ?? '').trim().toLowerCase() && (
            <Text style={[s.officeName, { fontSize: isTablet ? fontSize.lg : fontSize.md }]}>
              {info.office.name}
            </Text>
          )}
      </View>
      <View style={s.backArrow} />
    </View>
  );

  // ---- Grid renderer ----
  const renderGrid = <T extends { id: string }>(
    items: T[],
    renderItem: (item: T) => React.ReactNode
  ) => {
    if (gridColumns === 1) {
      return <View>{items.map((item) => renderItem(item))}</View>;
    }
    // 2-column grid
    const rows: T[][] = [];
    for (let i = 0; i < items.length; i += 2) {
      rows.push(items.slice(i, i + 2));
    }
    return (
      <View>
        {rows.map((row, ri) => (
          <View key={ri} style={s.gridRow}>
            {row.map((item) => (
              <View key={item.id} style={s.gridCell}>
                {renderItem(item)}
              </View>
            ))}
            {row.length === 1 && <View style={s.gridCell} />}
          </View>
        ))}
      </View>
    );
  };

  // ---- Home step ----
  if (step === 'home') {
    // Self-service is off when the business runs in staff-check-in-only mode.
    // We know this up front from /api/kiosk-info, so rather than let the user
    // tap Get Ticket and then bounce with a red error, disable the CTA and
    // lead with a neutral info banner pointing them at the right action.
    const selfServiceDisabled =
      (info?.settings as any)?.default_check_in_mode === 'manual';

    return (
      <View style={s.screenContainer} onTouchStart={touchActivity}>
        <Header />
        <View style={[s.centerContent, { maxWidth: containerMaxWidth }]}>
          <View style={s.welcomeIcon}>
            <Ionicons name="ticket-outline" size={isTablet ? 72 : 56} color={colors.primary} />
          </View>
          <Text style={[s.welcomeTitle, { fontSize: headingSize }]}>{t('kiosk.welcome')}</Text>
          <Text style={[s.welcomeSub, { fontSize: bodySize }]}>
            {selfServiceDisabled
              ? t('kiosk.staffCheckInSub', {
                  defaultValue: 'Please check in at the front desk, or book an appointment.',
                })
              : t('kiosk.tapToGetTicket')}
          </Text>

          {/* Show server-side errors as red only when the failure was unexpected.
              The staff-only case is handled by the banner + disabled button below. */}
          {errorMsg && !selfServiceDisabled ? (
            <View style={s.errorBanner}>
              <Ionicons name="warning-outline" size={16} color={colors.error} />
              <Text style={s.errorBannerText}>{errorMsg}</Text>
            </View>
          ) : null}

          {!selfServiceDisabled && (
            <TouchableOpacity
              style={[s.primaryBtn, isTablet && s.primaryBtnTablet]}
              onPress={goToDepartments}
              activeOpacity={0.8}
            >
              <Ionicons name="ticket" size={isTablet ? 26 : 22} color="#fff" />
              <Text style={[s.primaryBtnText, isTablet && { fontSize: fontSize.xl }]}>
                {t('kiosk.getTicket')}
              </Text>
            </TouchableOpacity>
          )}

          {info?.settings?.appointments_enabled && (
            <TouchableOpacity
              style={[s.secondaryBtn, isTablet && s.secondaryBtnTablet]}
              activeOpacity={0.7}
            >
              <Ionicons
                name="calendar-outline"
                size={isTablet ? 24 : 20}
                color={colors.primary}
              />
              <Text style={[s.secondaryBtnText, isTablet && { fontSize: fontSize.lg }]}>
                {t('kiosk.checkInAppointment')}
              </Text>
            </TouchableOpacity>
          )}

          {info?.settings?.booking_mode !== 'disabled' && (
            <TouchableOpacity
              style={[s.bookBtn, { borderColor: colors.border }]}
              onPress={() => router.push(`/book-appointment/${slug}` as any)}
              activeOpacity={0.8}
            >
              <Ionicons name="calendar-outline" size={isTablet ? 20 : 16} color={colors.primary} />
              <Text style={[s.bookBtnText, { color: colors.primary }, isTablet && { fontSize: fontSize.md }]}>
                {t('kiosk.bookForLater')}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={s.peekBtn}
            onPress={() => router.push(`/queue-peek/${slug}` as any)}
            activeOpacity={0.7}
          >
            <Ionicons name="eye-outline" size={isTablet ? 20 : 16} color={colors.textMuted} />
            <Text style={[s.peekBtnText, isTablet && { fontSize: fontSize.md }]}>
              {t('kiosk.viewWaitTimes')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ---- Department selection ----
  if (step === 'department') {
    return (
      <View style={s.screenContainer} onTouchStart={touchActivity}>
        <Header showBack />
        <ScrollView
          contentContainerStyle={[s.scrollContent, { maxWidth: containerMaxWidth, padding: containerPadding }]}
          style={s.scrollView}
        >
          <Text style={[s.stepTitle, { fontSize: subheadingSize }]}>{t('kiosk.selectDepartment')}</Text>
          <Text style={[s.stepSub, { fontSize: bodySize }]}>
            {t('kiosk.chooseDepartment')}
          </Text>

          {renderGrid(departments, (dept) => (
            <TouchableOpacity
              key={dept.id}
              style={[s.card, { minHeight: cardMinHeight }]}
              onPress={() => selectDepartment(dept.id)}
              activeOpacity={0.7}
            >
              <View style={s.cardIcon}>
                <Ionicons name="business-outline" size={isTablet ? 28 : 24} color={colors.primary} />
              </View>
              <View style={s.cardBody}>
                <Text style={[s.cardTitle, isTablet && { fontSize: fontSize.lg }]}>{dept.name}</Text>
                <Text style={[s.cardCode, isTablet && { fontSize: fontSize.sm }]}>{dept.code}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ---- Service selection ----
  if (step === 'service') {
    return (
      <View style={s.screenContainer} onTouchStart={touchActivity}>
        <Header showBack />
        <ScrollView
          contentContainerStyle={[s.scrollContent, { maxWidth: containerMaxWidth, padding: containerPadding }]}
          style={s.scrollView}
        >
          <Text style={[s.stepTitle, { fontSize: subheadingSize }]}>{t('kiosk.selectService')}</Text>
          {selectedDept && (
            <Text style={[s.stepSub, { fontSize: bodySize }]}>
              {selectedDept.name} {t('kiosk.department')}
            </Text>
          )}

          {renderGrid(servicesForDept, (svc) => (
            <TouchableOpacity
              key={svc.id}
              style={[s.card, { minHeight: cardMinHeight }]}
              onPress={() => selectService(svc.id)}
              activeOpacity={0.7}
            >
              <View style={s.cardIcon}>
                <Ionicons name="document-text-outline" size={isTablet ? 28 : 24} color={colors.primary} />
              </View>
              <View style={s.cardBody}>
                <Text style={[s.cardTitle, isTablet && { fontSize: fontSize.lg }]}>{svc.name}</Text>
                {svc.description && (
                  <Text style={[s.cardDesc, isTablet && { fontSize: fontSize.sm }]} numberOfLines={2}>
                    {svc.description}
                  </Text>
                )}
                {svc.estimated_service_time != null && (
                  <Text style={s.cardEst}>~{svc.estimated_service_time} {t('kiosk.min')}</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ---- Priority selection ----
  if (step === 'priority') {
    return (
      <View style={s.screenContainer} onTouchStart={touchActivity}>
        <Header showBack />
        <ScrollView
          contentContainerStyle={[s.scrollContent, { maxWidth: containerMaxWidth, padding: containerPadding }]}
          style={s.scrollView}
        >
          <Text style={[s.stepTitle, { fontSize: subheadingSize }]}>{t('kiosk.selectPriority')}</Text>
          <Text style={[s.stepSub, { fontSize: bodySize }]}>
            {t('kiosk.choosePriority')}
          </Text>

          {renderGrid(priorities, (p) => (
            <TouchableOpacity
              key={p.id}
              style={[
                s.card,
                { minHeight: cardMinHeight },
                p.color ? { borderLeftWidth: 4, borderLeftColor: p.color } : undefined,
              ]}
              onPress={() => selectPriority(p.id, p.weight)}
              activeOpacity={0.7}
            >
              <View style={[s.cardIcon, p.color ? { backgroundColor: p.color + '18' } : undefined]}>
                {p.icon && /[^\x00-\x7F]/.test(p.icon) ? (
                  <Text style={{ fontSize: isTablet ? 28 : 24 }}>{p.icon}</Text>
                ) : (
                  <Ionicons
                    name={(p.icon as any) || 'flag-outline'}
                    size={isTablet ? 28 : 24}
                    color={p.color ?? colors.primary}
                  />
                )}
              </View>
              <View style={s.cardBody}>
                <Text style={[s.cardTitle, isTablet && { fontSize: fontSize.lg }]}>{p.name}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={s.skipBtn} onPress={skipPriority} activeOpacity={0.7}>
            <Text style={[s.skipBtnText, { fontSize: bodySize }]}>{t('kiosk.skipStandardPriority')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ---- Intake (name/phone/custom fields) ----
  if (step === 'intake') {
    return (
      <View style={s.screenContainer} onTouchStart={touchActivity}>
        <Header showBack />
        <ScrollView
          contentContainerStyle={[
            s.scrollContent,
            { maxWidth: containerMaxWidth, padding: containerPadding, paddingBottom: 80 + kbPad },
          ]}
          style={s.scrollView}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <Text style={[s.stepTitle, { fontSize: subheadingSize }]}>
            {t('join.yourDetails', { defaultValue: 'Your details' })}
          </Text>
          <Text style={[s.stepSub, { fontSize: bodySize }]}>
            {t('kiosk.intakeSub', {
              defaultValue: 'We\'ll use this to notify you when it\'s your turn.',
            })}
          </Text>

          <IntakeForm
            fields={intakeFields}
            values={intakeValues}
            onChange={(key, value) =>
              setIntakeValues((prev) => ({ ...prev, [key]: value }))
            }
            autoFocusFirst
            title={null}
            subtitle={null}
          />

          {errorMsg ? (
            <View style={[s.errorBanner, { marginTop: spacing.md }]}>
              <Ionicons name="warning-outline" size={16} color={colors.error} />
              <Text style={s.errorBannerText}>{errorMsg}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              s.primaryBtn,
              isTablet && s.primaryBtnTablet,
              { marginTop: spacing.lg, alignSelf: 'center' },
            ]}
            onPress={submitIntake}
            activeOpacity={0.8}
          >
            <Ionicons name="ticket" size={isTablet ? 24 : 20} color="#fff" />
            <Text style={[s.primaryBtnText, isTablet && { fontSize: fontSize.xl }]}>
              {t('kiosk.getTicket')}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ---- Ticket issued ----
  if (step === 'issued' && ticket) {
    return (
      <View style={s.screenContainer} onTouchStart={touchActivity}>
        <Header />
        <View style={[s.centerContent, { maxWidth: containerMaxWidth }]}>
          <View style={s.successCircle}>
            <Ionicons name="checkmark-circle" size={isTablet ? 80 : 64} color={colors.success} />
          </View>

          <Text style={[s.issuedLabel, { fontSize: bodySize }]}>{t('kiosk.yourTicketNumber')}</Text>
          <Text style={[s.ticketNumber, { fontSize: isTablet ? 72 : 60 }]}>
            {ticket.ticket_number}
          </Text>

          <View style={s.ticketMeta}>
            {selectedDept && (
              <View style={s.metaBadge}>
                <Ionicons name="business-outline" size={14} color={colors.primary} />
                <Text style={s.metaText}>{selectedDept.name}</Text>
              </View>
            )}
            {selectedService && (
              <View style={s.metaBadge}>
                <Ionicons name="document-text-outline" size={14} color={colors.primary} />
                <Text style={s.metaText}>{selectedService.name}</Text>
              </View>
            )}
          </View>

          {ticket.estimated_wait_minutes != null && (
            <View style={s.waitBadge}>
              <Ionicons name="time-outline" size={18} color={colors.warning} />
              <Text style={[s.waitBadgeText, { fontSize: bodySize }]}>
                {t('kiosk.estimatedWait', { minutes: ticket.estimated_wait_minutes })}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[s.primaryBtn, isTablet && s.primaryBtnTablet]}
            onPress={handleTrack}
            activeOpacity={0.8}
          >
            <Ionicons name="navigate" size={isTablet ? 24 : 20} color="#fff" />
            <Text style={[s.primaryBtnText, isTablet && { fontSize: fontSize.xl }]}>
              {t('kiosk.trackPosition')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.secondaryBtn, isTablet && s.secondaryBtnTablet]}
            onPress={goHome}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle-outline" size={isTablet ? 24 : 20} color={colors.primary} />
            <Text style={[s.secondaryBtnText, isTablet && { fontSize: fontSize.lg }]}>
              {t('kiosk.takeAnotherTicket')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Fallback
  return null;
}

// ---------------------------------------------------------------------------
// Styles — theme-aware (light/dark)
// ---------------------------------------------------------------------------
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // Layout
  screenContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    alignSelf: 'center',
    width: '100%',
    paddingBottom: spacing.xxl,
  },
  loadingText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  backArrow: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  orgName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  officeName: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Error
  errorCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.error + '12',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  errorTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },
  errorSub: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 300,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.error + '10',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    width: '100%',
    maxWidth: 400,
  },
  errorBannerText: {
    fontSize: fontSize.sm,
    color: colors.error,
    flex: 1,
  },

  // Welcome / Home
  welcomeIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.primary + '10',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  welcomeTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.text,
  },
  welcomeSub: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },

  // Buttons
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 4,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    width: '100%',
    maxWidth: 400,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnTablet: {
    paddingVertical: spacing.lg,
    maxWidth: 500,
  },
  primaryBtnText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: '#fff',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.primary + '30',
    width: '100%',
    maxWidth: 400,
  },
  secondaryBtnTablet: {
    paddingVertical: spacing.md + 4,
    maxWidth: 500,
  },
  secondaryBtnText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.primary,
  },
  outlineBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  outlineBtnText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  skipBtn: {
    alignSelf: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  skipBtnText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  bookBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    alignSelf: 'center',
  },
  bookBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  peekBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  peekBtnText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },

  // Step titles
  stepTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  stepSub: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },

  // Cards
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 60,
    borderWidth: 1,
    borderColor: colors.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primary + '10',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  cardCode: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  cardDesc: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  cardEst: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 4,
  },

  // Grid
  gridRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  gridCell: {
    flex: 1,
  },

  // Ticket issued
  successCircle: {
    marginBottom: spacing.sm,
  },
  issuedLabel: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  ticketNumber: {
    fontSize: 60,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: 2,
  },
  ticketMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary + '10',
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
  },
  metaText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  waitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningLight,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
  },
  waitBadgeText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
});
