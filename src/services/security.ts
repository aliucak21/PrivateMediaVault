import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import type { VaultSettings } from '../types/vault';

const KEY_PIN_HASH = 'vault_pin_hash';
const KEY_PIN_SALT = 'vault_pin_salt';
const KEY_MASTER_SECRET = 'vault_master_secret';
const KEY_SETTINGS = 'vault_settings_json';

const DEFAULT_SETTINGS: VaultSettings = {
  pinSet: false,
  biometricEnabled: false,
  autoLockOnBackground: true,
  encryptionEnabled: false,
  lastSelectedContactId: null,
  whatsappSafUri: null,
  whatsappSafUris: [],
  autoSyncEnabled: false,
  autoDeleteOriginalOnSync: false,
  autoSyncBaselineAt: null,
  lastSyncAt: null,
};

export async function loadSettings(): Promise<VaultSettings> {
  try {
    const raw = await SecureStore.getItemAsync(KEY_SETTINGS);
    const pinHash = await SecureStore.getItemAsync(KEY_PIN_HASH);
    const parsed = raw ? (JSON.parse(raw) as Partial<VaultSettings>) : {};
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      pinSet: Boolean(pinHash),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(partial: Partial<VaultSettings>): Promise<VaultSettings> {
  const current = await loadSettings();
  const next: VaultSettings = { ...current, ...partial };
  await SecureStore.setItemAsync(KEY_SETTINGS, JSON.stringify(next));
  return next;
}

export async function setPin(pin: string): Promise<void> {
  const saltBytes = await Crypto.getRandomBytesAsync(16);
  const salt = Array.from(saltBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${pin}`
  );
  await SecureStore.setItemAsync(KEY_PIN_SALT, salt);
  await SecureStore.setItemAsync(KEY_PIN_HASH, hash);
  await ensureMasterSecret();
  await saveSettings({ pinSet: true });
}

export async function verifyPin(pin: string): Promise<boolean> {
  const salt = await SecureStore.getItemAsync(KEY_PIN_SALT);
  const storedHash = await SecureStore.getItemAsync(KEY_PIN_HASH);
  if (!salt || !storedHash) return false;
  const candidate = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${pin}`
  );
  return candidate === storedHash;
}

export async function isBiometricAvailable(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;
  return LocalAuthentication.isEnrolledAsync();
}

export async function authenticateWithBiometrics(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Özel Medya Kasası Kilidini Aç',
    cancelLabel: 'PIN Kullan',
    fallbackLabel: 'PIN ile Aç',
    disableDeviceFallback: true,
  });
  return result.success;
}

export async function ensureMasterSecret(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_MASTER_SECRET);
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(32);
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_MASTER_SECRET, secret);
  return secret;
}

/**
 * İsteğe bağlı dosya şifrelemesi için Android Keystore destekli SecureStore anahtarı ile
 * hafif anahtar-akışı dönüştürme (yalnızca küçük/orta boyutlu dosyalar için önerilir).
 */
export function xorTransformBytes(data: Uint8Array, keyHex: string): Uint8Array {
  const keyBytes = new Uint8Array(keyHex.length / 2);
  for (let i = 0; i < keyBytes.length; i += 1) {
    keyBytes[i] = parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
  }
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    out[i] = data[i] ^ keyBytes[i % keyBytes.length];
  }
  return out;
}
