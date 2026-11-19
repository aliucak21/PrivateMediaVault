import type {
  CapturedNotification,
  Contact,
  MediaType,
  SortOrder,
  VaultMedia,
} from '../types/vault';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.3gp', '.m4v'];
const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif'];

export function detectMediaType(fileName: string, mimeType?: string | null): MediaType | null {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'photo';

  const lower = fileName.toLowerCase();
  if (VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'video';
  if (PHOTO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'photo';
  return null;
}

export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'kisi';
}

export function sanitizeFileName(fileName: string, fallbackExt = 'bin'): string {
  const trimmed = fileName.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (safe && safe.includes('.')) return safe;
  return `medya_${Date.now()}.${fallbackExt}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function formatDateTr(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

export function filterAndSortMedia(
  items: VaultMedia[],
  options: {
    contactId?: number | null;
    mediaType?: MediaType | 'all';
    query?: string;
    sortOrder?: SortOrder;
  }
): VaultMedia[] {
  const { contactId = null, mediaType = 'all', query = '', sortOrder = 'newest' } = options;
  const q = query.trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (contactId !== null && item.contactId !== contactId) return false;
    if (mediaType !== 'all' && item.mediaType !== mediaType) return false;
    if (q) {
      const inName = item.fileName.toLowerCase().includes(q);
      const inContact = (item.contactName || '').toLowerCase().includes(q);
      if (!inName && !inContact) return false;
    }
    return true;
  });

  return filtered.sort((a, b) => {
    const diff = a.createdAt - b.createdAt;
    return sortOrder === 'newest' ? -diff : diff;
  });
}

export function isDuplicateHash(existingHashes: Set<string>, sha256: string): boolean {
  return existingHashes.has(sha256);
}

export function normalizeSenderName(raw: string): string {
  return raw
    .replace(/\(\d+\s*(mesaj|messages?|yeni mesaj)\)/gi, '')
    .trim()
    .toLocaleLowerCase('tr-TR');
}

export function matchNotificationToContact(
  senderName: string,
  contacts: Contact[]
): Contact | null {
  const normalized = normalizeSenderName(senderName);
  if (!normalized) return null;

  for (const contact of contacts) {
    const cNorm = contact.name.trim().toLocaleLowerCase('tr-TR');
    if (cNorm === normalized) return contact;
  }

  for (const contact of contacts) {
    const cNorm = contact.name.trim().toLocaleLowerCase('tr-TR');
    if (normalized.includes(cNorm) || cNorm.includes(normalized)) {
      return contact;
    }
  }
  return null;
}

/**
 * Dosya zaman damgasına en yakın (varsayılan ±90 saniye içinde) WhatsApp bildirimini bulur.
 * Aynı pencerede birden fazla farklı gönderen varsa yalnızca en yakın zamanlı göndereni döndürür.
 */
export function findMatchingContactForMedia(
  fileTimestamp: number,
  notifications: CapturedNotification[],
  contacts: Contact[],
  windowMs = 90_000
): Contact | null {
  if (notifications.length === 0 || contacts.length === 0) return null;

  let bestContact: Contact | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const notif of notifications) {
    const delta = Math.abs(fileTimestamp - notif.timestamp);
    if (delta > windowMs) continue;

    const matched = matchNotificationToContact(notif.senderName, contacts);
    if (matched && delta < bestDelta) {
      bestDelta = delta;
      bestContact = matched;
    }
  }

  return bestContact;
}
