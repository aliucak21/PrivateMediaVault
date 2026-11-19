import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMediaType,
  filterAndSortMedia,
  formatBytes,
  isDuplicateHash,
  sanitizeFileName,
  sanitizeFolderName,
} from '../src/utils/vaultCore.ts';
import type { VaultMedia } from '../src/types/vault.ts';

describe('vaultCore', () => {
  it('detects photo and video types from mime or extension', () => {
    assert.equal(detectMediaType('IMG-2026-WA0001.jpg', 'image/jpeg'), 'photo');
    assert.equal(detectMediaType('VID-2026-WA0002.mp4', 'video/mp4'), 'video');
    assert.equal(detectMediaType('clip.mkv', null), 'video');
    assert.equal(detectMediaType('doc.pdf', 'application/pdf'), null);
  });

  it('sanitizes Turkish folder names safely', () => {
    assert.equal(sanitizeFolderName('Çağrı Şahin!'), 'cagri_sahin');
    assert.equal(sanitizeFolderName('   '), 'kisi');
  });

  it('sanitizes file names and adds fallback extension', () => {
    assert.equal(sanitizeFileName('foto (1).jpg'), 'foto__1_.jpg');
    assert.match(sanitizeFileName('noext', 'mp4'), /^medya_\d+\.mp4$/);
  });

  it('formats byte sizes cleanly', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MB');
  });

  it('detects duplicate hashes', () => {
    const existing = new Set(['abc123']);
    assert.equal(isDuplicateHash(existing, 'abc123'), true);
    assert.equal(isDuplicateHash(existing, 'xyz999'), false);
  });

  it('filters and sorts media by contact, type, query and date', () => {
    const sample: VaultMedia[] = [
      {
        id: 1,
        contactId: 10,
        contactName: 'Ahmet',
        fileName: 'tatil.jpg',
        vaultUri: 'file:///1.jpg',
        originalUri: null,
        mediaType: 'photo',
        mimeType: 'image/jpeg',
        sizeBytes: 1000,
        sha256: 'h1',
        isEncrypted: false,
        createdAt: 100,
        importedAt: 100,
      },
      {
        id: 2,
        contactId: 10,
        contactName: 'Ahmet',
        fileName: 'konser.mp4',
        vaultUri: 'file:///2.mp4',
        originalUri: null,
        mediaType: 'video',
        mimeType: 'video/mp4',
        sizeBytes: 5000,
        sha256: 'h2',
        isEncrypted: false,
        createdAt: 300,
        importedAt: 300,
      },
      {
        id: 3,
        contactId: 20,
        contactName: 'Zeynep',
        fileName: 'fatura.png',
        vaultUri: 'file:///3.png',
        originalUri: null,
        mediaType: 'photo',
        mimeType: 'image/png',
        sizeBytes: 800,
        sha256: 'h3',
        isEncrypted: false,
        createdAt: 200,
        importedAt: 200,
      },
    ];

    const ahmetNewest = filterAndSortMedia(sample, {
      contactId: 10,
      mediaType: 'all',
      sortOrder: 'newest',
    });
    assert.deepEqual(ahmetNewest.map((m) => m.id), [2, 1]);

    const ahmetPhotos = filterAndSortMedia(sample, {
      contactId: 10,
      mediaType: 'photo',
    });
    assert.deepEqual(ahmetPhotos.map((m) => m.id), [1]);

    const searchZeynep = filterAndSortMedia(sample, { query: 'zeynep' });
    assert.deepEqual(searchZeynep.map((m) => m.id), [3]);
  });
});
