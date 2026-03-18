import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useOrg } from '@/lib/use-org';
import {
  fetchVirtualCodes,
  createVirtualCode,
  toggleVirtualCode,
  deleteVirtualCode,
} from '@/lib/ticket-actions';
import { supabase } from '@/lib/supabase';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

// ── Types ────────────────────────────────────────────────────────────

interface VirtualCode {
  id: string;
  qr_token: string;
  organization_id: string;
  office_id: string | null;
  department_id: string | null;
  service_id: string | null;
  is_active: boolean;
  created_at: string;
}

interface NameLookup {
  offices: Record<string, string>;
  departments: Record<string, string>;
  services: Record<string, string>;
}

type ScopeLevel = 'business' | 'office' | 'department' | 'service';

interface OfficeOption {
  id: string;
  name: string;
}
interface DepartmentOption {
  id: string;
  name: string;
}
interface ServiceOption {
  id: string;
  name: string;
}

const JOIN_BASE_URL = 'https://qflow-sigma.vercel.app/join';

// ── Helpers ──────────────────────────────────────────────────────────

function getScopeLevel(code: VirtualCode): ScopeLevel {
  if (code.service_id) return 'service';
  if (code.department_id) return 'department';
  if (code.office_id) return 'office';
  return 'business';
}

function getScopeLabel(level: ScopeLevel): string {
  switch (level) {
    case 'business':
      return 'Business';
    case 'office':
      return 'Office';
    case 'department':
      return 'Department';
    case 'service':
      return 'Service';
  }
}

function getScopeColor(level: ScopeLevel): string {
  switch (level) {
    case 'business':
      return colors.primary;
    case 'office':
      return colors.info;
    case 'department':
      return colors.warning;
    case 'service':
      return colors.success;
  }
}

function getScopeDetail(code: VirtualCode, names: NameLookup): string {
  const parts: string[] = [];
  if (code.office_id && names.offices[code.office_id]) {
    parts.push(names.offices[code.office_id]);
  }
  if (code.department_id && names.departments[code.department_id]) {
    parts.push(names.departments[code.department_id]);
  }
  if (code.service_id && names.services[code.service_id]) {
    parts.push(names.services[code.service_id]);
  }
  return parts.join(' > ') || 'All locations';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ── Component ────────────────────────────────────────────────────────

export default function VirtualCodesScreen() {
  const { orgId, loading: orgLoading } = useOrg();

  const [codes, setCodes] = useState<VirtualCode[]>([]);
  const [names, setNames] = useState<NameLookup>({ offices: {}, departments: {}, services: {} });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [qrModalCode, setQrModalCode] = useState<VirtualCode | null>(null);

  // Create modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [scope, setScope] = useState<ScopeLevel>('business');
  const [selectedOffice, setSelectedOffice] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Cascading dropdown options
  const [offices, setOffices] = useState<OfficeOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  // ── Load codes & names ──────────────────────────────────────────

  const loadCodes = useCallback(async () => {
    if (!orgId) return;
    try {
      const data = await fetchVirtualCodes(orgId);
      setCodes(data);

      // Collect unique IDs for name lookups
      const officeIds = [...new Set(data.map((c: VirtualCode) => c.office_id).filter(Boolean))] as string[];
      const deptIds = [...new Set(data.map((c: VirtualCode) => c.department_id).filter(Boolean))] as string[];
      const serviceIds = [...new Set(data.map((c: VirtualCode) => c.service_id).filter(Boolean))] as string[];

      const lookup: NameLookup = { offices: {}, departments: {}, services: {} };

      if (officeIds.length > 0) {
        const { data: officeRows } = await supabase
          .from('offices')
          .select('id, name')
          .in('id', officeIds);
        officeRows?.forEach((o) => {
          lookup.offices[o.id] = o.name;
        });
      }
      if (deptIds.length > 0) {
        const { data: deptRows } = await supabase
          .from('departments')
          .select('id, name')
          .in('id', deptIds);
        deptRows?.forEach((d) => {
          lookup.departments[d.id] = d.name;
        });
      }
      if (serviceIds.length > 0) {
        const { data: serviceRows } = await supabase
          .from('services')
          .select('id, name')
          .in('id', serviceIds);
        serviceRows?.forEach((s) => {
          lookup.services[s.id] = s.name;
        });
      }

      setNames(lookup);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to load virtual codes');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (orgId) loadCodes();
  }, [orgId, loadCodes]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadCodes();
  }, [loadCodes]);

  // ── Load offices for modal ──────────────────────────────────────

  const loadOffices = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from('offices')
      .select('id, name')
      .eq('organization_id', orgId)
      .order('name');
    setOffices(data ?? []);
  }, [orgId]);

  const loadDepartments = useCallback(async (officeId: string) => {
    const { data } = await supabase
      .from('departments')
      .select('id, name')
      .eq('office_id', officeId)
      .order('name');
    setDepartments(data ?? []);
  }, []);

  const loadServices = useCallback(async (departmentId: string) => {
    const { data } = await supabase
      .from('services')
      .select('id, name')
      .eq('department_id', departmentId)
      .order('name');
    setServices(data ?? []);
  }, []);

  // Reset cascade on scope change
  useEffect(() => {
    setSelectedOffice(null);
    setSelectedDept(null);
    setSelectedService(null);
    setDepartments([]);
    setServices([]);
  }, [scope]);

  // Load departments when office selected
  useEffect(() => {
    if (selectedOffice && (scope === 'department' || scope === 'service')) {
      setSelectedDept(null);
      setSelectedService(null);
      setServices([]);
      loadDepartments(selectedOffice);
    }
  }, [selectedOffice, scope, loadDepartments]);

  // Load services when department selected
  useEffect(() => {
    if (selectedDept && scope === 'service') {
      setSelectedService(null);
      loadServices(selectedDept);
    }
  }, [selectedDept, scope, loadServices]);

  // ── Actions ─────────────────────────────────────────────────────

  const handleCopy = async (code: VirtualCode) => {
    const url = `${JOIN_BASE_URL}/${code.qr_token}`;
    await Clipboard.setStringAsync(url);
    setCopiedId(code.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleToggle = async (code: VirtualCode) => {
    try {
      await toggleVirtualCode(code.id, !code.is_active);
      setCodes((prev) =>
        prev.map((c) => (c.id === code.id ? { ...c, is_active: !c.is_active } : c))
      );
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to toggle code');
    }
  };

  const handleDelete = (code: VirtualCode) => {
    Alert.alert(
      'Delete Virtual Code',
      'Are you sure you want to delete this virtual code? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteVirtualCode(code.id);
              setCodes((prev) => prev.filter((c) => c.id !== code.id));
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to delete code');
            }
          },
        },
      ]
    );
  };

  const handleCreate = async () => {
    if (!orgId) return;

    // Validate selections based on scope
    if (scope !== 'business' && !selectedOffice) {
      Alert.alert('Validation', 'Please select an office.');
      return;
    }
    if ((scope === 'department' || scope === 'service') && !selectedDept) {
      Alert.alert('Validation', 'Please select a department.');
      return;
    }
    if (scope === 'service' && !selectedService) {
      Alert.alert('Validation', 'Please select a service.');
      return;
    }

    setCreating(true);
    try {
      await createVirtualCode({
        organization_id: orgId,
        office_id: scope !== 'business' ? selectedOffice : null,
        department_id: scope === 'department' || scope === 'service' ? selectedDept : null,
        service_id: scope === 'service' ? selectedService : null,
      });
      setModalVisible(false);
      setScope('business');
      await loadCodes();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create virtual code');
    } finally {
      setCreating(false);
    }
  };

  const openCreateModal = () => {
    setScope('business');
    setSelectedOffice(null);
    setSelectedDept(null);
    setSelectedService(null);
    loadOffices();
    setModalVisible(true);
  };

  // ── Render card ─────────────────────────────────────────────────

  const renderCard = ({ item }: { item: VirtualCode }) => {
    const level = getScopeLevel(item);
    const scopeColor = getScopeColor(level);
    const joinUrl = `${JOIN_BASE_URL}/${item.qr_token}`;
    const isCopied = copiedId === item.id;

    return (
      <View style={styles.card}>
        {/* Header row */}
        <View style={styles.cardHeader}>
          <View style={[styles.scopeBadge, { backgroundColor: scopeColor + '18' }]}>
            <Text style={[styles.scopeBadgeText, { color: scopeColor }]}>
              {getScopeLabel(level)}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: item.is_active ? colors.successLight : colors.errorLight,
              },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                { backgroundColor: item.is_active ? colors.success : colors.error },
              ]}
            />
            <Text
              style={[
                styles.statusText,
                { color: item.is_active ? colors.success : colors.error },
              ]}
            >
              {item.is_active ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>

        {/* Scope detail */}
        <Text style={styles.scopeDetail}>{getScopeDetail(item, names)}</Text>

        {/* Show QR button */}
        <TouchableOpacity
          style={styles.qrToggle}
          onPress={() => setQrModalCode(item)}
          activeOpacity={0.7}
        >
          <Ionicons name="qr-code-outline" size={16} color={colors.primary} />
          <Text style={styles.qrToggleText}>Show QR Code</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </TouchableOpacity>

        {/* Join URL */}
        <View style={styles.urlRow}>
          <Ionicons name="link-outline" size={14} color={colors.textMuted} />
          <Text style={styles.urlText} numberOfLines={1} ellipsizeMode="middle">
            {joinUrl}
          </Text>
        </View>

        {/* Created date */}
        <Text style={styles.dateText}>Created {formatDate(item.created_at)}</Text>

        {/* Actions */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionButton, isCopied && styles.actionButtonCopied]}
            onPress={() => handleCopy(item)}
          >
            <Ionicons
              name={isCopied ? 'checkmark-outline' : 'copy-outline'}
              size={16}
              color={isCopied ? colors.success : colors.primary}
            />
            <Text
              style={[
                styles.actionButtonText,
                { color: isCopied ? colors.success : colors.primary },
              ]}
            >
              {isCopied ? 'Copied!' : 'Copy URL'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleToggle(item)}
          >
            <Ionicons
              name={item.is_active ? 'pause-outline' : 'play-outline'}
              size={16}
              color={item.is_active ? colors.warning : colors.success}
            />
            <Text
              style={[
                styles.actionButtonText,
                { color: item.is_active ? colors.warning : colors.success },
              ]}
            >
              {item.is_active ? 'Deactivate' : 'Activate'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleDelete(item)}
          >
            <Ionicons name="trash-outline" size={16} color={colors.error} />
            <Text style={[styles.actionButtonText, { color: colors.error }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ── Render scope option (for modal) ─────────────────────────────

  const renderScopeOption = (level: ScopeLevel) => {
    const isSelected = scope === level;
    return (
      <TouchableOpacity
        key={level}
        style={[styles.scopeOption, isSelected && styles.scopeOptionSelected]}
        onPress={() => setScope(level)}
      >
        <Text
          style={[
            styles.scopeOptionText,
            isSelected && styles.scopeOptionTextSelected,
          ]}
        >
          {getScopeLabel(level)}
        </Text>
      </TouchableOpacity>
    );
  };

  // ── Render picker options ───────────────────────────────────────

  const renderPickerOptions = (
    label: string,
    options: { id: string; name: string }[],
    selected: string | null,
    onSelect: (id: string) => void
  ) => (
    <View style={styles.pickerSection}>
      <Text style={styles.pickerLabel}>{label}</Text>
      {options.length === 0 ? (
        <Text style={styles.pickerEmpty}>No options available</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pickerScroll}
        >
          {options.map((opt) => {
            const isSelected = selected === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.pickerChip, isSelected && styles.pickerChipSelected]}
                onPress={() => onSelect(opt.id)}
              >
                <Text
                  style={[
                    styles.pickerChipText,
                    isSelected && styles.pickerChipTextSelected,
                  ]}
                >
                  {opt.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );

  // ── Loading state ───────────────────────────────────────────────

  if (orgLoading || loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Main render ─────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Virtual QR Codes</Text>
        <Text style={styles.headerSubtitle}>
          {codes.length} code{codes.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* List */}
      <FlatList
        data={codes}
        keyExtractor={(item) => item.id}
        renderItem={renderCard}
        contentContainerStyle={[
          styles.list,
          codes.length === 0 && styles.listEmpty,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="qr-code-outline" size={64} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No Virtual Codes</Text>
            <Text style={styles.emptySubtitle}>
              Create a virtual QR code to let customers join your queue remotely.
            </Text>
            <TouchableOpacity style={styles.emptyButton} onPress={openCreateModal}>
              <Ionicons name="add-outline" size={20} color={colors.surface} />
              <Text style={styles.emptyButtonText}>Create Code</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* FAB */}
      {codes.length > 0 && (
        <TouchableOpacity style={styles.fab} onPress={openCreateModal} activeOpacity={0.8}>
          <Ionicons name="add" size={28} color={colors.surface} />
        </TouchableOpacity>
      )}

      {/* QR Code Popup Modal */}
      <Modal
        visible={!!qrModalCode}
        animationType="fade"
        transparent
        onRequestClose={() => setQrModalCode(null)}
      >
        <TouchableOpacity
          style={styles.qrOverlay}
          activeOpacity={1}
          onPress={() => setQrModalCode(null)}
        >
          <View style={styles.qrPopup}>
            <View style={styles.qrPopupHeader}>
              <Text style={styles.qrPopupTitle}>
                {qrModalCode ? getScopeDetail(qrModalCode, names) : ''}
              </Text>
              <TouchableOpacity onPress={() => setQrModalCode(null)}>
                <Ionicons name="close-circle" size={28} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {qrModalCode && (
              <View style={styles.qrPopupBody}>
                <Image
                  source={{
                    uri: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(`${JOIN_BASE_URL}/${qrModalCode.qr_token}`)}`,
                  }}
                  style={styles.qrPopupImage}
                  resizeMode="contain"
                />
                <Text style={styles.qrPopupHint}>Scan to join queue</Text>
                <Text style={styles.qrPopupUrl} numberOfLines={1} ellipsizeMode="middle">
                  {JOIN_BASE_URL}/{qrModalCode.qr_token}
                </Text>
                <TouchableOpacity
                  style={styles.qrPopupCopy}
                  onPress={() => {
                    handleCopy(qrModalCode);
                  }}
                >
                  <Ionicons
                    name={copiedId === qrModalCode.id ? 'checkmark-outline' : 'copy-outline'}
                    size={18}
                    color="#fff"
                  />
                  <Text style={styles.qrPopupCopyText}>
                    {copiedId === qrModalCode.id ? 'Copied!' : 'Copy Link'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Create Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Virtual Code</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView
            style={styles.modalBody}
            contentContainerStyle={styles.modalBodyContent}
          >
            {/* Scope picker */}
            <Text style={styles.sectionLabel}>Scope</Text>
            <View style={styles.scopeRow}>
              {(['business', 'office', 'department', 'service'] as ScopeLevel[]).map(
                renderScopeOption
              )}
            </View>

            {/* Cascading selectors */}
            {scope !== 'business' &&
              renderPickerOptions('Office', offices, selectedOffice, setSelectedOffice)}

            {(scope === 'department' || scope === 'service') &&
              selectedOffice &&
              renderPickerOptions('Department', departments, selectedDept, setSelectedDept)}

            {scope === 'service' &&
              selectedDept &&
              renderPickerOptions('Service', services, selectedService, setSelectedService)}
          </ScrollView>

          {/* Create button */}
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.createButton, creating && styles.createButtonDisabled]}
              onPress={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator size="small" color={colors.surface} />
              ) : (
                <>
                  <Ionicons name="qr-code-outline" size={20} color={colors.surface} />
                  <Text style={styles.createButtonText}>Create Virtual Code</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },

  // Header
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },

  // List
  list: {
    padding: spacing.md,
    paddingBottom: 100,
  },
  listEmpty: {
    flexGrow: 1,
  },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  scopeBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  scopeBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  scopeDetail: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.xs,
  },
  urlText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    flex: 1,
  },
  dateText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  qrToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  qrToggleText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
    flex: 1,
  },
  // QR Popup Modal
  qrOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  qrPopup: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    width: '100%',
    maxWidth: 340,
    overflow: 'hidden',
  },
  qrPopupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  qrPopupTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  qrPopupBody: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  qrPopupImage: {
    width: 240,
    height: 240,
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
  },
  qrPopupHint: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  qrPopupUrl: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.xs,
    maxWidth: '90%',
  },
  qrPopupCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.full,
    marginTop: spacing.md,
  },
  qrPopupCopyText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: '#fff',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: spacing.md,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background,
  },
  actionButtonCopied: {
    backgroundColor: colors.successLight,
  },
  actionButtonText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  emptyButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.surface,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: spacing.xl,
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  modalBody: {
    flex: 1,
  },
  modalBodyContent: {
    padding: spacing.lg,
  },
  modalFooter: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  // Scope picker
  sectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  scopeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    flexWrap: 'wrap',
  },
  scopeOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  scopeOptionSelected: {
    backgroundColor: colors.primary + '10',
    borderColor: colors.primary,
  },
  scopeOptionText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  scopeOptionTextSelected: {
    color: colors.primary,
  },

  // Picker
  pickerSection: {
    marginBottom: spacing.lg,
  },
  pickerLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  pickerEmpty: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  pickerScroll: {
    gap: spacing.sm,
  },
  pickerChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  pickerChipSelected: {
    backgroundColor: colors.primary + '10',
    borderColor: colors.primary,
  },
  pickerChipText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.text,
  },
  pickerChipTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },

  // Create button
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  createButtonDisabled: {
    opacity: 0.7,
  },
  createButtonText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.surface,
  },
});
