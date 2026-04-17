import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  I18nManager,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { useOperatorStore } from '@/lib/operator-store';
import { useOrg } from '@/lib/use-org';
import * as Actions from '@/lib/data-adapter';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';
import { API_BASE_URL } from '@/lib/config';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Department {
  id: string;
  name: string;
  code: string | null;
}

interface Service {
  id: string;
  name: string;
  code: string | null;
  department_id: string;
}

interface PriorityCategory {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  weight: number | null;
}

interface CreatedTicket {
  id: string;
  ticket_number: string;
  qr_token: string | null;
  qr_data_url?: string | null;
  position?: number;
  estimated_wait?: number;
  whatsappStatus?: { sent: boolean; error?: string };
}

// ---------------------------------------------------------------------------
// Animated Success View
// ---------------------------------------------------------------------------

function SuccessView({
  ticket,
  customerName,
  customerPhone,
  onNewTicket,
  onDone,
}: {
  ticket: CreatedTicket;
  customerName: string;
  customerPhone: string;
  onNewTicket: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();

  const trackUrl = ticket.qr_token ? `${API_BASE_URL}/q/${ticket.qr_token}` : '';
  const qrImageUrl = ticket.qr_data_url
    ? ticket.qr_data_url
    : trackUrl
      ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(trackUrl)}`
      : '';

  const hasCustomerInfo = !!customerName || !!customerPhone;

  // Phase 1: circle grows from 0 → 1.15 → 1 (like kiosk-circle-grow)
  const circleScale = useSharedValue(0);
  const circleOpacity = useSharedValue(0);
  // Phase 2: checkmark appears after circle settles (like kiosk-check-draw + bounce)
  const checkOpacity = useSharedValue(0);
  const checkScale = useSharedValue(0.8);
  // Phase 3: rest of content fades in
  const contentOpacity = useSharedValue(0);
  const contentTranslateY = useSharedValue(12);

  useEffect(() => {
    // Phase 1: circle (0–500ms)
    circleOpacity.value = withTiming(1, { duration: 200 });
    circleScale.value = withSequence(
      withTiming(1.15, { duration: 350, easing: Easing.out(Easing.back(1.5)) }),
      withTiming(1, { duration: 150, easing: Easing.inOut(Easing.ease) }),
    );
    // Phase 2: checkmark draw (350ms delay, like web's 0.35s)
    checkOpacity.value = withDelay(350, withTiming(1, { duration: 300 }));
    checkScale.value = withDelay(350, withSequence(
      withTiming(1.05, { duration: 200 }),
      withTiming(1, { duration: 150 }),
    ));
    // Phase 3: content (700ms delay)
    contentOpacity.value = withDelay(700, withTiming(1, { duration: 300 }));
    contentTranslateY.value = withDelay(700, withTiming(0, { duration: 300, easing: Easing.out(Easing.ease) }));
  }, []);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: circleScale.value }],
    opacity: circleOpacity.value,
  }));

  const checkIconStyle = useAnimatedStyle(() => ({
    opacity: checkOpacity.value,
    transform: [{ scale: checkScale.value }],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.successContent}>
      {/* Animated check + ticket number */}
      <View style={styles.successHeader}>
        <Animated.View style={[styles.successCheckCircle, circleStyle]}>
          <Animated.View style={checkIconStyle}>
            <Ionicons name="checkmark" size={28} color="#fff" />
          </Animated.View>
        </Animated.View>
        <Text style={styles.successTitle}>{t('booking.ticketCreated')}</Text>
        <TouchableOpacity
          style={styles.ticketNumberBox}
          activeOpacity={0.7}
          onPress={() => {
            Clipboard.setStringAsync(ticket.ticket_number);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }}
        >
          <Text style={styles.ticketNumberText}>{ticket.ticket_number}</Text>
          <Ionicons name="copy-outline" size={14} color={colors.primary} style={{ marginLeft: 6 }} />
        </TouchableOpacity>
      </View>

      <Animated.View style={[contentStyle, { gap: spacing.md, width: '100%' }]}>
        {/* Customer info + position — single row */}
        {(hasCustomerInfo || ticket.position != null) && (
          <View style={styles.successInfoRow}>
            {hasCustomerInfo && (
              <View style={styles.successInfoItem}>
                <Ionicons name="person-outline" size={14} color={colors.textSecondary} />
                <Text style={styles.successInfoText} numberOfLines={1}>
                  {[customerName, customerPhone].filter(Boolean).join(' · ')}
                </Text>
              </View>
            )}
            {ticket.position != null && (
              <View style={styles.successInfoItem}>
                <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
                <Text style={styles.successInfoText}>
                  #{ticket.position}
                  {ticket.estimated_wait != null && ticket.estimated_wait > 0
                    ? ` · ~${ticket.estimated_wait} min`
                    : ''}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* QR Code — smaller */}
        {qrImageUrl ? (
          <View style={styles.qrContainer}>
            <Image
              source={{ uri: qrImageUrl }}
              style={styles.qrImage}
              resizeMode="contain"
            />
            <Text style={styles.qrHint}>{t('booking.scanToTrack')}</Text>
          </View>
        ) : null}

        {/* Tracking link */}
        {trackUrl ? (
          <TouchableOpacity
            style={styles.trackLinkBox}
            activeOpacity={0.7}
            onPress={() => Linking.openURL(trackUrl)}
          >
            <Ionicons name="link-outline" size={14} color={colors.primary} />
            <Text style={styles.trackLinkText} numberOfLines={1}>
              qflo.net/q/{ticket.qr_token}
            </Text>
            <Ionicons name="open-outline" size={12} color={colors.primary} style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        ) : null}

        {/* WhatsApp notification status */}
        {customerPhone && ticket.whatsappStatus && (
          <View style={[styles.waStatusRow, { backgroundColor: ticket.whatsappStatus.sent ? '#f0fdf4' : '#fffbeb', borderColor: ticket.whatsappStatus.sent ? '#bbf7d0' : '#fde68a' }]}>
            <Ionicons
              name={ticket.whatsappStatus.sent ? 'checkmark-circle' : 'warning'}
              size={18}
              color={ticket.whatsappStatus.sent ? '#16a34a' : '#d97706'}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.waStatusTitle, { color: ticket.whatsappStatus.sent ? '#166534' : '#92400e' }]}>
                {ticket.whatsappStatus.sent ? t('booking.whatsappSent') : t('booking.whatsappFailed')}
              </Text>
              {!ticket.whatsappStatus.sent && (
                <Text style={[styles.waStatusSub, { color: '#b45309' }]}>
                  {ticket.whatsappStatus.error === 'Invalid phone number'
                    ? t('booking.invalidPhone')
                    : t('booking.whatsappFailedHint')}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Actions */}
        <View style={styles.successBtnRow}>
          <TouchableOpacity style={styles.newTicketBtn} onPress={onNewTicket} activeOpacity={0.8}>
            <Ionicons name="add-circle-outline" size={20} color="#fff" />
            <Text style={styles.newTicketBtnText}>{t('booking.newTicket')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.doneBtn} onPress={onDone} activeOpacity={0.8}>
            <Ionicons name="checkmark-done-outline" size={20} color={colors.primary} />
            <Text style={styles.doneBtnText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function InHouseBookingScreen() {
  const { t } = useTranslation();
  const { session } = useOperatorStore();
  const { orgId } = useOrg();
  const router = useRouter();
  const officeId = session?.officeId ?? null;

  // Data
  const [departments, setDepartments] = useState<Department[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [priorities, setPriorities] = useState<PriorityCategory[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Form
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [visitReason, setVisitReason] = useState('');
  const [selectedPriorityId, setSelectedPriorityId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Result
  const [createdTicket, setCreatedTicket] = useState<CreatedTicket | null>(null);

  // Load departments + services + priority categories
  useEffect(() => {
    if (!officeId) return;
    setLoadingData(true);
    // Fetch priority categories from Supabase (works in cloud AND local mode
    // as long as the phone has internet — matches how name-lookup does it).
    const prioritiesPromise: Promise<PriorityCategory[]> = orgId
      ? (async () => {
          try {
            const { data } = await supabase
              .from('priority_categories')
              .select('id, name, icon, color, weight')
              .eq('organization_id', orgId)
              .eq('is_active', true)
              .order('weight', { ascending: false });
            return (data as PriorityCategory[]) ?? [];
          } catch {
            return [];
          }
        })()
      : Promise.resolve([]);

    Promise.all([
      Actions.fetchOfficeDepartments(officeId),
      Actions.fetchDepartmentServices(officeId),
      prioritiesPromise,
    ])
      .then(([depts, svcs, prios]) => {
        setDepartments(depts);
        setServices(svcs);
        setPriorities(prios);
        // Auto-select: if only 1, pick it; if operator's dept exists, pick that
        if (depts.length === 1) {
          setSelectedDeptId(depts[0].id);
        } else if (session?.departmentId && depts.some((d) => d.id === session.departmentId)) {
          setSelectedDeptId(session.departmentId);
        } else if (depts.length > 0) {
          // Default to first department so button is never stuck
          setSelectedDeptId(depts[0].id);
        }
      })
      .catch((err) => Alert.alert(t('common.error'), err.message))
      .finally(() => setLoadingData(false));
  }, [officeId, session?.departmentId]);

  // Filtered services for selected department
  const filteredServices = useMemo(
    () => services.filter((s) => s.department_id === selectedDeptId),
    [services, selectedDeptId],
  );

  // Auto-select service if only one
  useEffect(() => {
    if (filteredServices.length === 1) {
      setSelectedServiceId(filteredServices[0].id);
    } else {
      setSelectedServiceId('');
    }
  }, [filteredServices]);

  // If there are departments, one must be selected; if none exist, allow submission anyway
  const needsDept = departments.length > 0;
  const canSubmit = !submitting && (!needsDept || !!selectedDeptId);

  const handleSubmit = async () => {
    if (!officeId || !canSubmit) return;
    const deptId = selectedDeptId || departments[0]?.id || session?.departmentId || '';
    if (!deptId) {
      Alert.alert(t('booking.missingInfo'), t('booking.noDeptFound'));
      return;
    }
    Keyboard.dismiss();
    setSubmitting(true);
    try {
      const result = await Actions.createInHouseTicket({
        officeId,
        departmentId: deptId,
        serviceId: selectedServiceId || undefined,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        visitReason: visitReason.trim() || undefined,
        priority: selectedPriorityId
          ? priorities.find((p) => p.id === selectedPriorityId)?.weight ?? 2
          : 0,
        priorityCategoryId: selectedPriorityId,
      });
      setCreatedTicket(result);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.message ?? t('adminQueue.actionFailed'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewTicket = () => {
    setCreatedTicket(null);
    setCustomerName('');
    setCustomerPhone('');
    setVisitReason('');
    setSelectedPriorityId(null);
    // Keep dept/service selection for quick successive bookings
  };

  // ── Guards ──────────────────────────────────────────────────────
  if (!session) return null;

  if (loadingData) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{t('booking.loadingServices')}</Text>
      </View>
    );
  }

  // ── Success Screen ──────────────────────────────────────────────
  if (createdTicket) {
    return (
      <SuccessView
        ticket={createdTicket}
        customerName={customerName.trim()}
        customerPhone={customerPhone.trim()}
        onNewTicket={handleNewTicket}
        onDone={() => { handleNewTicket(); router.replace('/(operator)/desk'); }}
      />
    );
  }

  // ── Booking Form ────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Department & Service selection */}
        <View style={styles.selectorCard}>
          {/* Department */}
          <View style={styles.selectorSection}>
            <View style={styles.selectorHeader}>
              <View style={[styles.selectorIcon, { backgroundColor: colors.primary + '12' }]}>
                <Ionicons name="grid-outline" size={16} color={colors.primary} />
              </View>
              <Text style={styles.selectorTitle}>{t('booking.dept')}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.pillRow}>
                {departments.map((dept) => {
                  const active = selectedDeptId === dept.id;
                  return (
                    <TouchableOpacity
                      key={dept.id}
                      style={[styles.pill, active && styles.pillActive]}
                      onPress={() => setSelectedDeptId(dept.id)}
                      activeOpacity={0.7}
                    >
                      {active && <Ionicons name="checkmark-circle" size={15} color="#fff" />}
                      <Text style={[styles.pillText, active && styles.pillTextActive]}>
                        {dept.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          {/* Service */}
          {selectedDeptId && filteredServices.length > 0 && (
            <View style={[styles.selectorSection, styles.selectorDivider]}>
              <View style={styles.selectorHeader}>
                <View style={[styles.selectorIcon, { backgroundColor: '#8b5cf6' + '12' }]}>
                  <Ionicons name="pricetag-outline" size={16} color="#8b5cf6" />
                </View>
                <Text style={styles.selectorTitle}>{t('booking.svc')}</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.pillRow}>
                  {filteredServices.map((svc) => {
                    const active = selectedServiceId === svc.id;
                    return (
                      <TouchableOpacity
                        key={svc.id}
                        style={[styles.pill, active && styles.pillActive]}
                        onPress={() => setSelectedServiceId(svc.id)}
                        activeOpacity={0.7}
                      >
                        {active && <Ionicons name="checkmark-circle" size={15} color="#fff" />}
                        <Text style={[styles.pillText, active && styles.pillTextActive]}>
                          {svc.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )}
        </View>

        {/* Customer Name */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t('booking.customerName')}</Text>
          <View style={styles.inputRow}>
            <Ionicons name="person-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.input}
              placeholder={t('booking.customerName')}
              placeholderTextColor={colors.textMuted}
              value={customerName}
              onChangeText={setCustomerName}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>
        </View>

        {/* Phone Number */}
        <View style={styles.fieldGroup}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>{t('booking.phoneNumber')}</Text>
            <View style={styles.whatsappHint}>
              <Ionicons name="logo-whatsapp" size={12} color="#25D366" />
              <Text style={styles.whatsappHintText}>{t('booking.whatsapp')}</Text>
            </View>
          </View>
          <View style={styles.inputRow}>
            <Ionicons name="call-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.input}
              placeholder={t('booking.phonePlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={customerPhone}
              onChangeText={setCustomerPhone}
              keyboardType="phone-pad"
              returnKeyType="next"
            />
          </View>
        </View>

        {/* Visit Reason / Notes */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t('booking.visitReason')}</Text>
          <View style={[styles.inputRow, { alignItems: 'flex-start' }]}>
            <Ionicons
              name="chatbubble-outline"
              size={18}
              color={colors.textMuted}
              style={{ marginTop: 2 }}
            />
            <TextInput
              style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
              placeholder={t('booking.reasonPlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={visitReason}
              onChangeText={setVisitReason}
              multiline
              numberOfLines={3}
            />
          </View>
        </View>

        {/* Priority category picker */}
        {priorities.length > 0 && (
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('booking.priorityCustomer')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.pillRow}>
                {/* None option */}
                <TouchableOpacity
                  style={[styles.pill, !selectedPriorityId && styles.pillActive]}
                  onPress={() => setSelectedPriorityId(null)}
                  activeOpacity={0.7}
                >
                  {!selectedPriorityId && <Ionicons name="checkmark-circle" size={15} color="#fff" />}
                  <Text style={[styles.pillText, !selectedPriorityId && styles.pillTextActive]}>
                    {t('common.none', { defaultValue: 'None' })}
                  </Text>
                </TouchableOpacity>
                {priorities.map((p) => {
                  const active = selectedPriorityId === p.id;
                  const color = p.color ?? colors.warning;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[
                        styles.pill,
                        active && { backgroundColor: color, borderColor: color },
                      ]}
                      onPress={() => setSelectedPriorityId(p.id)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name="flag"
                        size={14}
                        color={active ? '#fff' : color}
                      />
                      <Text style={[
                        styles.pillText,
                        active && styles.pillTextActive,
                        !active && { color },
                      ]}>
                        {p.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, !canSubmit && { opacity: 0.5 }]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          activeOpacity={0.8}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="add-circle" size={22} color="#fff" />
              <Text style={styles.submitBtnText}>{t('booking.addToQueue')}</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  loadingText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },

  // Form
  formContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl + spacing.xl,
  },

  // Selector card (dept + service)
  selectorCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    gap: 0,
  },
  selectorSection: {
    gap: spacing.sm,
  },
  selectorDivider: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  selectorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  selectorIcon: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectorTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  pillRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  pillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  pillTextActive: {
    color: '#fff',
    fontWeight: '700',
  },

  // Fields
  fieldGroup: {
    gap: spacing.sm,
  },
  fieldLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 0.5,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  required: {
    color: colors.error,
  },

  // Inputs
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 12 : 0,
  },
  input: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
    paddingVertical: Platform.OS === 'ios' ? 0 : 12,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },

  // WhatsApp hint
  whatsappHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  whatsappHintText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: '#25D366',
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },

  // WhatsApp status on success screen
  waStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  waStatusTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  waStatusSub: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },

  // Priority toggle
  priorityToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  priorityToggleActive: {
    borderColor: colors.warning + '50',
    backgroundColor: colors.warning + '08',
  },
  priorityToggleText: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  toggleSwitch: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.border,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleSwitchActive: {
    backgroundColor: colors.warning,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  toggleKnobActive: {
    alignSelf: 'flex-end',
  },

  // Submit button
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: borderRadius.xl,
    marginTop: spacing.sm,
  },
  submitBtnText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: '#fff',
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },

  // Success screen
  successContent: {
    padding: spacing.md,
    gap: spacing.md,
    alignItems: 'center',
    paddingTop: spacing.xl,
  },
  successHeader: {
    alignItems: 'center',
    gap: spacing.sm,
    width: '100%',
  },
  successCheckCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.success,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  ticketNumberBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#8b5cf6' + '12',
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  ticketNumberText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#8b5cf6',
    letterSpacing: 1,
  },
  successInfoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
  },
  successInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceSecondary,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: borderRadius.full,
  },
  successInfoText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  qrContainer: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  qrImage: {
    width: 150,
    height: 150,
    borderRadius: borderRadius.lg,
    backgroundColor: '#fff',
  },
  qrHint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: '600',
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  trackLinkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary + '08',
    borderRadius: borderRadius.full,
    paddingVertical: 6,
    paddingHorizontal: 14,
    alignSelf: 'center',
  },
  trackLinkText: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: '600',
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  successBtnRow: {
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
    marginTop: spacing.sm,
  },
  newTicketBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: borderRadius.xl,
  },
  newTicketBtnText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: '#fff',
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  doneBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingVertical: 14,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  doneBtnText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
});
