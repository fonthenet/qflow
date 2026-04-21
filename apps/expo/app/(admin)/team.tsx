import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { STAFF_ROLES, STAFF_ROLE_LABELS } from '@qflo/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { API_BASE_URL } from '@/lib/config';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

type StaffRole = typeof STAFF_ROLES[keyof typeof STAFF_ROLES];

interface StaffMember {
  id: string;
  auth_user_id: string | null;
  email: string;
  full_name: string;
  role: string;
  office_id: string | null;
  department_id: string | null;
  organization_id: string;
  is_active: boolean | null;
}

interface Office { id: string; name: string; }
interface Department { id: string; name: string; office_id: string | null; }

const ROLE_ORDER: StaffRole[] = [
  STAFF_ROLES.ADMIN,
  STAFF_ROLES.MANAGER,
  STAFF_ROLES.BRANCH_ADMIN,
  STAFF_ROLES.RECEPTIONIST,
  STAFF_ROLES.DESK_OPERATOR,
  STAFF_ROLES.FLOOR_MANAGER,
  STAFF_ROLES.ANALYST,
  STAFF_ROLES.AGENT,
];

const ADMIN_LIKE = ['admin', 'manager', 'branch_admin'];

export default function TeamScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, staffRole } = useAuth();

  const [loading, setLoading] = useState(true);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetBusyId, setResetBusyId] = useState<string | null>(null);

  // Form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sendSetupEmail, setSendSetupEmail] = useState(true);
  const [role, setRole] = useState<string>(STAFF_ROLES.DESK_OPERATOR);
  const [officeId, setOfficeId] = useState<string>('');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [isActive, setIsActive] = useState(true);

  type EmailCheck = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
  const [emailCheck, setEmailCheck] = useState<EmailCheck>('idle');
  const emailCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAllowed = !!staffRole && ADMIN_LIKE.includes(staffRole);

  const loadAll = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const { data: me } = await supabase
        .from('staff')
        .select('organization_id')
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (!me?.organization_id) throw new Error(t('team.failedLoad'));
      const orgId = me.organization_id as string;
      setOrganizationId(orgId);

      const [staffRes, officesRes, deptRes] = await Promise.all([
        supabase
          .from('staff')
          .select('id, auth_user_id, email, full_name, role, office_id, department_id, organization_id, is_active')
          .eq('organization_id', orgId)
          .order('full_name', { ascending: true }),
        supabase.from('offices').select('id, name').eq('organization_id', orgId).eq('is_active', true).order('name'),
        supabase.from('departments').select('id, name, office_id').eq('organization_id', orgId).order('name'),
      ]);

      if (staffRes.error) throw staffRes.error;
      setStaff((staffRes.data ?? []) as StaffMember[]);
      setOffices((officesRes.data ?? []) as Office[]);
      setDepartments((deptRes.data ?? []) as Department[]);
    } catch (e: any) {
      setError(e?.message ?? t('team.failedLoad'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAllowed) { setLoading(false); return; }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isAllowed]);

  // Real-time email availability check
  useEffect(() => {
    if (editing || !organizationId) { setEmailCheck('idle'); return; }
    if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setEmailCheck('idle'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setEmailCheck('invalid'); return; }
    setEmailCheck('checking');
    emailCheckTimer.current = setTimeout(async () => {
      try {
        const { data, error: qErr } = await supabase
          .from('staff')
          .select('id')
          .eq('organization_id', organizationId)
          .ilike('email', trimmed)
          .limit(1);
        if (qErr) { setEmailCheck('idle'); return; }
        setEmailCheck((data && data.length > 0) ? 'taken' : 'available');
      } catch {
        setEmailCheck('idle');
      }
    }, 500);
    return () => { if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current); };
  }, [email, editing, organizationId]);

  const availableDepartments = useMemo(
    () => officeId ? departments.filter(d => d.office_id === officeId) : departments,
    [departments, officeId]
  );

  const openCreate = () => {
    setEditing(null);
    setFullName(''); setEmail(''); setPassword('');
    setSendSetupEmail(true);
    setRole(STAFF_ROLES.DESK_OPERATOR);
    setOfficeId(''); setDepartmentId('');
    setIsActive(true);
    setEmailCheck('idle');
    setError(null); setSuccess(null);
    setShowForm(true);
  };

  const openEdit = (m: StaffMember) => {
    setEditing(m);
    setFullName(m.full_name || ''); setEmail(m.email || ''); setPassword('');
    setSendSetupEmail(false);
    setRole(m.role);
    setOfficeId(m.office_id ?? ''); setDepartmentId(m.department_id ?? '');
    setIsActive(m.is_active !== false);
    setEmailCheck('idle');
    setError(null); setSuccess(null);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (saving || !user || !organizationId) return;
    if (!editing && emailCheck === 'taken') {
      setError(t('team.emailTaken')); return;
    }
    if (!editing && emailCheck === 'invalid') {
      setError(t('team.emailInvalid')); return;
    }
    if (!editing && (!password || password.length < 6)) {
      setError(t('team.passwordMin')); return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        const { error: upErr } = await supabase.from('staff').update({
          full_name: fullName.trim(),
          role,
          office_id: officeId || null,
          department_id: departmentId || null,
          is_active: isActive,
        }).eq('id', editing.id);
        if (upErr) throw upErr;
        setSuccess(t('team.memberUpdated'));
      } else {
        const res = await fetch(`${API_BASE_URL}/api/create-staff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            password,
            full_name: fullName.trim(),
            role,
            organization_id: organizationId,
            office_id: officeId || undefined,
            department_id: departmentId || undefined,
            caller_user_id: user.id,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({} as any));
          throw new Error(body?.error || `Request failed (${res.status})`);
        }
        if (sendSetupEmail) {
          try {
            await supabase.auth.resetPasswordForEmail(email.trim(), {
              redirectTo: `${API_BASE_URL}/auth/update-password`,
            });
          } catch {}
        }
        setSuccess(t('team.memberAdded'));
      }
      setShowForm(false);
      setEditing(null);
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? t('team.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleSendReset = async (m: StaffMember) => {
    setResetBusyId(m.id);
    setError(null); setSuccess(null);
    try {
      const { error: rErr } = await supabase.auth.resetPasswordForEmail(m.email, {
        redirectTo: `${API_BASE_URL}/auth/update-password`,
      });
      if (rErr) throw rErr;
      setSuccess(t('team.resetSent', { email: m.email }));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? t('team.resetFailed'));
    } finally {
      setResetBusyId(null);
    }
  };

  if (!isAllowed) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="lock-closed-outline" size={48} color={colors.textMuted} />
        <Text style={styles.emptyText}>{t('team.onlyAdmins')}</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('team.title')}</Text>
        <TouchableOpacity onPress={openCreate} style={styles.addBtn}>
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {error && <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View>}
      {success && <View style={styles.successBanner}><Text style={styles.successText}>{success}</Text></View>}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {staff.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>{t('team.empty')}</Text>
            </View>
          ) : staff.map(m => {
            const office = offices.find(o => o.id === m.office_id);
            return (
              <View key={m.id} style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{m.full_name}</Text>
                  <Text style={styles.cardEmail}>{m.email}</Text>
                  <View style={styles.badgeRow}>
                    <View style={styles.roleBadge}>
                      <Text style={styles.roleBadgeText}>{STAFF_ROLE_LABELS[m.role as StaffRole] ?? m.role}</Text>
                    </View>
                    {office ? (
                      <View style={styles.locBadge}>
                        <Ionicons name="location" size={10} color={colors.textSecondary} />
                        <Text style={styles.locBadgeText}>{office.name}</Text>
                      </View>
                    ) : null}
                    {!m.is_active ? (
                      <View style={styles.inactiveBadge}>
                        <Text style={styles.inactiveText}>{t('team.inactive')}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <View style={{ gap: 6 }}>
                  <TouchableOpacity onPress={() => openEdit(m)} style={styles.iconBtn}>
                    <Ionicons name="pencil" size={16} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleSendReset(m)}
                    style={styles.iconBtn}
                    disabled={resetBusyId === m.id}
                  >
                    {resetBusyId === m.id
                      ? <ActivityIndicator size="small" color={colors.primary} />
                      : <Ionicons name="mail" size={16} color={colors.primary} />}
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Form Modal */}
      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => !saving && setShowForm(false)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => !saving && setShowForm(false)}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>
              {editing ? t('team.editMember') : t('team.addMember')}
            </Text>
            <TouchableOpacity onPress={handleSubmit} disabled={saving}>
              <Text style={[styles.saveText, saving && { opacity: 0.5 }]}>
                {saving ? t('common.saving') : editing ? t('common.save') : t('team.create')}
              </Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
            {error && <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View>}

            <Text style={styles.label}>{t('team.fullName')}</Text>
            <TextInput style={styles.input} value={fullName} onChangeText={setFullName} autoCapitalize="words" />

            <Text style={styles.label}>{t('team.email')}</Text>
            <TextInput
              style={[
                styles.input,
                emailCheck === 'taken' || emailCheck === 'invalid' ? { borderColor: colors.error } :
                emailCheck === 'available' ? { borderColor: colors.success } : null,
                editing ? { opacity: 0.6 } : null,
              ]}
              value={email}
              onChangeText={setEmail}
              editable={!editing}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
            />
            {!editing && emailCheck !== 'idle' && (
              <Text style={[
                styles.helper,
                emailCheck === 'available' ? { color: colors.success } :
                (emailCheck === 'taken' || emailCheck === 'invalid') ? { color: colors.error } : null,
              ]}>
                {emailCheck === 'checking' ? t('team.checking')
                  : emailCheck === 'available' ? '✓ ' + t('team.emailAvailable')
                  : emailCheck === 'taken' ? '✗ ' + t('team.emailTaken')
                  : emailCheck === 'invalid' ? '✗ ' + t('team.emailInvalid')
                  : ''}
              </Text>
            )}

            {!editing && (
              <>
                <Text style={styles.label}>{t('team.tempPassword')}</Text>
                <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.switchLabel}>{t('team.sendSetupEmail')}</Text>
                    <Text style={styles.helper}>{t('team.sendSetupHelp')}</Text>
                  </View>
                  <Switch value={sendSetupEmail} onValueChange={setSendSetupEmail} />
                </View>
              </>
            )}

            <Text style={styles.label}>{t('team.role')}</Text>
            <View style={styles.chipRow}>
              {ROLE_ORDER.map(r => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setRole(r)}
                  style={[styles.chip, role === r && styles.chipActive]}
                >
                  <Text style={[styles.chipText, role === r && styles.chipTextActive]}>
                    {STAFF_ROLE_LABELS[r]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>{t('team.location')}</Text>
            <View style={styles.chipRow}>
              <TouchableOpacity
                onPress={() => { setOfficeId(''); setDepartmentId(''); }}
                style={[styles.chip, officeId === '' && styles.chipActive]}
              >
                <Text style={[styles.chipText, officeId === '' && styles.chipTextActive]}>{t('team.allLocations')}</Text>
              </TouchableOpacity>
              {offices.map(o => (
                <TouchableOpacity
                  key={o.id}
                  onPress={() => { setOfficeId(o.id); setDepartmentId(''); }}
                  style={[styles.chip, officeId === o.id && styles.chipActive]}
                >
                  <Text style={[styles.chipText, officeId === o.id && styles.chipTextActive]}>{o.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>{t('team.department')}</Text>
            <View style={styles.chipRow}>
              <TouchableOpacity
                onPress={() => setDepartmentId('')}
                style={[styles.chip, departmentId === '' && styles.chipActive]}
              >
                <Text style={[styles.chipText, departmentId === '' && styles.chipTextActive]}>{t('team.noDeptLimit')}</Text>
              </TouchableOpacity>
              {availableDepartments.map(d => (
                <TouchableOpacity
                  key={d.id}
                  onPress={() => setDepartmentId(d.id)}
                  style={[styles.chip, departmentId === d.id && styles.chipActive]}
                >
                  <Text style={[styles.chipText, departmentId === d.id && styles.chipTextActive]}>{d.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.switchRow}>
              <Text style={[styles.switchLabel, { flex: 1 }]}>{t('team.canSignInNow')}</Text>
              <Switch value={isActive} onValueChange={setIsActive} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: 12,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  addBtn: {
    backgroundColor: colors.primary, width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { color: colors.textSecondary, fontSize: fontSize.md },
  saveText: { color: colors.primary, fontSize: fontSize.md, fontWeight: '700' },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: 100 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptyText: { color: colors.textMuted, textAlign: 'center' },
  card: {
    flexDirection: 'row', backgroundColor: colors.surface,
    borderRadius: borderRadius.lg, padding: spacing.md, gap: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  cardName: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  cardEmail: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  roleBadge: { backgroundColor: colors.primary + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: borderRadius.full },
  roleBadgeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  locBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: borderRadius.full },
  locBadgeText: { fontSize: fontSize.xs, color: colors.textSecondary },
  inactiveBadge: { backgroundColor: colors.error + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: borderRadius.full },
  inactiveText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.error },
  iconBtn: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  errorBanner: { backgroundColor: colors.error + '15', padding: spacing.sm, margin: spacing.md, borderRadius: borderRadius.md },
  errorText: { color: colors.error, fontSize: fontSize.sm },
  successBanner: { backgroundColor: colors.success + '15', padding: spacing.sm, margin: spacing.md, borderRadius: borderRadius.md },
  successText: { color: colors.success, fontSize: fontSize.sm },
  formContent: { padding: spacing.md, gap: spacing.xs, paddingBottom: 200 },
  label: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: 10,
    fontSize: fontSize.md, color: colors.text,
  },
  helper: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  switchLabel: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: '#fff' },
  primaryBtn: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderRadius: borderRadius.md,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
});
