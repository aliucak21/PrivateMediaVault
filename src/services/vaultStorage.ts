import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import type { Contact, ImportSummary, PendingImportItem, VaultMedia } from '../types/vault';
import {
  detectMediaType,
  isDuplicateHash,
  sanitizeFileName,
} from '../utils/vaultCore';
import { getContactHashes, insertMediaItem } from './database';
import { ensureMasterSecret, xorTransformBytes } from './security';

const VAULT_ROOT = `${FileSystem.documentDirectory}vault/`;
const TEMP_VIEW_DIR = `${FileSystem.cacheDirectory}vault_view/`;

export async function ensureVaultRoot(): Promise<void> {
  const info = await FileSystem.getInfoAsync(VAULT_ROOT);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(VAULT_ROOT, { intermediates: true });
  }
  const nomediaPath = `${VAULT_ROOT}.nomedia`;
  const nomediaInfo = await FileSystem.getInfoAsync(nomediaPath);
  if (!nomediaInfo.exists) {
    await FileSystem.writeAsStringAsync(nomediaPath, '');
  }
}

export async function ensureContactDir(contact: Contact): Promise<string> {
  await ensureVaultRoot();
  const dir = `${VAULT_ROOT}${contact.folderName}/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const nomediaPath = `${dir}.nomedia`;
  const nomediaInfo = await FileSystem.getInfoAsync(nomediaPath);
  if (!nomediaInfo.exists) {
    await FileSystem.writeAsStringAsync(nomediaPath, '');
  }
  return dir;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function computeFileSha256(fileUri: string): Promise<{ sha256: string; sizeBytes: number }> {
  const info = await FileSystem.getInfoAsync(fileUri);
  const sizeBytes = info.exists && 'size' in info && typeof info.size === 'number' ? info.size : 0;

  // Büyük dosyalarda bellek taşmasını önlemek için boyut + başlangıç baytları karması + küçük dosyalarda tam SHA-256
  if (sizeBytes > 12 * 1024 * 1024) {
    const fileName = fileUri.split('/').pop() || '';
    const sig = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `large:${sizeBytes}:${fileName}`
    );
    return { sha256: sig, sizeBytes };
  }

  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);
  return { sha256, sizeBytes };
}

export async function importMediaItemsToContact(
  contact: Contact,
  items: PendingImportItem[],
  options: { encrypt: boolean }
): Promise<ImportSummary> {
  const dir = await ensureContactDir(contact);
  const existingHashes = await getContactHashes(contact.id);

  const summary: ImportSummary = {
    importedCount: 0,
    duplicateCount: 0,
    failedCount: 0,
    importedIds: [],
    originalUrisToDelete: [],
  };

  const masterSecret = options.encrypt ? await ensureMasterSecret() : '';

  for (const item of items) {
    try {
      const mediaType = detectMediaType(item.fileName, item.mimeType);
      if (!mediaType) {
        summary.failedCount += 1;
        continue;
      }

      const fallbackExt = mediaType === 'video' ? 'mp4' : 'jpg';
      const safeName = sanitizeFileName(item.fileName, fallbackExt);
      const tempCopyUri = `${FileSystem.cacheDirectory}import_${Date.now()}_${safeName}`;

      if (item.isSafUri) {
        const b64 = await FileSystem.StorageAccessFramework.readAsStringAsync(item.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await FileSystem.writeAsStringAsync(tempCopyUri, b64, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } else {
        await FileSystem.copyAsync({ from: item.uri, to: tempCopyUri });
      }

      const { sha256, sizeBytes } = await computeFileSha256(tempCopyUri);
      if (sizeBytes <= 0) {
        await FileSystem.deleteAsync(tempCopyUri, { idempotent: true });
        summary.failedCount += 1;
        continue;
      }

      if (isDuplicateHash(existingHashes, sha256)) {
        await FileSystem.deleteAsync(tempCopyUri, { idempotent: true });
        summary.duplicateCount += 1;
        continue;
      }

      // 8 MB altındaki dosyalar için isteğe bağlı şifreleme uygula
      const shouldEncrypt = options.encrypt && sizeBytes <= 8 * 1024 * 1024;
      const destFileName = `${Date.now()}_${safeName}${shouldEncrypt ? '.enc' : ''}`;
      const destUri = `${dir}${destFileName}`;

      if (shouldEncrypt) {
        const b64 = await FileSystem.readAsStringAsync(tempCopyUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const encrypted = xorTransformBytes(base64ToBytes(b64), masterSecret);
        await FileSystem.writeAsStringAsync(destUri, bytesToBase64(encrypted), {
          encoding: FileSystem.EncodingType.Base64,
        });
        await FileSystem.deleteAsync(tempCopyUri, { idempotent: true });
      } else {
        await FileSystem.moveAsync({ from: tempCopyUri, to: destUri });
      }

      // Kopyalama bütünlük doğrulaması
      const verifyInfo = await FileSystem.getInfoAsync(destUri);
      if (!verifyInfo.exists || ('size' in verifyInfo && (verifyInfo.size ?? 0) <= 0)) {
        summary.failedCount += 1;
        continue;
      }

      const now = Date.now();
      const insertedId = await insertMediaItem({
        contactId: contact.id,
        fileName: safeName,
        vaultUri: destUri,
        originalUri: item.isSafUri ? item.uri : null,
        mediaType,
        mimeType: item.mimeType || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg'),
        sizeBytes,
        sha256,
        isEncrypted: shouldEncrypt,
        createdAt: item.createdAt || now,
        importedAt: now,
      });

      existingHashes.add(sha256);
      summary.importedCount += 1;
      summary.importedIds.push(insertedId);
      if (item.isSafUri) {
        summary.originalUrisToDelete.push(item.uri);
      }
    } catch {
      summary.failedCount += 1;
    }
  }

  return summary;
}

export async function resolvePlayableUri(media: VaultMedia): Promise<string> {
  if (!media.isEncrypted) return media.vaultUri;

  const info = await FileSystem.getInfoAsync(TEMP_VIEW_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(TEMP_VIEW_DIR, { intermediates: true });
  }
  const outUri = `${TEMP_VIEW_DIR}view_${media.id}_${media.fileName}`;
  const existing = await FileSystem.getInfoAsync(outUri);
  if (existing.exists) return outUri;

  const secret = await ensureMasterSecret();
  const b64 = await FileSystem.readAsStringAsync(media.vaultUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const decrypted = xorTransformBytes(base64ToBytes(b64), secret);
  await FileSystem.writeAsStringAsync(outUri, bytesToBase64(decrypted), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return outUri;
}

export async function clearDecryptedCache(): Promise<void> {
  await FileSystem.deleteAsync(TEMP_VIEW_DIR, { idempotent: true });
}

export async function deleteVaultFile(vaultUri: string): Promise<void> {
  await FileSystem.deleteAsync(vaultUri, { idempotent: true });
}

export async function deleteContactFolder(contact: Contact): Promise<void> {
  const dir = `${VAULT_ROOT}${contact.folderName}/`;
  await FileSystem.deleteAsync(dir, { idempotent: true });
}

export async function exportMediaToGallery(media: VaultMedia): Promise<void> {
  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Galeriye kaydetmek için medya izni gereklidir.');
  }
  const uri = await resolvePlayableUri(media);
  await MediaLibrary.saveToLibraryAsync(uri);
}

export async function shareMediaOut(media: VaultMedia): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Bu cihazda paylaşım özelliği kullanılamıyor.');
  }
  const uri = await resolvePlayableUri(media);
  await Sharing.shareAsync(uri, { mimeType: media.mimeType });
}

export async function requestWhatsAppSafFolder(): Promise<string | null> {
  const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!perm.granted) return null;
  return perm.directoryUri;
}

export async function scanSafDirectoryForMedia(dirUri: string): Promise<PendingImportItem[]> {
  const entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(dirUri);
  const results: PendingImportItem[] = [];

  for (const uri of entries) {
    const decoded = decodeURIComponent(uri);
    const fileName = decoded.split('/').pop() || decoded.split(':').pop() || 'medya';
    if (fileName.startsWith('.')) continue;

    const mediaType = detectMediaType(fileName, null);
    if (!mediaType) continue;

    results.push({
      uri,
      fileName,
      mimeType: mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
      size: 0,
      isSafUri: true,
      createdAt: Date.now(),
    });
  }

  return results;
}

export async function deleteSafOriginals(uris: string[]): Promise<number> {
  let deleted = 0;
  for (const uri of uris) {
    try {
      await FileSystem.StorageAccessFramework.deleteAsync(uri, { idempotent: true });
      deleted += 1;
    } catch {
      // Bazı üretici ROM'larında SAF silme izni kısıtlı olabilir
    }
  }
  return deleted;
}
