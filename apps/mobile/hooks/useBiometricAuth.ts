/**
 * useBiometricAuth — scaffold hook for Face ID / fingerprint authentication.
 *
 * Uses expo-local-authentication. Currently provides:
 *   - availability check (hardware + enrolled credentials)
 *   - authenticate() trigger with a localised reason string
 *
 * TODO(mobile-sprint-2): Persist the user's biometric preference in
 *   expo-secure-store. Enable on the Profile screen. Gate the Queue and
 *   Appointments screens behind biometric if the user has opted in.
 *
 * TODO(mobile-sprint-2): Handle the "not enrolled" case gracefully — deep-link
 *   the user to device Settings so they can enrol without leaving context.
 */

import { useState, useEffect, useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

export type BiometricType = 'fingerprint' | 'facial' | 'iris' | 'none';

interface BiometricAuthState {
  /** Whether the device supports biometric hardware */
  isAvailable: boolean;
  /** Whether the user has enrolled at least one biometric credential */
  isEnrolled: boolean;
  /** Highest-quality biometric type supported by the device */
  biometricType: BiometricType;
  /** True while checking hardware/enrolment (initial mount only) */
  isChecking: boolean;
}

interface BiometricAuthActions {
  /**
   * Prompt the user for biometric authentication.
   *
   * @param reason - Localised string shown in the system prompt
   *   (e.g. t('biometric.promptReason'))
   * @returns true when authentication succeeds, false otherwise
   */
  authenticate: (reason: string) => Promise<boolean>;
}

function mapAuthenticationType(
  types: LocalAuthentication.AuthenticationType[],
): BiometricType {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION))
    return 'facial';
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT))
    return 'fingerprint';
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS))
    return 'iris';
  return 'none';
}

export function useBiometricAuth(): BiometricAuthState & BiometricAuthActions {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [biometricType, setBiometricType] = useState<BiometricType>('none');
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function checkBiometrics() {
      try {
        const [hasHardware, enrolled, types] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          LocalAuthentication.supportedAuthenticationTypesAsync(),
        ]);

        if (!mounted) return;

        setIsAvailable(hasHardware);
        setIsEnrolled(enrolled);
        setBiometricType(mapAuthenticationType(types));
      } catch {
        // Biometric APIs unavailable — silently degrade
      } finally {
        if (mounted) setIsChecking(false);
      }
    }

    checkBiometrics();
    return () => {
      mounted = false;
    };
  }, []);

  const authenticate = useCallback(async (reason: string): Promise<boolean> => {
    if (!isAvailable || !isEnrolled) return false;

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: reason,
        // Fall back to device PIN/password if biometric fails
        disableDeviceFallback: false,
        cancelLabel: 'Cancel',
      });
      return result.success;
    } catch {
      return false;
    }
  }, [isAvailable, isEnrolled]);

  return { isAvailable, isEnrolled, biometricType, isChecking, authenticate };
}
