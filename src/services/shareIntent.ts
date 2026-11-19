import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import type { PendingImportItem } from '../types/vault';

interface NativeShareIntentModule {
  getSharedMedia(): Promise<PendingImportItem[]>;
}

const nativeModule: NativeShareIntentModule | undefined =
  Platform.OS === 'android' ? NativeModules.ShareIntentModule : undefined;

export async function consumePendingSharedMedia(): Promise<PendingImportItem[]> {
  if (!nativeModule?.getSharedMedia) return [];
  try {
    const items = await nativeModule.getSharedMedia();
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export function subscribeToSharedMedia(onReceive: () => void): () => void {
  if (Platform.OS !== 'android') return () => {};
  const sub = DeviceEventEmitter.addListener('onSharedMediaReceived', onReceive);
  return () => sub.remove();
}
