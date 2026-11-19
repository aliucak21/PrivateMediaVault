import * as SQLite from 'expo-sqlite';
import type { Contact, MediaType, VaultMedia } from '../types/vault';
import { sanitizeFolderName } from '../utils/vaultCore';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('private_media_vault.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS contacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          folder_name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS media_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id INTEGER NOT NULL,
          file_name TEXT NOT NULL,
          vault_uri TEXT NOT NULL,
          original_uri TEXT,
          media_type TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          is_encrypted INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          imported_at INTEGER NOT NULL,
          FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_media_contact ON media_items(contact_id);
        CREATE INDEX IF NOT EXISTS idx_media_hash ON media_items(contact_id, sha256);
        CREATE INDEX IF NOT EXISTS idx_media_created ON media_items(created_at DESC);
      `);
      return db;
    })();
  }
  return dbPromise;
}

export async function listContacts(): Promise<Contact[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    name: string;
    folder_name: string;
    created_at: number;
    photo_count: number;
    video_count: number;
    last_media_at: number | null;
  }>(`
    SELECT
      c.id,
      c.name,
      c.folder_name,
      c.created_at,
      SUM(CASE WHEN m.media_type = 'photo' THEN 1 ELSE 0 END) AS photo_count,
      SUM(CASE WHEN m.media_type = 'video' THEN 1 ELSE 0 END) AS video_count,
      MAX(m.imported_at) AS last_media_at
    FROM contacts c
    LEFT JOIN media_items m ON m.contact_id = c.id
    GROUP BY c.id
    ORDER BY COALESCE(MAX(m.imported_at), c.created_at) DESC
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    folderName: r.folder_name,
    createdAt: r.created_at,
    photoCount: r.photo_count || 0,
    videoCount: r.video_count || 0,
    lastMediaAt: r.last_media_at ?? null,
  }));
}

export async function createContact(name: string): Promise<Contact> {
  const db = await getDb();
  const trimmed = name.trim();
  const now = Date.now();
  const folderName = `${sanitizeFolderName(trimmed)}_${now}`;
  const result = await db.runAsync(
    'INSERT INTO contacts (name, folder_name, created_at) VALUES (?, ?, ?)',
    [trimmed, folderName, now]
  );

  return {
    id: result.lastInsertRowId,
    name: trimmed,
    folderName,
    createdAt: now,
    photoCount: 0,
    videoCount: 0,
    lastMediaAt: null,
  };
}

export async function deleteContact(contactId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM contacts WHERE id = ?', [contactId]);
}

export async function getContactHashes(contactId: number): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ sha256: string }>(
    'SELECT sha256 FROM media_items WHERE contact_id = ?',
    [contactId]
  );
  return new Set(rows.map((r) => r.sha256));
}

export async function insertMediaItem(item: Omit<VaultMedia, 'id' | 'contactName'>): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO media_items (
      contact_id, file_name, vault_uri, original_uri,
      media_type, mime_type, size_bytes, sha256,
      is_encrypted, created_at, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.contactId,
      item.fileName,
      item.vaultUri,
      item.originalUri,
      item.mediaType,
      item.mimeType,
      item.sizeBytes,
      item.sha256,
      item.isEncrypted ? 1 : 0,
      item.createdAt,
      item.importedAt,
    ]
  );
  return result.lastInsertRowId;
}

export async function listAllMedia(): Promise<VaultMedia[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    contact_id: number;
    contact_name: string;
    file_name: string;
    vault_uri: string;
    original_uri: string | null;
    media_type: MediaType;
    mime_type: string;
    size_bytes: number;
    sha256: string;
    is_encrypted: number;
    created_at: number;
    imported_at: number;
  }>(`
    SELECT
      m.*,
      c.name AS contact_name
    FROM media_items m
    INNER JOIN contacts c ON c.id = m.contact_id
    ORDER BY m.imported_at DESC
  `);

  return rows.map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    contactName: r.contact_name,
    fileName: r.file_name,
    vaultUri: r.vault_uri,
    originalUri: r.original_uri,
    mediaType: r.media_type,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    isEncrypted: r.is_encrypted === 1,
    createdAt: r.created_at,
    importedAt: r.imported_at,
  }));
}

export async function deleteMediaItem(mediaId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM media_items WHERE id = ?', [mediaId]);
}
