import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { CapturedNotification, Contact } from '../types/vault';
import {
  findMatchingContactForMedia,
  matchNotificationToContact,
} from '../utils/vaultCore';
import { listAllMedia } from './database';
import {
  deleteSafOriginals,
  importMediaItemsToContact,
  scanSafDirectoryForMedia,
} from './vaultStorage';

interface NativeNotifModule {
  isNotificationAccessEnabled(): Promise<boolean>;
  openNotificationAccessSettings(): Promise<boolean>;
  openBatteryOptimizationSettings(): Promise<boolean>;
  getCapturedNotifications(): Promise<CapturedNotification[]>;
  clearCapturedNotifications(): Promise<boolean>;
  hasAllFilesAccess(): Promise<boolean>;
  openAllFilesAccessSettings(): Promise<boolean>;
  findWhatsAppMediaFolders(): Promise<string[]>;
}

const nativeModule: NativeNotifModule | undefined =
  Platform.OS === 'android' ? NativeModules.ShareIntentModule : undefined;

export async function isNotificationAccessEnabled(): Promise<boolean> {
  if (!nativeModule?.isNotificationAccessEnabled) return false;
  try {
    return await nativeModule.isNotificationAccessEnabled();
  } catch {
    return false;
  }
}

export async function openNotificationAccessSettings(): Promise<void> {
  if (nativeModule?.openNotificationAccessSettings) {
    await nativeModule.openNotificationAccessSettings();
  }
}

export async function openBatteryOptimizationSettings(): Promise<void> {
  if (nativeModule?.openBatteryOptimizationSettings) {
    await nativeModule.openBatteryOptimizationSettings();
  }
}

export async function hasAllFilesAccess(): Promise<boolean> {
  if (!nativeModule?.hasAllFilesAccess) return false;
  try {
    return await nativeModule.hasAllFilesAccess();
  } catch {
    return false;
  }
}

export async function openAllFilesAccessSettings(): Promise<void> {
  if (nativeModule?.openAllFilesAccessSettings) {
    await nativeModule.openAllFilesAccessSettings();
  }
}

export async function findWhatsAppMediaFolders(): Promise<string[]> {
  if (!nativeModule?.findWhatsAppMediaFolders) return [];
  try {
    const folders = await nativeModule.findWhatsAppMediaFolders();
    return Array.isArray(folders) ? folders : [];
  } catch {
    return [];
  }
}

export async function getCapturedNotifications(): Promise<CapturedNotification[]> {
  if (!nativeModule?.getCapturedNotifications) return [];
  try {
    const list = await nativeModule.getCapturedNotifications();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function subscribeToWhatsAppNotifications(onNotif: () => void): () => void {
  if (Platform.OS !== 'android') return () => {};
  const sub = DeviceEventEmitter.addListener('onWhatsAppNotification', onNotif);
  return () => sub.remove();
}

export interface AutoSyncReport {
  syncedCount: number;
  deletedOriginalsCount: number;
  matchedNames: string[];
}

/**
 * Yakalanan WhatsApp bildirimleri ile SAF klasöründeki yeni dosyaları eşleştirir.
 * Yalnızca takip edilen bir kişiyle eşleşen yeni dosyaları otomatik kasaya alır.
 */
export async function syncWhatsAppWithNotifications(
  contacts: Contact[],
  safUris: string[],
  options: { encrypt: boolean; deleteOriginals: boolean }
): Promise<AutoSyncReport> {
  if (contacts.length === 0 || safUris.length === 0) {
    return { syncedCount: 0, deletedOriginalsCount: 0, matchedNames: [] };
  }

  const notifications = await getCapturedNotifications();
  if (notifications.length === 0) {
    return { syncedCount: 0, deletedOriginalsCount: 0, matchedNames: [] };
  }

  const existingMedia = await listAllMedia();
  const knownOriginalUris = new Set(
    existingMedia.map((m) => m.originalUri).filter((u): u is string => Boolean(u))
  );

  // Son 15 dakika içinde takip edilen kişilerden gelen bildirim yoksa taramaya gerek yok
  const now = Date.now();
  const recentNotifs = notifications.filter((n) => now - n.timestamp <= 15 * 60 * 1000);
  if (recentNotifs.length === 0) {
    return { syncedCount: 0, deletedOriginalsCount: 0, matchedNames: [] };
  }

  let syncedCount = 0;
  let deletedOriginalsCount = 0;
  const matchedNameSet = new Set<string>();

  for (const dirUri of safUris) {
    let entries = [];
    try {
      entries = await scanSafDirectoryForMedia(dirUri);
    } catch {
      continue;
    }

    const newEntries = entries.filter((e) => !knownOriginalUris.has(e.uri));
    if (newEntries.length === 0) continue;

    // En yeni dosyaları öne almak için son 25 yeni dosyayı kontrol et
    const candidates = newEntries.slice(-25);

    for (const item of candidates) {
      let fileTimestamp = now;
      try {
        const info = await FileSystem.getInfoAsync(item.uri);
        if (info.exists && 'modificationTime' in info && typeof info.modificationTime === 'number') {
          // modificationTime saniye cinsinden dönerse ms'ye çevir
          fileTimestamp =
            info.modificationTime < 1e12
              ? info.modificationTime * 1000
              : info.modificationTime;
        }
      } catch {
        // Dosya zamanı alınamazsa güncel zaman üzerinden son bildirimle eşle
      }

      let targetContact = findMatchingContactForMedia(
        fileTimestamp,
        recentNotifs,
        contacts,
        120_000
      );

      // Eğer tek bir kişi son 2 dakikada bildirim attıysa ve dosya zamanı belirsizse o kişiyi seç
      if (!targetContact && recentNotifs.length > 0) {
        const latest = recentNotifs[recentNotifs.length - 1];
        if (now - latest.timestamp <= 120_000) {
          targetContact = matchNotificationToContact(latest.senderName, contacts);
        }
      }

      if (!targetContact) continue;

      const summary = await importMediaItemsToContact(targetContact, [item], {
        encrypt: options.encrypt,
      });

      if (summary.importedCount > 0) {
        syncedCount += summary.importedCount;
        matchedNameSet.add(targetContact.name);
        knownOriginalUris.add(item.uri);

        if (options.deleteOriginals && summary.originalUrisToDelete.length > 0) {
          deletedOriginalsCount += await deleteSafOriginals(summary.originalUrisToDelete);
        }
      }
    }
  }

  return {
    syncedCount,
    deletedOriginalsCount,
    matchedNames: Array.from(matchedNameSet),
  };
}
