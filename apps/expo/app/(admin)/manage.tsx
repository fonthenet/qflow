import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOrg } from '@/lib/use-org';
import * as Actions from '@/lib/ticket-actions';
import { supabase } from '@/lib/supabase';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

// ── Types ────────────────────────────────────────────────────────────

type ManageTab = 'offices' | 'staff' | 'desks' | 'departments' | 'services' | 'priorities' | 'customers';

interface StaffRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  office_id: string | null;
  offices: { name: string } | null;
}
interface DeskRow {
  id: string;
  name: string;
  status: string;
  is_active: boolean;
  current_staff_id: string | null;
  office_id: string;
  department_id: string | null;
  offices: { name: string } | null;
  departments: { name: string } | null;
}
interface OfficeRow {
  id: string;
  name: string;
  address: string | null;
  timezone: string | null;
  is_active: boolean;
}
interface DeptRow {
  id: string;
  name: string;
  code: string;
  office_id: string;
}
interface ServiceRow {
  id: string;
  name: string;
  code: string;
  office_id: string;
  department_id: string;
  departments: { name: string } | null;
}
interface PriorityRow {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  weight: number;
  is_active: boolean;
}
interface CustomerRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  visit_count: number;
  last_visit: string | null;
}

// ── Tab Configuration ────────────────────────────────────────────────

const TABS: { key: ManageTab; label: string; icon: string }[] = [
  { key: 'offices', label: 'Offices', icon: 'location' },
  { key: 'staff', label: 'Staff', icon: 'people' },
  { key: 'desks', label: 'Desks', icon: 'desktop' },
  { key: 'departments', label: 'Depts', icon: 'git-branch' },
  { key: 'services', label: 'Services', icon: 'layers' },
  { key: 'priorities', label: 'Priority', icon: 'flag' },
  { key: 'customers', label: 'Clients', icon: 'person-outline' },
];

const STAFF_ROLES = ['admin', 'manager', 'desk_operator', 'receptionist', 'floor_manager'] as const;

// ── Main Component ───────────────────────────────────────────────────

export default function ManageScreen() {
  const { orgId, officeIds } = useOrg();
  const [tab, setTab] = useState<ManageTab>('offices');

  // Data lists
  const [staffList, setStaffList] = useState<StaffRow[]>([]);
  const [deskList, setDeskList] = useState<DeskRow[]>([]);
  const [officeList, setOfficeList] = useState<OfficeRow[]>([]);
  const [deptList, setDeptList] = useState<DeptRow[]>([]);
  const [serviceList, setServiceList] = useState<ServiceRow[]>([]);
  const [priorityList, setPriorityList] = useState<PriorityRow[]>([]);
  const [customerList, setCustomerList] = useState<CustomerRow[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  // Picker sub-modal state
  const [pickerField, setPickerField] = useState<string | null>(null);
  const [pickerOptions, setPickerOptions] = useState<{ label: string; value: string }[]>([]);

  // ── Data Loading ─────────────────────────────────────────────────

  useEffect(() => {
    if (orgId) loadTab();
  }, [tab, orgId, officeIds.length]);

  const loadTab = useCallback(async () => {
    if (!orgId) return;

    try {
      switch (tab) {
        case 'offices': {
          const { data } = await supabase
            .from('offices')
            .select('id, name, address, timezone, is_active')
            .eq('organization_id', orgId)
            .order('name');
          setOfficeList((data as unknown as OfficeRow[]) ?? []);
          break;
        }
        case 'staff': {
          const { data } = await supabase
            .from('staff')
            .select('id, full_name, email, role, is_active, office_id, offices:office_id(name)')
            .eq('organization_id', orgId)
            .order('full_name');
          setStaffList((data as unknown as StaffRow[]) ?? []);
          break;
        }
        case 'desks': {
          if (officeIds.length === 0) break;
          const { data } = await supabase
            .from('desks')
            .select('id, name, status, is_active, current_staff_id, office_id, department_id, offices:office_id(name), departments:department_id(name)')
            .in('office_id', officeIds)
            .order('name');
          setDeskList((data as unknown as DeskRow[]) ?? []);
          break;
        }
        case 'departments': {
          if (officeIds.length === 0) break;
          const { data } = await supabase
            .from('departments')
            .select('id, name, code, office_id')
            .in('office_id', officeIds)
            .order('name');
          setDeptList((data as unknown as DeptRow[]) ?? []);
          break;
        }
        case 'services': {
          if (officeIds.length === 0) break;
          const { data } = await supabase
            .from('services')
            .select('id, name, code, office_id, department_id, departments:department_id(name)')
            .in('office_id', officeIds)
            .order('name');
          setServiceList((data as unknown as ServiceRow[]) ?? []);
          break;
        }
        case 'priorities': {
          const { data } = await supabase
            .from('priority_categories')
            .select('id, name, icon, color, weight, is_active')
            .eq('organization_id', orgId)
            .order('weight', { ascending: false });
          setPriorityList((data as unknown as PriorityRow[]) ?? []);
          break;
        }
        case 'customers': {
          if (officeIds.length === 0) break;
          const { data } = await supabase
            .from('tickets')
            .select('customer_data, created_at')
            .in('office_id', officeIds)
            .not('customer_data', 'is', null)
            .order('created_at', { ascending: false })
            .limit(200);

          const grouped = new Map<string, CustomerRow>();
          (data ?? []).forEach((t: any) => {
            const cd = t.customer_data || {};
            const name = cd.name || null;
            const phone = cd.phone || null;
            const email = cd.email || null;
            const key = phone || email || name || 'anonymous';

            if (customerSearch.trim()) {
              const s = customerSearch.trim().toLowerCase();
              if (
                !(
                  name?.toLowerCase().includes(s) ||
                  phone?.toLowerCase().includes(s) ||
                  email?.toLowerCase().includes(s)
                )
              )
                return;
            }

            const existing = grouped.get(key);
            if (existing) {
              existing.visit_count++;
              if (!existing.last_visit || t.created_at > existing.last_visit) existing.last_visit = t.created_at;
            } else {
              grouped.set(key, { id: key, name, phone, email, visit_count: 1, last_visit: t.created_at });
            }
          });
          setCustomerList(Array.from(grouped.values()).sort((a, b) => b.visit_count - a.visit_count));
          break;
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to load data');
    }
  }, [tab, orgId, officeIds, customerSearch]);

  // ── Toggle Helpers ───────────────────────────────────────────────

  const toggleStaffActive = async (staffId: string, currentlyActive: boolean) => {
    try {
      await Actions.updateStaff(staffId, { is_active: !currentlyActive });
      loadTab();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const toggleDeskActive = async (deskId: string, currentlyActive: boolean) => {
    try {
      await Actions.updateDesk(deskId, { is_active: !currentlyActive });
      loadTab();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const toggleOfficeActive = async (officeId: string, currentlyActive: boolean) => {
    try {
      await Actions.updateOffice(officeId, { is_active: !currentlyActive });
      loadTab();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const togglePriorityActive = async (priorityId: string, currentlyActive: boolean) => {
    try {
      await Actions.updatePriority(priorityId, { is_active: !currentlyActive });
      loadTab();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  // ── Refresh ──────────────────────────────────────────────────────

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadTab();
    setRefreshing(false);
  };

  // ── Modal Helpers ────────────────────────────────────────────────

  const openCreate = () => {
    setEditingItem(null);
    setFormData({});
    setShowModal(true);
  };

  const openEdit = (item: any) => {
    setEditingItem(item);
    switch (tab) {
      case 'offices':
        setFormData({ name: item.name, address: item.address || '', timezone: item.timezone || '' });
        break;
      case 'staff':
        setFormData({
          full_name: item.full_name,
          email: item.email,
          role: item.role,
          office_id: item.office_id || '',
          office_name: (item.offices as any)?.name || '',
        });
        break;
      case 'desks':
        setFormData({
          name: item.name,
          office_id: item.office_id || '',
          office_name: (item.offices as any)?.name || '',
          department_id: item.department_id || '',
          department_name: (item.departments as any)?.name || '',
        });
        break;
      case 'departments':
        setFormData({ name: item.name, code: item.code, office_id: item.office_id || '', office_name: '' });
        break;
      case 'services':
        setFormData({
          name: item.name,
          code: item.code,
          office_id: item.office_id || '',
          office_name: '',
          department_id: item.department_id || '',
          department_name: (item.departments as any)?.name || '',
        });
        break;
      case 'priorities':
        setFormData({
          name: item.name,
          icon: item.icon || '',
          color: item.color || '',
          weight: String(item.weight ?? 1),
        });
        break;
      default:
        break;
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData({});
    setPickerField(null);
  };

  // ── Save (Create / Update) ───────────────────────────────────────

  const handleSave = async () => {
    if (saving || !orgId) return;
    setSaving(true);

    try {
      switch (tab) {
        case 'offices': {
          if (!formData.name?.trim()) throw new Error('Name is required');
          if (editingItem) {
            await Actions.updateOffice(editingItem.id, {
              name: formData.name.trim(),
              address: formData.address?.trim() || null,
              timezone: formData.timezone?.trim() || null,
            });
          } else {
            await Actions.createOffice({
              name: formData.name.trim(),
              organization_id: orgId,
              address: formData.address?.trim(),
              timezone: formData.timezone?.trim(),
            });
          }
          break;
        }
        case 'staff': {
          if (!formData.full_name?.trim()) throw new Error('Name is required');
          if (!formData.email?.trim()) throw new Error('Email is required');
          if (!formData.role) throw new Error('Role is required');
          if (editingItem) {
            await Actions.updateStaff(editingItem.id, {
              full_name: formData.full_name.trim(),
              role: formData.role,
              office_id: formData.office_id || null,
            });
          } else {
            await Actions.createStaff({
              full_name: formData.full_name.trim(),
              email: formData.email.trim(),
              role: formData.role,
              organization_id: orgId,
              office_id: formData.office_id || null,
            });
          }
          break;
        }
        case 'desks': {
          if (!formData.name?.trim()) throw new Error('Name is required');
          if (!formData.office_id) throw new Error('Office is required');
          if (editingItem) {
            await Actions.updateDesk(editingItem.id, {
              name: formData.name.trim(),
              department_id: formData.department_id || null,
            });
          } else {
            await Actions.createDesk({
              name: formData.name.trim(),
              office_id: formData.office_id,
              department_id: formData.department_id || null,
            });
          }
          break;
        }
        case 'departments': {
          if (!formData.name?.trim()) throw new Error('Name is required');
          if (!formData.code?.trim()) throw new Error('Code is required');
          if (!formData.office_id) throw new Error('Office is required');
          if (editingItem) {
            await Actions.updateDepartment(editingItem.id, {
              name: formData.name.trim(),
              code: formData.code.trim(),
            });
          } else {
            await Actions.createDepartment({
              name: formData.name.trim(),
              code: formData.code.trim(),
              office_id: formData.office_id,
            });
          }
          break;
        }
        case 'services': {
          if (!formData.name?.trim()) throw new Error('Name is required');
          if (!formData.code?.trim()) throw new Error('Code is required');
          if (!formData.department_id) throw new Error('Department is required');
          if (!formData.office_id) throw new Error('Office is required');
          if (editingItem) {
            await Actions.updateService(editingItem.id, {
              name: formData.name.trim(),
              code: formData.code.trim(),
            });
          } else {
            await Actions.createService({
              name: formData.name.trim(),
              code: formData.code.trim(),
              department_id: formData.department_id,
              office_id: formData.office_id,
            });
          }
          break;
        }
        case 'priorities': {
          if (!formData.name?.trim()) throw new Error('Name is required');
          const weight = parseInt(formData.weight, 10);
          if (editingItem) {
            await Actions.updatePriority(editingItem.id, {
              name: formData.name.trim(),
              icon: formData.icon?.trim() || null,
              color: formData.color?.trim() || null,
              weight: isNaN(weight) ? 1 : weight,
            });
          } else {
            await Actions.createPriority({
              name: formData.name.trim(),
              organization_id: orgId,
              icon: formData.icon?.trim(),
              color: formData.color?.trim(),
              weight: isNaN(weight) ? 1 : weight,
            });
          }
          break;
        }
      }

      closeModal();
      await loadTab();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete Helpers ───────────────────────────────────────────────

  const confirmDeleteDesk = (deskId: string, deskName: string) => {
    Alert.alert('Delete Desk', `Are you sure you want to delete "${deskName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await Actions.deleteDesk(deskId);
            loadTab();
          } catch (err: any) {
            Alert.alert('Error', err.message);
          }
        },
      },
    ]);
  };

  const confirmDeleteDepartment = (deptId: string, deptName: string) => {
    Alert.alert('Delete Department', `Are you sure you want to delete "${deptName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await Actions.deleteDepartment(deptId);
            loadTab();
          } catch (err: any) {
            Alert.alert('Error', err.message);
          }
        },
      },
    ]);
  };

  // ── Picker Helpers ───────────────────────────────────────────────

  const openOfficePicker = () => {
    setPickerOptions(officeList.map((o) => ({ label: o.name, value: o.id })));
    setPickerField('office_id');
  };

  const openRolePicker = () => {
    setPickerOptions(STAFF_ROLES.map((r) => ({ label: r.replace('_', ' '), value: r })));
    setPickerField('role');
  };

  const openDepartmentPicker = () => {
    const selectedOffice = formData.office_id;
    const filtered = selectedOffice ? deptList.filter((d) => d.office_id === selectedOffice) : deptList;
    setPickerOptions(filtered.map((d) => ({ label: `${d.name} (${d.code})`, value: d.id })));
    setPickerField('department_id');
  };

  const handlePickerSelect = (value: string, label: string) => {
    if (!pickerField) return;
    setFormData((prev) => ({
      ...prev,
      [pickerField]: value,
      [pickerField.replace('_id', '_name')]: label,
    }));
    setPickerField(null);
  };

  // ── Ensure office/dept lists are loaded for pickers ──────────────

  useEffect(() => {
    if (!orgId) return;
    // Always keep office list fresh for pickers
    supabase
      .from('offices')
      .select('id, name, address, timezone, is_active')
      .eq('organization_id', orgId)
      .order('name')
      .then(({ data }) => {
        if (data) setOfficeList(data as unknown as OfficeRow[]);
      });
  }, [orgId]);

  useEffect(() => {
    if (officeIds.length === 0) return;
    // Always keep dept list fresh for pickers
    supabase
      .from('departments')
      .select('id, name, code, office_id')
      .in('office_id', officeIds)
      .order('name')
      .then(({ data }) => {
        if (data) setDeptList(data as unknown as DeptRow[]);
      });
  }, [officeIds.length]);

  // ── Swipeable Desk Row ───────────────────────────────────────────

  const DeskSwipeRow = ({ item, children }: { item: DeskRow; children: React.ReactNode }) => {
    const translateX = useRef(new Animated.Value(0)).current;
    const lastDx = useRef(0);

    const onPanStart = () => {
      lastDx.current = 0;
    };

    return (
      <View style={styles.swipeContainer}>
        <TouchableOpacity
          style={styles.swipeDeleteBg}
          onPress={() => confirmDeleteDesk(item.id, item.name)}
          activeOpacity={0.8}
        >
          <Ionicons name="trash" size={22} color="#fff" />
          <Text style={styles.swipeDeleteText}>Delete</Text>
        </TouchableOpacity>
        <Animated.View
          style={{ transform: [{ translateX }] }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={(e) => {
            return Math.abs(e.nativeEvent.locationX) > 5;
          }}
          onResponderGrant={onPanStart}
          onResponderMove={(e) => {
            const dx = e.nativeEvent.pageX - (e.nativeEvent.locationX + (lastDx.current || 0));
            if (dx < 0) {
              translateX.setValue(Math.max(dx, -100));
            }
          }}
          onResponderRelease={() => {
            const currentVal = (translateX as any)._value;
            if (currentVal < -50) {
              Animated.spring(translateX, { toValue: -90, useNativeDriver: true }).start();
            } else {
              Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
            }
          }}
        >
          {children}
        </Animated.View>
      </View>
    );
  };

  // ── Render Tab Content ───────────────────────────────────────────

  const renderContent = () => {
    switch (tab) {
      case 'staff':
        return (
          <FlatList
            data={staffList}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
            ListEmptyComponent={<EmptyState text="No staff members" />}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.card} onPress={() => openEdit(item)} activeOpacity={0.7}>
                <View style={styles.cardMain}>
                  <View style={[styles.avatar, { backgroundColor: item.is_active ? colors.waitingBg : colors.surfaceSecondary }]}>
                    <Ionicons name="person" size={20} color={item.is_active ? colors.primary : colors.textMuted} />
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardTitle}>{item.full_name}</Text>
                    <Text style={styles.cardSubtitle}>{item.email}</Text>
                    <View style={styles.badges}>
                      <Badge label={item.role} color={item.role === 'admin' ? colors.primary : colors.textMuted} />
                      {item.offices && <Badge label={(item.offices as any).name} color={colors.textSecondary} />}
                    </View>
                  </View>
                </View>
                <Switch
                  value={item.is_active}
                  onValueChange={() => toggleStaffActive(item.id, item.is_active)}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={item.is_active ? colors.primary : '#f4f3f4'}
                />
              </TouchableOpacity>
            )}
          />
        );

      case 'desks':
        return (
          <FlatList
            data={deskList}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
            ListEmptyComponent={<EmptyState text="No desks" />}
            renderItem={({ item }) => {
              const statusColor =
                item.status === 'active' ? colors.serving : item.status === 'paused' ? colors.warning : colors.textMuted;
              return (
                <View style={styles.swipeContainer}>
                  <TouchableOpacity
                    style={styles.swipeDeleteBg}
                    onPress={() => confirmDeleteDesk(item.id, item.name)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="trash" size={22} color="#fff" />
                    <Text style={styles.swipeDeleteText}>Delete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.card} onPress={() => openEdit(item)} activeOpacity={0.7}>
                    <View style={styles.cardMain}>
                      <View style={[styles.avatar, { backgroundColor: statusColor + '18' }]}>
                        <Ionicons name="desktop" size={20} color={statusColor} />
                      </View>
                      <View style={styles.cardInfo}>
                        <Text style={styles.cardTitle}>{item.name}</Text>
                        <Text style={styles.cardSubtitle}>
                          {(item.offices as any)?.name ?? ''}
                          {(item.departments as any)?.name ? ` · ${(item.departments as any).name}` : ''}
                        </Text>
                        <View style={styles.badges}>
                          <Badge label={item.status} color={statusColor} />
                          {item.current_staff_id && <Badge label="Staffed" color={colors.success} />}
                        </View>
                      </View>
                    </View>
                    <View style={styles.cardActions}>
                      <Switch
                        value={item.is_active}
                        onValueChange={() => toggleDeskActive(item.id, item.is_active)}
                        trackColor={{ false: colors.border, true: colors.primaryLight }}
                        thumbColor={item.is_active ? colors.primary : '#f4f3f4'}
                      />
                      <TouchableOpacity
                        onPress={() => confirmDeleteDesk(item.id, item.name)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                </View>
              );
            }}
          />
        );

      case 'departments':
        return (
          <FlatList
            data={deptList}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
            ListEmptyComponent={<EmptyState text="No departments" />}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.card}
                onPress={() => openEdit(item)}
                onLongPress={() => confirmDeleteDepartment(item.id, item.name)}
                activeOpacity={0.7}
              >
                <View style={styles.cardMain}>
                  <View style={[styles.avatar, { backgroundColor: colors.waitingBg }]}>
                    <Ionicons name="git-branch" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardTitle}>{item.name}</Text>
                    <View style={styles.badges}>
                      <Badge label={item.code} color={colors.primary} />
                    </View>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => confirmDeleteDepartment(item.id, item.name)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                </TouchableOpacity>
              </TouchableOpacity>
            )}
          />
        );

      case 'services':
        return (
          <FlatList
            data={serviceList}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
            ListEmptyComponent={<EmptyState text="No services" />}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.card} onPress={() => openEdit(item)} activeOpacity={0.7}>
                <View style={styles.cardMain}>
                  <View style={[styles.avatar, { backgroundColor: colors.successLight }]}>
                    <Ionicons name="layers" size={20} color={colors.success} />
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardTitle}>{item.name}</Text>
                    <View style={styles.badges}>
                      <Badge label={item.code} color={colors.success} />
                      {(item.departments as any)?.name && (
                        <Badge label={(item.departments as any).name} color={colors.textSecondary} />
                      )}
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            )}
          />
        );

      case 'offices':
        return (
          <FlatList
            data={officeList}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
            ListEmptyComponent={<EmptyState text="No offices" />}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.card} onPress={() => openEdit(item)} activeOpacity={0.7}>
                <View style={styles.cardMain}>
                  <View
                    style={[styles.avatar, { backgroundColor: item.is_active ? colors.waitingBg : colors.surfaceSecondary }]}
                  >
                    <Ionicons name="location" size={20} color={item.is_active ? colors.primary : colors.textMuted} />
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardTitle}>{item.name}</Text>
                    {item.address && <Text style={styles.cardSubtitle}>{item.address}</Text>}
                    {item.timezone && (
                      <View style={styles.badges}>
                        <Badge label={item.timezone} color={colors.textSecondary} />
                      </View>
                    )}
                  </View>
                </View>
                <Switch
                  value={item.is_active}
                  onValueChange={() => toggleOfficeActive(item.id, item.is_active)}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={item.is_active ? colors.primary : '#f4f3f4'}
                />
              </TouchableOpacity>
            )}
          />
        );

      case 'priorities':
        return (
          <FlatList
            data={priorityList}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
            ListEmptyComponent={<EmptyState text="No priority categories" />}
            renderItem={({ item }) => {
              const displayColor = item.color || colors.textMuted;
              return (
                <TouchableOpacity style={styles.card} onPress={() => openEdit(item)} activeOpacity={0.7}>
                  <View style={styles.cardMain}>
                    <View style={[styles.avatar, { backgroundColor: displayColor + '18' }]}>
                      {item.icon ? (
                        <Text style={{ fontSize: 20 }}>{item.icon}</Text>
                      ) : (
                        <Ionicons name="flag" size={20} color={displayColor} />
                      )}
                    </View>
                    <View style={styles.cardInfo}>
                      <Text style={styles.cardTitle}>{item.name}</Text>
                      <View style={styles.badges}>
                        <Badge label={`Weight: ${item.weight}`} color={displayColor} />
                      </View>
                    </View>
                  </View>
                  <Switch
                    value={item.is_active}
                    onValueChange={() => togglePriorityActive(item.id, item.is_active)}
                    trackColor={{ false: colors.border, true: colors.primaryLight }}
                    thumbColor={item.is_active ? colors.primary : '#f4f3f4'}
                  />
                </TouchableOpacity>
              );
            }}
          />
        );

      case 'customers':
        return (
          <View style={{ flex: 1 }}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by name, phone, or email..."
                placeholderTextColor={colors.textMuted}
                value={customerSearch}
                onChangeText={setCustomerSearch}
                onSubmitEditing={() => loadTab()}
                returnKeyType="search"
              />
              {customerSearch.length > 0 && (
                <TouchableOpacity onPress={() => setCustomerSearch('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <FlatList
              data={customerList}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
              ListEmptyComponent={<EmptyState text="No customers found" />}
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <View style={styles.cardMain}>
                    <View style={[styles.avatar, { backgroundColor: colors.waitingBg }]}>
                      <Ionicons name="person" size={20} color={colors.primary} />
                    </View>
                    <View style={styles.cardInfo}>
                      <Text style={styles.cardTitle}>{item.name || 'Anonymous'}</Text>
                      <Text style={styles.cardSubtitle}>
                        {[item.phone, item.email].filter(Boolean).join(' · ') || 'No contact info'}
                      </Text>
                      <View style={styles.badges}>
                        <Badge label={`${item.visit_count} visit${item.visit_count !== 1 ? 's' : ''}`} color={colors.primary} />
                        {item.last_visit && (
                          <Badge label={new Date(item.last_visit).toLocaleDateString()} color={colors.textSecondary} />
                        )}
                      </View>
                    </View>
                  </View>
                </View>
              )}
            />
          </View>
        );
    }
  };

  // ── Render Modal Form Fields ─────────────────────────────────────

  const renderFormFields = () => {
    switch (tab) {
      case 'offices':
        return (
          <>
            <FormField label="Name" required>
              <TextInput
                style={styles.input}
                value={formData.name || ''}
                onChangeText={(v) => setFormData((p) => ({ ...p, name: v }))}
                placeholder="Office name"
                placeholderTextColor={colors.textMuted}
              />
            </FormField>
            <FormField label="Address">
              <TextInput
                style={styles.input}
                value={formData.address || ''}
                onChangeText={(v) => setFormData((p) => ({ ...p, address: v }))}
                placeholder="Street address"
                placeholderTextColor={colors.textMuted}
              />
            </FormField>
            <FormField label="Timezone">
              <TextInput
                style={styles.input}
                value={formData.timezone || ''}
                onChangeText={(v) => setFormData((p) => ({ ...p, timezone: v }))}
                placeholder="e.g. America/New_York"
                placeholderTextColor={colors.textMuted}
              />
            </FormField>
          </>
        );

      case 'staff':
        return (
          <>
            <FormField label="Full Name" required>
              <TextInput
                style={styles.input}
                value={formData.full_name || ''}
                onChangeText={(v) => setFormData((p) => ({ ...p, full_name: v }))}
                placeholder="Full name"
                placeholderTextColor={colors.textMuted}
              />
            </FormField>
            <FormField label="Email" required>
              <TextInput
                style={styles.input}
                value={formData.email || ''}
                onChangeText={(v) => setFormData((p) => ({ ...p, email: v }))}
                placeholder="email@example.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!editingItem}
              />
            </FormField>
            <FormField label="Role" required>
              <TouchableOpacity style={styles.pickerButton} onPress={openRolePicker}>
                <Text style={formData.role ? styles.pickerButtonText : styles.pickerButtonPlaceholder}>
                  {formData.role ? formData.role.replace('_', ' ') : 'Select role'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </FormField>
            <FormField label="Office">
              <TouchableOpacity style={styles.pickerButton} onPress={openOfficePicker}>
                <Text style={formData.office_id ? styles.pickerButtonText : styles.pickerButtonPlaceholder}>
                  {formData.office_name || 'Select office (optional)'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </FormField>
          </>
        );

      case 'desks':
        return (
          <>
            <FormField label="Name" required>
              <TextInput
                style={styles.input}
                value={formData.name || ''}
                onChangeText={(v) => setFormData((p) => ({ ...p, name: v }))}
                placeholder="Desk name"
                placeholderTextColor={colors.textMuted}
              />
            </FormField>
            <FormField label="Office" required>
              <TouchableOpacity style={styles.pickerButton} onPress={openOfficePicker}>
                <Text style={formData.office_id ? styles.pickerButtonText : styles.pickerButtonPlaceholder}>
                  {formData.office_name || 'Select office'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </FormField>
            <FormField label="Department">
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={openDepartmentPicker}
                disabled={!formData.office_id}
              >
                <Text
                  style={
                    formData.department_id
                      ? styles.pickerButtonText
                      : styles.pickerButtonPlaceholder
                  }
                >
                  {formData.department_name || (formData.office_id ? 'Select department (optional)' : 'Select office first')}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </FormField>
          </>
        );

      case 'departments':
        return (
          <>
            <FormField label="Name" required>
              <TextInput
                style={styles.input}
                value={formData.name || ''}
                onChangeText={(v) => setFormData((p) => ({ ...p, name: v }))}
                placeholder="Department name"
                placeholderTextColor={colors.textMuted}
              />
            </FormField>
            <FormField label="Code" required>
              <TextInput
                style={styles.input}
                value={formData.code || ''}
                onChangeText={(v) => setFormData((p) => ({ ...p, code: v }))}
                placeholder="e.g. FIN, HR, CS"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
              />
            </FormField>
            <FormField label="Office" required>
              <TouchableOpacity style={styles.pickerButton} onPress={openOfficePicker}>
                <Text style={formData.office_id ? styles.pickerButtonText : styles.pickerButtonPlaceholder}>
                  {formData.office_name || 'Select office'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </FormField>
          </>
        );

      case 'services':
        return (
          <>
            <FormField label="Name" required>
              <TextInput
                style={styles.input}
                value={formData.name || ''}
                onChangeText={(v) => setFormData((p) => ({ ...p, name: v }))}
                placeholder="Service name"
                placeholderTextColor={colors.textMuted}
              />
            </FormField>
            <FormField label="Code" required>
              <TextInput
                style={styles.input}
                value={formData.code || ''}
                onChangeText={(v) => setFormData((p) => ({ ...p, code: v }))}
                placeholder="e.g. ACC-OPEN"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
              />
            </FormField>
            <FormField label="Office" required>
              <TouchableOpacity style={styles.pickerButton} onPress={openOfficePicker}>
                <Text style={formData.office_id ? styles.pickerButtonText : styles.pickerButtonPlaceholder}>
                  {formData.office_name || 'Select office'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </FormField>
            <FormField label="Department" required>
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={openDepartmentPicker}
                disabled={!formData.office_id}
              >
                <Text
                  style={
                    formData.department_id
                      ? styles.pickerButtonText
                      : styles.pickerButtonPlaceholder
                  }
                >
                  {formData.department_name || (formData.office_id ? 'Select department' : 'Select office first')}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </FormField>
          </>
        );

      case 'priorities':
        return (
          <>
            <FormField label="Name" required>
              <TextInput
                style={styles.input}
                value={formData.name || ''}
                onChangeText={(v) => setFormData((p) => ({ ...p, name: v }))}
                placeholder="Priority name"
                placeholderTextColor={colors.textMuted}
              />
            </FormField>
            <FormField label="Icon (emoji)">
              <TextInput
                style={styles.input}
                value={formData.icon || ''}
                onChangeText={(v) => setFormData((p) => ({ ...p, icon: v }))}
                placeholder="e.g. elderly, wheelchair"
                placeholderTextColor={colors.textMuted}
              />
            </FormField>
            <FormField label="Color (hex)">
              <View style={styles.colorInputRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={formData.color || ''}
                  onChangeText={(v) => setFormData((p) => ({ ...p, color: v }))}
                  placeholder="#ef4444"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                />
                {formData.color ? (
                  <View style={[styles.colorPreview, { backgroundColor: formData.color }]} />
                ) : null}
              </View>
            </FormField>
            <FormField label="Weight">
              <TextInput
                style={styles.input}
                value={formData.weight || ''}
                onChangeText={(v) => setFormData((p) => ({ ...p, weight: v }))}
                placeholder="1"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
              />
            </FormField>
          </>
        );

      default:
        return null;
    }
  };

  // ── Modal Title ──────────────────────────────────────────────────

  const modalTitle = useMemo(() => {
    const action = editingItem ? 'Edit' : 'Create';
    const entity: Record<ManageTab, string> = {
      offices: 'Office',
      staff: 'Staff Member',
      desks: 'Desk',
      departments: 'Department',
      services: 'Service',
      priorities: 'Priority',
      customers: 'Customer',
    };
    return `${action} ${entity[tab]}`;
  }, [tab, editingItem]);

  // ── Show FAB? ────────────────────────────────────────────────────

  const showFab = tab !== 'customers';

  // ── Render ───────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Tab Bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
      >
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Ionicons name={t.icon as any} size={18} color={tab === t.key ? colors.primary : colors.textMuted} />
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Content */}
      {renderContent()}

      {/* FAB */}
      {showFab && (
        <TouchableOpacity style={styles.fab} onPress={openCreate} activeOpacity={0.85}>
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Create / Edit Modal */}
      <Modal visible={showModal} animationType="slide" transparent onRequestClose={closeModal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{modalTitle}</Text>
              <TouchableOpacity onPress={closeModal} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Form */}
            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={styles.modalBodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {renderFormFields()}
            </ScrollView>

            {/* Actions */}
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelButton} onPress={closeModal}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                <Text style={styles.saveButtonText}>{saving ? 'Saving...' : editingItem ? 'Update' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Picker Sub-Modal */}
      <Modal visible={!!pickerField} animationType="fade" transparent onRequestClose={() => setPickerField(null)}>
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setPickerField(null)}
        >
          <View style={styles.pickerContainer}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>
                {pickerField === 'role'
                  ? 'Select Role'
                  : pickerField === 'office_id'
                    ? 'Select Office'
                    : 'Select Department'}
              </Text>
              <TouchableOpacity onPress={() => setPickerField(null)}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
              {/* Clear option for optional fields */}
              {pickerField !== 'role' && (
                <TouchableOpacity
                  style={styles.pickerItem}
                  onPress={() => {
                    if (pickerField) {
                      setFormData((prev) => ({
                        ...prev,
                        [pickerField]: '',
                        [pickerField.replace('_id', '_name')]: '',
                      }));
                      // Reset dependent fields when office changes
                      if (pickerField === 'office_id') {
                        setFormData((prev) => ({
                          ...prev,
                          office_id: '',
                          office_name: '',
                          department_id: '',
                          department_name: '',
                        }));
                      }
                    }
                    setPickerField(null);
                  }}
                >
                  <Text style={[styles.pickerItemText, { color: colors.textMuted, fontStyle: 'italic' }]}>
                    None
                  </Text>
                </TouchableOpacity>
              )}
              {pickerOptions.map((opt) => {
                const isSelected = formData[pickerField!] === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                    onPress={() => {
                      handlePickerSelect(opt.value, opt.label);
                      // Reset department when office changes
                      if (pickerField === 'office_id') {
                        setFormData((prev) => ({
                          ...prev,
                          office_id: opt.value,
                          office_name: opt.label,
                          department_id: '',
                          department_name: '',
                        }));
                        setPickerField(null);
                      }
                    }}
                  >
                    <Text style={[styles.pickerItemText, isSelected && styles.pickerItemTextSelected]}>
                      {opt.label}
                    </Text>
                    {isSelected && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
              {pickerOptions.length === 0 && (
                <View style={styles.pickerEmpty}>
                  <Text style={styles.pickerEmptyText}>No options available</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ── Sub-Components ─────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[badgeStyles.badge, { backgroundColor: color + '18' }]}>
      <Text style={[badgeStyles.text, { color }]}>{label}</Text>
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name="folder-open-outline" size={48} color={colors.textMuted} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>
        {label}
        {required && <Text style={styles.formRequired}> *</Text>}
      </Text>
      {children}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const badgeStyles = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  text: { fontSize: 11, fontWeight: '700' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Tab bar
  tabsScroll: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexGrow: 0,
  },
  tabs: { flexDirection: 'row', paddingHorizontal: spacing.xs },
  tab: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: 2,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textMuted },
  tabTextActive: { color: colors.primary },

  // List
  list: { padding: spacing.md, gap: spacing.sm, paddingBottom: 100 },
  empty: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl },
  emptyText: { fontSize: fontSize.md, color: colors.textMuted },

  // Card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  cardInfo: { flex: 1, gap: 2 },
  cardTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  cardSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary },
  badges: { flexDirection: 'row', gap: spacing.xs, marginTop: 2, flexWrap: 'wrap' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  // Search bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    margin: spacing.md,
    marginBottom: 0,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.lg,
  },
  searchInput: { flex: 1, fontSize: fontSize.md, color: colors.text, paddingVertical: spacing.xs },

  // Swipe
  swipeContainer: { position: 'relative', overflow: 'hidden', borderRadius: borderRadius.lg },
  swipeDeleteBg: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 90,
    backgroundColor: colors.error,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  swipeDeleteText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '700' },

  // FAB
  fab: {
    position: 'absolute',
    bottom: spacing.xl,
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  modalBody: { paddingHorizontal: spacing.lg },
  modalBodyContent: { paddingTop: spacing.md, paddingBottom: spacing.md, gap: spacing.md },
  modalFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceSecondary,
    alignItems: 'center',
  },
  cancelButtonText: { fontSize: fontSize.md, fontWeight: '600', color: colors.textSecondary },
  saveButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { fontSize: fontSize.md, fontWeight: '600', color: '#fff' },

  // Form
  formField: { gap: spacing.xs },
  formLabel: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  formRequired: { color: colors.error },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  colorInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  colorPreview: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Picker button
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceSecondary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerButtonText: { fontSize: fontSize.md, color: colors.text },
  pickerButtonPlaceholder: { fontSize: fontSize.md, color: colors.textMuted },

  // Picker modal
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pickerContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    maxHeight: 400,
    overflow: 'hidden',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  pickerList: { padding: spacing.xs },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: borderRadius.sm,
  },
  pickerItemSelected: { backgroundColor: colors.waitingBg },
  pickerItemText: { fontSize: fontSize.md, color: colors.text, textTransform: 'capitalize' },
  pickerItemTextSelected: { color: colors.primary, fontWeight: '600' },
  pickerEmpty: { padding: spacing.lg, alignItems: 'center' },
  pickerEmptyText: { fontSize: fontSize.md, color: colors.textMuted },
});
