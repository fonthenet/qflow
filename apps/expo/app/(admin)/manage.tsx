import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
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

type ManageTab = 'offices' | 'staff' | 'desks' | 'departments' | 'services' | 'priorities' | 'customers' | 'bookings';

interface StaffRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  office_id: string | null;
  department_id: string | null;
  offices: { name: string } | null;
  departments: { name: string } | null;
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
  staff: { full_name: string } | null;
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

interface AppointmentRow {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  scheduled_at: string;
  status: string;
  department_id: string;
  service_id: string;
  departments: { name: string } | null;
  services: { name: string } | null;
  ticket_id: string | null;
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
  { key: 'bookings', label: 'Bookings', icon: 'calendar' },
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
  const [appointmentList, setAppointmentList] = useState<AppointmentRow[]>([]);
  const [bookingDateFilter, setBookingDateFilter] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [bookingStatusFilter, setBookingStatusFilter] = useState<string>('all');
  const [bookingDeptFilter, setBookingDeptFilter] = useState<string>('all');
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
            .select('id, full_name, email, role, is_active, office_id, department_id, offices:office_id(name), departments:department_id(name)')
            .eq('organization_id', orgId)
            .order('full_name');
          setStaffList((data as unknown as StaffRow[]) ?? []);
          break;
        }
        case 'desks': {
          if (officeIds.length === 0) break;
          const { data } = await supabase
            .from('desks')
            .select('id, name, status, is_active, current_staff_id, office_id, department_id, offices:office_id(name), departments:department_id(name), staff:current_staff_id(full_name)')
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
        case 'bookings': {
          if (officeIds.length === 0) break;
          const bStart = `${bookingDateFilter}T00:00:00`;
          const bEnd = `${bookingDateFilter}T23:59:59`;
          let bQuery = supabase
            .from('appointments')
            .select('id, customer_name, customer_phone, scheduled_at, status, department_id, service_id, ticket_id, departments:department_id(name), services:service_id(name)')
            .in('office_id', officeIds)
            .gte('scheduled_at', bStart)
            .lte('scheduled_at', bEnd)
            .order('scheduled_at');
          if (bookingStatusFilter !== 'all') bQuery = bQuery.eq('status', bookingStatusFilter);
          if (bookingDeptFilter !== 'all') bQuery = bQuery.eq('department_id', bookingDeptFilter);
          const { data } = await bQuery;
          setAppointmentList((data as unknown as AppointmentRow[]) ?? []);
          // Also load depts for filter chips if not already loaded
          if (deptList.length === 0) {
            const { data: depts } = await supabase
              .from('departments')
              .select('id, name, code, office_id')
              .in('office_id', officeIds)
              .order('name');
            setDeptList((depts as unknown as DeptRow[]) ?? []);
          }
          break;
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to load data');
    }
  }, [tab, orgId, officeIds, customerSearch, bookingDateFilter, bookingStatusFilter, bookingDeptFilter]);

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
          department_id: item.department_id || '',
          department_name: (item.departments as any)?.name || '',
        });
        break;
      case 'desks':
        setFormData({
          name: item.name,
          office_id: item.office_id || '',
          office_name: (item.offices as any)?.name || '',
          department_id: item.department_id || '',
          department_name: (item.departments as any)?.name || '',
          current_staff_id: item.current_staff_id || '',
          staff_name: (item.staff as any)?.full_name || '',
        });
        break;
      case 'departments': {
        const officeName = officeList.find((o) => o.id === item.office_id)?.name || '';
        setFormData({ name: item.name, code: item.code, office_id: item.office_id || '', office_name: officeName });
      }
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
              department_id: formData.department_id || null,
            });
          } else {
            if (!formData.password || formData.password.length < 6) throw new Error('Password must be at least 6 characters');
            await Actions.createStaff({
              full_name: formData.full_name.trim(),
              email: formData.email.trim(),
              password: formData.password,
              role: formData.role,
              organization_id: orgId,
              office_id: formData.office_id || null,
              department_id: formData.department_id || null,
            });
            Alert.alert(
              'Staff Created',
              `${formData.full_name.trim()} has been added.\n\nThey can log in with:\nEmail: ${formData.email.trim()}\nPassword: the one you just set`,
            );
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
              current_staff_id: formData.current_staff_id || null,
            });
          } else {
            await Actions.createDesk({
              name: formData.name.trim(),
              office_id: formData.office_id,
              department_id: formData.department_id || null,
              current_staff_id: formData.current_staff_id || null,
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

  const openStaffPicker = () => {
    setPickerOptions(staffList.map((s) => ({ label: `${s.full_name} (${s.role.replace(/_/g, ' ')})`, value: s.id })));
    setPickerField('current_staff_id');
  };

  const handlePickerSelect = (value: string, label: string) => {
    if (!pickerField) return;
    const nameKey = pickerField === 'current_staff_id' ? 'staff_name' : pickerField.replace('_id', '_name');
    setFormData((prev) => ({
      ...prev,
      [pickerField]: value,
      [nameKey]: label,
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
    // Always keep staff list fresh for desk assignment picker
    supabase
      .from('staff')
      .select('id, full_name, email, role, is_active, office_id, department_id, offices:office_id(name), departments:department_id(name)')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => {
        if (data) setStaffList(data as unknown as StaffRow[]);
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
                      <Badge label={item.role.replace(/_/g, ' ')} color={item.role === 'admin' ? colors.primary : colors.textMuted} />
                      {item.offices && <Badge label={(item.offices as any).name} color={colors.textSecondary} />}
                      {item.departments && <Badge label={(item.departments as any).name} color={colors.textSecondary} />}
                    </View>
                  </View>
                </View>
                <Switch
                  value={item.is_active}
                  onValueChange={() => toggleStaffActive(item.id, item.is_active)}
                  trackColor={{ false: '#e2e8f0', true: '#bfdbfe' }}
                  thumbColor={item.is_active ? colors.primary : '#94a3b8'}
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
                        {(item.staff as any)?.full_name ? <Badge label={(item.staff as any).full_name} color={colors.success} /> : item.current_staff_id ? <Badge label="Staffed" color={colors.success} /> : null}
                      </View>
                    </View>
                  </View>
                  <View style={styles.cardActions}>
                    <Switch
                      value={item.is_active}
                      onValueChange={() => toggleDeskActive(item.id, item.is_active)}
                      trackColor={{ false: '#e2e8f0', true: '#bfdbfe' }}
                      thumbColor={item.is_active ? colors.primary : '#94a3b8'}
                    />
                    <TouchableOpacity
                      onPress={() => confirmDeleteDesk(item.id, item.name)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
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
                  trackColor={{ false: '#e2e8f0', true: '#bfdbfe' }}
                  thumbColor={item.is_active ? colors.primary : '#94a3b8'}
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
                    trackColor={{ false: '#e2e8f0', true: '#bfdbfe' }}
                    thumbColor={item.is_active ? colors.primary : '#94a3b8'}
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

      case 'bookings': {
        const formatBookingDate = (dateStr: string) => {
          const d = new Date(dateStr + 'T12:00:00');
          const today = new Date();
          today.setHours(12, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          if (d.toDateString() === today.toDateString()) return 'Today';
          if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
          return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        };

        const navigateBookingDate = (delta: number) => {
          const d = new Date(bookingDateFilter + 'T12:00:00');
          d.setDate(d.getDate() + delta);
          setBookingDateFilter(d.toISOString().split('T')[0]);
        };

        const formatTime12 = (isoStr: string) => {
          const d = new Date(isoStr);
          return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        };

        const getBookingStatusColor = (status: string) => {
          switch (status) {
            case 'checked_in': return colors.success;
            case 'cancelled': return colors.error;
            case 'confirmed': return colors.info;
            default: return colors.warning;
          }
        };

        const handleCheckIn = (id: string, name: string) => {
          Alert.alert('Check In', `Check in ${name}?`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Check In',
              onPress: async () => {
                await supabase.from('appointments').update({ status: 'checked_in' }).eq('id', id);
                loadTab();
              },
            },
          ]);
        };

        const handleCancelBooking = (id: string, name: string) => {
          Alert.alert('Cancel Booking', `Cancel ${name}'s appointment?`, [
            { text: 'Keep', style: 'cancel' },
            {
              text: 'Cancel Booking',
              style: 'destructive',
              onPress: async () => {
                await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', id);
                loadTab();
              },
            },
          ]);
        };

        const STATUS_CHIPS = [
          { key: 'all', label: 'All' },
          { key: 'pending', label: 'Pending' },
          { key: 'confirmed', label: 'Confirmed' },
          { key: 'checked_in', label: 'Checked In' },
          { key: 'cancelled', label: 'Cancelled' },
        ];

        return (
          <View style={{ flex: 1 }}>
            {/* Date nav */}
            <View style={bStyles.dateNav}>
              <TouchableOpacity onPress={() => navigateBookingDate(-1)} style={bStyles.dateArrow}>
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </TouchableOpacity>
              <Text style={bStyles.dateLabel}>{formatBookingDate(bookingDateFilter)}</Text>
              <TouchableOpacity onPress={() => navigateBookingDate(1)} style={bStyles.dateArrow}>
                <Ionicons name="chevron-forward" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Status chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={bStyles.chipRow} contentContainerStyle={bStyles.chipRowContent}>
              {STATUS_CHIPS.map((c) => (
                <TouchableOpacity
                  key={c.key}
                  style={[bStyles.chip, bookingStatusFilter === c.key && bStyles.chipActive]}
                  onPress={() => setBookingStatusFilter(c.key)}
                >
                  <Text style={[bStyles.chipText, bookingStatusFilter === c.key && bStyles.chipTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Department chips */}
            {deptList.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={bStyles.chipRow} contentContainerStyle={bStyles.chipRowContent}>
                <TouchableOpacity
                  style={[bStyles.chip, bookingDeptFilter === 'all' && bStyles.chipActive]}
                  onPress={() => setBookingDeptFilter('all')}
                >
                  <Text style={[bStyles.chipText, bookingDeptFilter === 'all' && bStyles.chipTextActive]}>All Depts</Text>
                </TouchableOpacity>
                {deptList.map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    style={[bStyles.chip, bookingDeptFilter === d.id && bStyles.chipActive]}
                    onPress={() => setBookingDeptFilter(d.id)}
                  >
                    <Text style={[bStyles.chipText, bookingDeptFilter === d.id && bStyles.chipTextActive]}>{d.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Count */}
            <View style={bStyles.countRow}>
              <Text style={bStyles.countText}>
                {appointmentList.length} booking{appointmentList.length !== 1 ? 's' : ''}
              </Text>
            </View>

            {/* List */}
            <FlatList
              data={appointmentList}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingTop: spacing.xxl * 2, gap: spacing.sm }}>
                  <Ionicons name="calendar-outline" size={48} color={colors.textMuted} />
                  <Text style={{ fontSize: fontSize.lg, fontWeight: '600', color: colors.textMuted }}>No bookings</Text>
                  <Text style={{ fontSize: fontSize.sm, color: colors.textMuted }}>No appointments for {formatBookingDate(bookingDateFilter)}</Text>
                </View>
              }
              renderItem={({ item }) => {
                const isPending = item.status === 'pending' || item.status === 'confirmed';
                const sColor = getBookingStatusColor(item.status);

                const showDetails = () => {
                  const lines = [
                    `Time: ${formatTime12(item.scheduled_at)}`,
                    item.departments?.name ? `Department: ${item.departments.name}` : '',
                    item.services?.name ? `Service: ${item.services.name}` : '',
                    item.customer_phone ? `Phone: ${item.customer_phone}` : '',
                    `Status: ${item.status.replace('_', ' ')}`,
                  ].filter(Boolean).join('\n');

                  const buttons: any[] = [{ text: 'Close', style: 'cancel' }];
                  if (isPending) {
                    buttons.push({
                      text: 'Check In',
                      onPress: () => handleCheckIn(item.id, item.customer_name),
                    });
                    buttons.push({
                      text: 'Cancel Booking',
                      style: 'destructive',
                      onPress: () => handleCancelBooking(item.id, item.customer_name),
                    });
                  }
                  Alert.alert(item.customer_name, lines, buttons);
                };

                return (
                  <TouchableOpacity style={bStyles.bookingCard} onPress={showDetails} activeOpacity={0.7}>
                    <View style={bStyles.bookingRow}>
                      <View style={[bStyles.bookingAvatar, { backgroundColor: sColor + '18' }]}>
                        <Ionicons name="person" size={16} color={sColor} />
                      </View>
                      <View style={bStyles.bookingInfo}>
                        <Text style={bStyles.bookingName} numberOfLines={1}>{item.customer_name}</Text>
                        <Text style={bStyles.bookingMeta} numberOfLines={1}>
                          {formatTime12(item.scheduled_at)}
                          {item.departments?.name ? ` · ${item.departments.name}` : ''}
                          {item.services?.name ? ` · ${item.services.name}` : ''}
                        </Text>
                      </View>
                      <View style={bStyles.bookingRight}>
                        <View style={[bStyles.bookingStatus, { backgroundColor: sColor + '18' }]}>
                          <View style={[bStyles.bookingStatusDot, { backgroundColor: sColor }]} />
                          <Text style={[bStyles.bookingStatusText, { color: sColor }]}>
                            {item.status.replace('_', ' ')}
                          </Text>
                        </View>
                        {isPending && (
                          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        );
      }
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
            {!editingItem && (
              <FormField label="Password" required>
                <TextInput
                  style={styles.input}
                  value={formData.password || ''}
                  onChangeText={(v) => setFormData((p) => ({ ...p, password: v }))}
                  placeholder="Min 6 characters"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </FormField>
            )}
            <FormField label="Role" required>
              <TouchableOpacity style={styles.pickerButton} onPress={openRolePicker}>
                <Text style={formData.role ? styles.pickerButtonText : styles.pickerButtonPlaceholder}>
                  {formData.role ? formData.role.replace(/_/g, ' ') : 'Select role'}
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
            <FormField label="Assigned Staff">
              <TouchableOpacity style={styles.pickerButton} onPress={openStaffPicker}>
                <Text style={formData.current_staff_id ? styles.pickerButtonText : styles.pickerButtonPlaceholder}>
                  {formData.staff_name || 'No staff assigned'}
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
      bookings: 'Booking',
    };
    return `${action} ${entity[tab]}`;
  }, [tab, editingItem]);

  // ── Show FAB? ────────────────────────────────────────────────────

  const showFab = tab !== 'customers' && tab !== 'bookings';

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

            {/* Form or Inline Picker */}
            {pickerField ? (
              <View style={{ flex: 1 }}>
                <View style={styles.pickerHeader}>
                  <TouchableOpacity onPress={() => setPickerField(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="arrow-back" size={20} color={colors.primary} />
                    <Text style={{ fontSize: fontSize.sm, color: colors.primary, fontWeight: '600' }}>Back</Text>
                  </TouchableOpacity>
                  <Text style={styles.pickerTitle}>
                    {pickerField === 'role'
                      ? 'Select Role'
                      : pickerField === 'office_id'
                        ? 'Select Office'
                        : pickerField === 'current_staff_id'
                          ? 'Assign Staff'
                          : 'Select Department'}
                  </Text>
                  <View style={{ width: 60 }} />
                </View>
                <ScrollView style={[styles.pickerList, { flex: 1 }]} keyboardShouldPersistTaps="handled">
                  {/* Clear option for optional fields */}
                  {pickerField !== 'role' && (
                    <TouchableOpacity
                      style={styles.pickerItem}
                      onPress={() => {
                        const field = pickerField!;
                        if (field === 'office_id') {
                          setFormData((prev) => ({
                            ...prev,
                            office_id: '',
                            office_name: '',
                            department_id: '',
                            department_name: '',
                          }));
                        } else {
                          const nameKey = field === 'current_staff_id' ? 'staff_name' : field.replace('_id', '_name');
                          setFormData((prev) => ({
                            ...prev,
                            [field]: '',
                            [nameKey]: '',
                          }));
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
                          const field = pickerField!;
                          if (field === 'office_id') {
                            setFormData((prev) => ({
                              ...prev,
                              office_id: opt.value,
                              office_name: opt.label,
                              department_id: '',
                              department_name: '',
                            }));
                          } else {
                            const nameKey = field === 'current_staff_id' ? 'staff_name' : field.replace('_id', '_name');
                            setFormData((prev) => ({
                              ...prev,
                              [field]: opt.value,
                              [nameKey]: opt.label,
                            }));
                          }
                          setPickerField(null);
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
            ) : (
              <View style={{ flex: 1 }}>
                <ScrollView
                  style={[styles.modalBody, { flex: 1 }]}
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
            )}
          </View>
        </KeyboardAvoidingView>
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
    height: '70%',
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

  // Picker (inline in modal)
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

// ── Booking tab styles ────────────────────────────────────────────────

const bStyles = StyleSheet.create({
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dateArrow: {
    padding: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  dateLabel: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    minWidth: 120,
    textAlign: 'center',
  },
  chipRow: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    maxHeight: 48,
  },
  chipRowContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  chipActive: {
    backgroundColor: colors.primary,
  },
  chipText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: '#fff',
  },
  countRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  countText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  bookingCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  bookingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bookingAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bookingInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  bookingName: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  bookingMeta: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  bookingRight: {
    alignItems: 'flex-end',
    gap: 6,
    flexShrink: 0,
  },
  bookingStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    gap: 4,
  },
  bookingStatusDot: { width: 6, height: 6, borderRadius: 3 },
  bookingStatusText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  bookingActions: {
    flexDirection: 'row',
    gap: 4,
  },
  bookingActionIcon: {
    padding: 2,
  },
});
