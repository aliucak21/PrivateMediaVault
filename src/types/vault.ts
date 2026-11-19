export type MediaType = 'photo' | 'video';

export type SortOrder = 'newest' | 'oldest';

export type MainTab = 'vault' | 'contacts' | 'photos' | 'videos' | 'recent' | 'settings';

export interface Contact {
  id: number;
  name: string;
  folderName: string;
  createdAt: number;
  photoCount?: number;
  videoCount?: number;
  lastMediaAt?: number | null;
}

export interface VaultMedia {
  id: number;
  contactId: number;
  contactName?: string;
  fileName: string;
  vaultUri: string;
  originalUri: string | null;
  mediaType: MediaType;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  isEncrypted: boolean;
  createdAt: number;
  importedAt: number;
}

export interface VaultSettings {
  pinSet: boolean;
  biometricEnabled: boolean;
  autoLockOnBackground: boolean;
  encryptionEnabled: boolean;
  lastSelectedContactId: number | null;
  whatsappSafUri: string | null;
  whatsappSafUris: string[];
  autoSyncEnabled: boolean;
  autoDeleteOriginalOnSync: boolean;
  lastSyncAt: number | null;
}

export interface CapturedNotification {
  senderName: string;
  text: string;
  timestamp: number;
}

export interface PendingImportItem {
  uri: string;
  fileName: string;
  mimeType: string;
  size: number;
  isSafUri?: boolean;
  isExternalOriginal?: boolean;
  createdAt?: number;
}

export interface ImportSummary {
  importedCount: number;
  duplicateCount: number;
  failedCount: number;
  importedIds: number[];
  originalUrisToDelete: string[];
}
