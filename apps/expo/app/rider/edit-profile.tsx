import { useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRiderAuth } from '@/lib/rider-auth';
import { RiderAvatar } from '@/components/RiderAvatar';
import { API_BASE_URL } from '@/lib/config';
import { C, F, R, SP } from '@/lib/rider-theme';

/**
 * Profile editor — display name + avatar photo. Avatar flow:
 *   1. Show action sheet (Camera / Library / Remove / Cancel).
 *   2. Picker returns a local URI.
 *   3. Resize to 512px, compress to JPEG (80%) — the server caps at
 *      2 MB but ~512px is plenty for a 64-pt avatar circle and keeps
 *      uploads fast on a rider's mobile data plan.
 *   4. POST as multipart to /api/rider/profile/avatar.
 *   5. refresh() the auth context so every screen picks up the new url.
 */
export default function RiderEditProfileScreen() {
  const router = useRouter();
  const { rider, token, authedFetch, refresh } = useRiderAuth();
  const [name, setName] = useState(rider?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!rider) return null;

  const trimmed = name.trim();
  const dirty = trimmed !== rider.name;
  const valid = trimmed.length > 0 && trimmed.length <= 60;

  async function saveName() {
    if (!dirty || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await authedFetch('/api/rider/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data?.error ?? 'Could not save.');
        return;
      }
      await refresh();
      router.back();
    } finally {
      setBusy(false);
    }
  }

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to choose a picture.');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!r.canceled && r.assets?.[0]) {
      void uploadAvatar(r.assets[0].uri);
    }
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow camera access to take a photo.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!r.canceled && r.assets?.[0]) {
      void uploadAvatar(r.assets[0].uri);
    }
  }

  async function removeAvatar() {
    if (!rider!.avatar_url || uploadingAvatar) return;
    setUploadingAvatar(true);
    try {
      const r = await authedFetch('/api/rider/profile/avatar', { method: 'DELETE' });
      if (r.ok) await refresh();
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function uploadAvatar(uri: string) {
    if (uploadingAvatar) return;
    setUploadingAvatar(true);
    setError(null);
    try {
      // Resize + compress before upload — keeps payload tight and the
      // request fast on flaky mobile data.
      const compressed = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 512, height: 512 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      );

      const form = new FormData();
      // React Native's FormData accepts an object with uri/name/type
      // for file fields — TypeScript's FormData type doesn't know
      // that, hence the cast.
      form.append('file', {
        uri: compressed.uri,
        name: 'avatar.jpg',
        type: 'image/jpeg',
      } as any);

      // Don't use authedFetch here because it would set
      // Content-Type implicitly; we need fetch to set the multipart
      // boundary itself.
      const r = await fetch(`${API_BASE_URL}/api/rider/profile/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token!}` },
        body: form as any,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data?.error ?? 'Upload failed.');
        return;
      }
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Upload failed.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  function showAvatarSheet() {
    if (uploadingAvatar) return;
    const hasAvatar = Boolean(rider!.avatar_url);
    const options = hasAvatar
      ? ['Take photo', 'Choose from library', 'Remove photo', 'Cancel']
      : ['Take photo', 'Choose from library', 'Cancel'];
    const cancelIndex = options.length - 1;
    const destructiveIndex = hasAvatar ? 2 : -1;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIndex, destructiveButtonIndex: destructiveIndex >= 0 ? destructiveIndex : undefined },
        (idx) => {
          if (idx === 0) takePhoto();
          else if (idx === 1) pickFromLibrary();
          else if (idx === 2 && hasAvatar) removeAvatar();
        },
      );
    } else {
      // Android — basic Alert-based menu.
      const buttons: any[] = [
        { text: 'Take photo', onPress: takePhoto },
        { text: 'Choose from library', onPress: pickFromLibrary },
      ];
      if (hasAvatar) buttons.push({ text: 'Remove photo', style: 'destructive' as const, onPress: removeAvatar });
      buttons.push({ text: 'Cancel', style: 'cancel' as const });
      Alert.alert('Profile photo', undefined, buttons);
    }
  }

  return (
    <View style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        <Text style={s.title}>Edit profile</Text>
        <View style={{ width: 32 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {/* Avatar block */}
          <Pressable onPress={showAvatarSheet} disabled={uploadingAvatar} style={s.avatarBlock}>
            <View>
              <RiderAvatar name={trimmed || rider.name} url={rider.avatar_url} size={104} />
              <View style={s.cameraBadge}>
                {uploadingAvatar
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="camera" size={18} color="#fff" />}
              </View>
            </View>
            <Text style={s.avatarHint}>
              {rider.avatar_url ? 'Tap to change photo' : 'Tap to add photo'}
            </Text>
          </Pressable>

          {/* Name */}
          <Text style={s.label}>Display name</Text>
          <TextInput
            value={name}
            onChangeText={(v) => { setName(v); setError(null); }}
            placeholder="Your name"
            placeholderTextColor={C.textFaint}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={60}
            style={s.input}
            editable={!busy}
          />
          <Text style={s.helper}>This is how customers and operators see you.</Text>

          {/* Phone (locked) */}
          <Text style={[s.label, { marginTop: SP.lg }]}>WhatsApp number</Text>
          <View style={s.lockedRow}>
            <Text style={s.lockedValue}>{rider.phone}</Text>
            <Pressable
              onPress={() => router.push('/rider/change-phone' as any)}
              hitSlop={6}
              style={({ pressed }) => [s.changeBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={s.changeText}>Change</Text>
            </Pressable>
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <Pressable
            onPress={saveName}
            disabled={!dirty || !valid || busy}
            style={({ pressed }) => [
              s.saveBtn,
              (!dirty || !valid || busy) && s.saveBtnDisabled,
              pressed && dirty && valid && !busy && { opacity: 0.85 },
            ]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>Save</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  topbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingTop: 56, paddingBottom: SP.md,
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  back: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: F.lg, fontWeight: '700', color: C.text },

  scroll: { padding: SP.lg },

  avatarBlock: { alignItems: 'center', paddingVertical: SP.lg },
  cameraBadge: {
    position: 'absolute', right: -2, bottom: -2,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: C.bg,
  },
  avatarHint: { fontSize: F.sm, color: C.textMuted, marginTop: SP.md, fontWeight: '600' },

  label: { fontSize: F.sm, fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: SP.sm },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, borderRadius: R.lg,
    paddingHorizontal: SP.lg, paddingVertical: SP.md,
    fontSize: F.lg, color: C.text,
  },
  helper: { fontSize: F.sm, color: C.textFaint, marginTop: SP.sm },

  lockedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, borderRadius: R.lg,
    paddingHorizontal: SP.lg, paddingVertical: SP.md,
  },
  lockedValue: { fontSize: F.lg, color: C.text, fontWeight: '600' },
  changeBtn: {
    paddingHorizontal: SP.md, paddingVertical: 6,
    borderRadius: R.full,
    backgroundColor: C.primaryTint,
  },
  changeText: { color: C.primaryDark, fontSize: F.sm, fontWeight: '700' },

  error: { color: C.danger, fontSize: F.base, marginTop: SP.md },

  saveBtn: {
    backgroundColor: C.primary,
    borderRadius: R.lg,
    paddingVertical: SP.lg,
    alignItems: 'center', justifyContent: 'center',
    marginTop: SP.xl,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: { color: '#fff', fontSize: F.lg, fontWeight: '700' },
});
