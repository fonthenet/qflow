import { useCallback, useEffect, useState } from 'react';
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
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { fetchJoinInfo, joinQueue, type JoinInfoResponse } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

type Step = 'loading' | 'select' | 'joining' | 'success' | 'error';

export default function JoinScreen() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { setActiveToken, setActiveJoinToken, recordPlace, customerName: savedName, customerPhone: savedPhone } = useAppStore();

  const [step, setStep] = useState<Step>('loading');
  const [info, setInfo] = useState<JoinInfoResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Selections
  const [selectedOfficeId, setSelectedOfficeId] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [name, setName] = useState(savedName);
  const [phone, setPhone] = useState(savedPhone);
  const [reason, setReason] = useState('');

  // Result
  const [ticketNumber, setTicketNumber] = useState('');
  const [ticketToken, setTicketToken] = useState('');

  // Fetch join info
  const loadInfo = useCallback(async () => {
    if (!token) return;
    setStep('loading');
    const data = await fetchJoinInfo(token);
    if (!data) {
      setStep('error');
      setErrorMsg(t('join.invalidOrClosed'));
      return;
    }
    setInfo(data);

    // Save each office in this join link to Places immediately
    for (const office of data.offices) {
      recordPlace({
        id: office.id,
        name: office.name,
        address: office.address,
        joinToken: token,
      });
    }

    // Auto-select locked values
    const officeId = data.virtualCode.office_id ?? '';
    const deptId = data.virtualCode.department_id ?? '';
    const serviceId = data.virtualCode.service_id ?? '';

    // Auto-select if only one option
    const resolvedOffice = officeId || (data.offices.length === 1 ? data.offices[0].id : '');
    const availDepts = resolvedOffice
      ? data.departments.filter((d) => d.office_id === resolvedOffice)
      : data.departments;
    const resolvedDept = deptId || (availDepts.length === 1 ? availDepts[0].id : '');
    const availServices = resolvedDept
      ? data.services.filter((s) => s.department_id === resolvedDept)
      : data.services;
    const resolvedService = serviceId || (availServices.length === 1 ? availServices[0].id : '');

    setSelectedOfficeId(resolvedOffice);
    setSelectedDeptId(resolvedDept);
    setSelectedServiceId(resolvedService);
    setStep('select');
  }, [token, recordPlace]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  // Derived data
  const availableDepts = info
    ? selectedOfficeId
      ? info.departments.filter((d) => d.office_id === selectedOfficeId)
      : info.departments
    : [];
  const availableServices = info
    ? selectedDeptId
      ? info.services.filter((s) => s.department_id === selectedDeptId)
      : info.services
    : [];

  const officeLocked = !!info?.virtualCode.office_id;
  const deptLocked = !!info?.virtualCode.department_id;
  const serviceLocked = !!info?.virtualCode.service_id;

  const waitingCount = info
    ? info.waitingTickets.filter((t) => {
        if (selectedOfficeId && t.office_id !== selectedOfficeId) return false;
        if (selectedDeptId && t.department_id !== selectedDeptId) return false;
        if (selectedServiceId && t.service_id !== selectedServiceId) return false;
        return true;
      }).length
    : 0;

  const canJoin = selectedOfficeId && selectedDeptId && selectedServiceId;

  // Handle join
  const handleJoin = async () => {
    if (!canJoin) return;
    setStep('joining');
    const result = await joinQueue({
      officeId: selectedOfficeId,
      departmentId: selectedDeptId,
      serviceId: selectedServiceId,
      customerName: name.trim() || undefined,
      customerPhone: phone.trim() || undefined,
      reason: reason.trim() || undefined,
    });
    if ('error' in result) {
      setStep('select');
      setErrorMsg(result.error);
      return;
    }
    setTicketNumber(result.ticket.ticket_number);
    setTicketToken(result.ticket.qr_token);
    setStep('success');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleTrack = () => {
    setActiveJoinToken(token ?? null);
    setActiveToken(ticketToken);
    router.replace('/(tabs)');
  };

  // --- Loading ---
  if (step === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{t('join.loadingQueueInfo')}</Text>
      </View>
    );
  }

  // --- Error ---
  if (step === 'error' && !info) {
    return (
      <View style={styles.center}>
        <View style={styles.errorCircle}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        </View>
        <Text style={styles.errorTitle}>{t('join.queueUnavailable')}</Text>
        <Text style={styles.errorSub}>{errorMsg}</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>{t('join.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Success ---
  if (step === 'success') {
    return (
      <View style={styles.center}>
        <View style={styles.successCircle}>
          <Ionicons name="checkmark-circle" size={64} color={colors.success} />
        </View>
        <Text style={styles.successTitle}>{t('join.youreInQueue')}</Text>
        <Text style={styles.successSub}>{t('join.yourTicketNumber')}</Text>
        <Text style={styles.ticketNumberBig}>{ticketNumber}</Text>

        <TouchableOpacity style={styles.trackButton} onPress={handleTrack} activeOpacity={0.8}>
          <Ionicons name="navigate" size={20} color="#fff" />
          <Text style={styles.trackButtonText}>{t('join.trackPosition')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Selection form ---
  const selectedService = availableServices.find((s) => s.id === selectedServiceId);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.orgName}>{info?.organization.name ?? t('admin.queue')}</Text>
        <Text style={styles.headline}>{t('join.joinTheQueue')}</Text>
        <Text style={styles.subline}>{t('join.chooseService')}</Text>
      </View>

      {/* Wait info */}
      {(waitingCount > 0 || selectedServiceId) && (
        <View style={styles.waitBar}>
          <View style={styles.waitItem}>
            <Text style={styles.waitValue}>{waitingCount}</Text>
            <Text style={styles.waitLabel}>{t('join.waiting')}</Text>
          </View>
          {selectedService?.estimated_service_time && (
            <>
              <View style={styles.waitDivider} />
              <View style={styles.waitItem}>
                <Text style={styles.waitValue}>~{selectedService.estimated_service_time}</Text>
                <Text style={styles.waitLabel}>{t('join.minPerPerson')}</Text>
              </View>
            </>
          )}
        </View>
      )}

      {/* Error banner */}
      {errorMsg && step === 'select' ? (
        <View style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={16} color={colors.error} />
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
        </View>
      ) : null}

      {/* Office selection */}
      {!officeLocked && info && info.offices.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('join.selectLocation')}</Text>
          {info.offices.map((office) => (
            <TouchableOpacity
              key={office.id}
              style={[
                styles.optionCard,
                selectedOfficeId === office.id && styles.optionCardActive,
              ]}
              onPress={() => {
                setSelectedOfficeId(office.id);
                setSelectedDeptId('');
                setSelectedServiceId('');
                setErrorMsg('');
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.optionName, selectedOfficeId === office.id && styles.optionNameActive]}>
                {office.name}
              </Text>
              {office.address && <Text style={styles.optionDetail}>{office.address}</Text>}
              {selectedOfficeId === office.id && (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} style={styles.optionCheck} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Department selection */}
      {!deptLocked && availableDepts.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('join.selectDepartment')}</Text>
          {availableDepts.map((dept) => (
            <TouchableOpacity
              key={dept.id}
              style={[
                styles.optionCard,
                selectedDeptId === dept.id && styles.optionCardActive,
              ]}
              onPress={() => {
                setSelectedDeptId(dept.id);
                setSelectedServiceId('');
                setErrorMsg('');
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.optionName, selectedDeptId === dept.id && styles.optionNameActive]}>
                {dept.name}
              </Text>
              {selectedDeptId === dept.id && (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} style={styles.optionCheck} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Service selection */}
      {!serviceLocked && availableServices.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('join.selectService')}</Text>
          {availableServices.map((svc) => (
            <TouchableOpacity
              key={svc.id}
              style={[
                styles.optionCard,
                selectedServiceId === svc.id && styles.optionCardActive,
              ]}
              onPress={() => {
                setSelectedServiceId(svc.id);
                setErrorMsg('');
              }}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionName, selectedServiceId === svc.id && styles.optionNameActive]}>
                  {svc.name}
                </Text>
                {svc.description && <Text style={styles.optionDetail}>{svc.description}</Text>}
                {svc.estimated_service_time && (
                  <Text style={styles.optionEst}>~{svc.estimated_service_time} {t('time.min')}</Text>
                )}
              </View>
              {selectedServiceId === svc.id && (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} style={styles.optionCheck} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Customer details */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('join.yourDetails')}</Text>
        <Text style={styles.sectionSub}>{t('join.optionalHelpsStaff')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('join.namePlaceholder')}
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder={t('join.phonePlaceholder')}
          placeholderTextColor={colors.textMuted}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder={t('join.reasonPlaceholder')}
          placeholderTextColor={colors.textMuted}
          value={reason}
          onChangeText={setReason}
          autoCapitalize="sentences"
        />
      </View>

      {/* Join button */}
      <TouchableOpacity
        style={[styles.joinButton, !canJoin && styles.joinButtonDisabled]}
        onPress={handleJoin}
        disabled={!canJoin || step === 'joining'}
        activeOpacity={0.8}
      >
        {step === 'joining' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="enter-outline" size={20} color="#fff" />
            <Text style={styles.joinButtonText}>{t('join.joinQueue')}</Text>
          </>
        )}
      </TouchableOpacity>

      <View style={{ height: spacing.xxl }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },

  // Header
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  orgName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.xs,
  },
  headline: {
    fontSize: fontSize.xxl + 2,
    fontWeight: '800',
    color: colors.text,
  },
  subline: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },

  // Wait bar
  waitBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  waitItem: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  waitValue: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },
  waitLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  waitDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
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
    maxWidth: 280,
  },
  backButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  backButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.error + '10',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorBannerText: {
    fontSize: fontSize.sm,
    color: colors.error,
    flex: 1,
  },

  // Success
  successCircle: {
    marginBottom: spacing.md,
  },
  successTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.text,
  },
  successSub: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  ticketNumberBig: {
    fontSize: 48,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: 2,
    marginVertical: spacing.md,
  },
  trackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    width: '100%',
    maxWidth: 300,
    marginTop: spacing.md,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  trackButtonText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: '#fff',
  },

  // Sections
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  sectionSub: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.md,
    marginTop: -spacing.xs,
  },

  // Option cards
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: colors.borderLight,
  },
  optionCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '08',
  },
  optionName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  optionNameActive: {
    color: colors.primary,
  },
  optionDetail: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  optionEst: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 4,
  },
  optionCheck: {
    marginLeft: 'auto',
  },

  // Inputs
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    fontSize: fontSize.md,
    color: colors.text,
    marginBottom: spacing.sm,
  },

  // Join button
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 2,
    borderRadius: borderRadius.lg,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  joinButtonDisabled: {
    opacity: 0.5,
  },
  joinButtonText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: '#fff',
  },
});
