import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VaultColors } from '../theme/colors';
import {
  authenticateWithBiometrics,
  isBiometricAvailable,
  setPin,
  verifyPin,
} from '../services/security';

interface LockScreenProps {
  isSetupMode: boolean;
  biometricEnabled: boolean;
  onUnlock: () => void;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

export function LockScreen({ isSetupMode, biometricEnabled, onUnlock }: LockScreenProps) {
  const [pin, setPinInput] = useState('');
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bioReady, setBioReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!isSetupMode && biometricEnabled) {
        const available = await isBiometricAvailable();
        if (mounted) setBioReady(available);
        if (available) {
          const ok = await authenticateWithBiometrics();
          if (ok && mounted) onUnlock();
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [isSetupMode, biometricEnabled, onUnlock]);

  const handleDigit = async (digit: string) => {
    setError(null);
    if (digit === 'del') {
      setPinInput((prev) => prev.slice(0, -1));
      return;
    }
    if (!digit || pin.length >= 6) return;

    const next = pin + digit;
    setPinInput(next);

    if (next.length === 4 && !isSetupMode) {
      const ok = await verifyPin(next);
      if (ok) {
        setPinInput('');
        onUnlock();
      } else {
        setError('Hatalı PIN. Tekrar deneyin.');
        setPinInput('');
      }
      return;
    }

    if (next.length === 4 && isSetupMode) {
      if (firstPin === null) {
        setFirstPin(next);
        setPinInput('');
      } else if (firstPin === next) {
        await setPin(next);
        setFirstPin(null);
        setPinInput('');
        onUnlock();
      } else {
        setError('PIN kodları eşleşmedi. Baştan deneyin.');
        setFirstPin(null);
        setPinInput('');
      }
    }
  };

  const handleBiometricPress = async () => {
    const ok = await authenticateWithBiometrics();
    if (ok) onUnlock();
  };

  const title = isSetupMode
    ? firstPin === null
      ? '4 Haneli Kasa PIN’i Oluştur'
      : 'PIN Kodunu Tekrar Gir'
    : 'Özel Medya Kasası';

  const subtitle = isSetupMode
    ? 'Bu PIN olmadan kasadaki gizli fotoğraf ve videolara erişilemez.'
    : 'Devam etmek için PIN kodunuzu girin';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.iconBadge}>
          <Ionicons name="shield-checkmark" size={36} color={VaultColors.primary} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <View style={styles.dotsRow}>
        {[0, 1, 2, 3].map((idx) => (
          <View
            key={idx}
            style={[styles.dot, idx < pin.length && styles.dotFilled]}
          />
        ))}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : <View style={styles.errorSpacer} />}

      <View style={styles.keypad}>
        {DIGITS.map((d, idx) => {
          if (d === '') {
            return bioReady && !isSetupMode ? (
              <TouchableOpacity
                key={`bio-${idx}`}
                style={styles.keyBtn}
                onPress={handleBiometricPress}
              >
                <Ionicons name="finger-print" size={28} color={VaultColors.primary} />
              </TouchableOpacity>
            ) : (
              <View key={`empty-${idx}`} style={styles.keySpacer} />
            );
          }
          return (
            <TouchableOpacity
              key={d}
              style={styles.keyBtn}
              onPress={() => handleDigit(d)}
            >
              {d === 'del' ? (
                <Ionicons name="backspace-outline" size={24} color={VaultColors.text} />
              ) : (
                <Text style={styles.keyText}>{d}</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: VaultColors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  iconBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: VaultColors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    color: VaultColors.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: VaultColors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 280,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 18,
    marginBottom: 12,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: VaultColors.border,
  },
  dotFilled: {
    backgroundColor: VaultColors.primary,
    borderColor: VaultColors.primary,
  },
  errorText: {
    color: VaultColors.danger,
    fontSize: 13,
    height: 22,
    marginBottom: 16,
  },
  errorSpacer: {
    height: 22,
    marginBottom: 16,
  },
  keypad: {
    width: 270,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 14,
  },
  keyBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: VaultColors.surface,
    borderWidth: 1,
    borderColor: VaultColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keySpacer: {
    width: 76,
    height: 76,
  },
  keyText: {
    color: VaultColors.text,
    fontSize: 24,
    fontWeight: '600',
  },
});
