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

interface RecentFileEntry {
  uri: string;
  fileName: string;
  mimeType: string;
  size: number;
  modifiedAt: number;
}

interface NativeNotifModule {
  isNotificationAccessEnabled(): Promise<boolean>;
  openNotificationAccessSettings(): Promise<boolean>;
  openBatteryOptimizationSettings(): Promise<boolean>;
  getCapturedNotifications(): Promise<CapturedNotification[]>;
  clearCapturedNotifications(): Promise<boolean>;
  hasAllFilesAccess(): Promise<boolean>;
  openAllFilesAccessSettings(): Promise<boolean>;
  findWhatsAppMediaFolders(): Promise<string[]>;
  scanRecentFiles(folderUris: string[], minTimestampMs: number): Promise<RecentFileEntry[]>;
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
  latestNotification?: CapturedNotification | null;
}

/**
 * Yakalanan WhatsApp bildirimleri ile SAF/dosya klasöründeki YENİ dosyaları sıkı zaman eşleştirmesiyle eşler.
 * Eski dosyaları veya zaman damgası belirsiz dosyaları kesinlikle otomatik aktarmaz.
 */
export async function syncWhatsAppWithNotifications(
  contacts: Contact[],
  safUris: string[],
  options: { encrypt: boolean; deleteOriginals: boolean; minTimestamp?: number }
): Promise<AutoSyncReport> {
  const notifications = await getCapturedNotifications();
  const latestNotification = notifications.length > 0 ? notifications[notifications.length - 1] : null;

  if (contacts.length === 0 || safUris.length === 0 || notifications.length === 0) {
    return { syncedCount: 0, deletedOriginalsCount: 0, matchedNames: [], latestNotification };
  }

  const existingMedia = await listAllMedia();
  const knownOriginalUris = new Set(
    existingMedia.map((m) => m.originalUri).filter((u): u is string => Boolean(u))
  );

  // Yalnızca son 15 dakika içinde takip edilen kişilerden gelen bildirimleri dikkate al
  const now = Date.now();
  const recentNotifs = notifications.filter(
    (n) =>
      now - n.timestamp <= 15 * 60 * 1000 &&
      Boolean(matchNotificationToContact(n.senderName, contacts))
  );
  if (recentNotifs.length === 0) {
    return { syncedCount: 0, deletedOriginalsCount: 0, matchedNames: [], latestNotification };
  }

  let syncedCount = 0;
  let deletedOriginalsCount = 0;
  const matchedNameSet = new Set<string>();

  const minTs = options.minTimestamp || now - 15 * 60 * 1000;
  const fileFolderUris = safUris.filter((u) => u.startsWith('file://'));
  const safOnlyUris = safUris.filter((u) => !u.startsWith('file://'));

  // 1. Native hızlı tarama (file:// klasörlerinde lastModified sırasıyla en yeni 40 dosya)
  if (fileFolderUris.length > 0 && nativeModule?.scanRecentFiles) {
    try {
      const recentFiles = await nativeModule.scanRecentFiles(fileFolderUris, minTs);
      for (const f of recentFiles) {
        if (knownOriginalUris.has(f.uri)) continue;
        const targetContact = findMatchingContactForMedia(
          f.modifiedAt,
          recentNotifs,
          contacts,
          90_000
        );
        if (!targetContact) continue;

        const summary = await importMediaItemsToContact(
          targetContact,
          [
            {
              uri: f.uri,
              fileName: f.fileName,
              mimeType: f.mimeType,
              size: f.size,
              isSafUri: false,
              isExternalOriginal: true,
              createdAt: f.modifiedAt,
            },
          ],
          { encrypt: options.encrypt }
        );

        if (summary.importedCount > 0) {
          syncedCount += summary.importedCount;
          matchedNameSet.add(targetContact.name);
          knownOriginalUris.add(f.uri);
          if (options.deleteOriginals && summary.originalUrisToDelete.length > 0) {
            deletedOriginalsCount += await deleteSafOriginals(summary.originalUrisToDelete);
          }
        }
      }
    } catch {
      // Native tarama hatası SAF taramasını engellemesin
    }
  }

  // 2. SAF (content://) klasörleri için tarama
  for (const dirUri of safOnlyUris) {
    let entries = [];
    try {
      entries = await scanSafDirectoryForMedia(dirUri);
    } catch {
      continue;
    }

    const newEntries = entries.filter((e) => !knownOriginalUris.has(e.uri));
    if (newEntries.length === 0) continue;

    const candidates = newEntries.slice(-20);

    for (const item of candidates) {
      let fileTimestamp: number | null = null;
      try {
        const info = await FileSystem.getInfoAsync(item.uri);
        if (info.exists && 'modificationTime' in info && typeof info.modificationTime === 'number') {
          fileTimestamp =
            info.modificationTime < 1e12
              ? info.modificationTime * 1000
              : info.modificationTime;
        }
      } catch {
        fileTimestamp = null;
      }

      if (fileTimestamp === null) continue;
      if (fileTimestamp < minTs) continue;

      const targetContact = findMatchingContactForMedia(
        fileTimestamp,
        recentNotifs,
        contacts,
        90_000
      );

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
    latestNotification,
  };
}
