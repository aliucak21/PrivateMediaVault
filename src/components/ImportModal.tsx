import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VaultColors } from '../theme/colors';
import type { Contact, PendingImportItem } from '../types/vault';
import { createContact } from '../services/database';
import { saveSettings } from '../services/security';
import { deleteSafOriginals, importMediaItemsToContact } from '../services/vaultStorage';

interface ImportModalProps {
  visible: boolean;
  items: PendingImportItem[];
  contacts: Contact[];
  lastSelectedContactId: number | null;
  encryptionEnabled: boolean;
  onClose: () => void;
  onCompleted: () => void;
}

export function ImportModal({
  visible,
  items,
  contacts,
  lastSelectedContactId,
  encryptionEnabled,
  onClose,
  onCompleted,
}: ImportModalProps) {
  const [selectedId, setSelectedId] = useState<number | null>(lastSelectedContactId);
  const [newName, setNewName] = useState('');
  const [localContacts, setLocalContacts] = useState<Contact[]>(contacts);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    setLocalContacts(contacts);
    if (lastSelectedContactId && contacts.some((c) => c.id === lastSelectedContactId)) {
      setSelectedId(lastSelectedContactId);
    } else if (contacts.length > 0) {
      setSelectedId(contacts[0].id);
    } else {
      setSelectedId(null);
    }
  }, [contacts, lastSelectedContactId, visible]);

  const handleCreateContact = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const created = await createContact(trimmed);
    setLocalContacts((prev) => [created, ...prev]);
    setSelectedId(created.id);
    setNewName('');
  };

  const handleImport = async () => {
    const target = localContacts.find((c) => c.id === selectedId);
    if (!target) {
      Alert.alert('Kişi Seçilmedi', 'Lütfen medyaların kaydedileceği bir kişi seçin veya oluşturun.');
      return;
    }

    try {
      setImporting(true);
      await saveSettings({ lastSelectedContactId: target.id });
      const summary = await importMediaItemsToContact(target, items, {
        encrypt: encryptionEnabled,
      });

      const msgParts = [
        `${summary.importedCount} dosya kasaya eklendi.`,
        summary.duplicateCount > 0 ? `${summary.duplicateCount} tekrar dosya atlandı.` : null,
        summary.failedCount > 0 ? `${summary.failedCount} dosya aktarılamadı.` : null,
      ].filter(Boolean);

      if (summary.originalUrisToDelete.length > 0) {
        Alert.alert(
          'Aktarım Tamamlandı',
          `${msgParts.join('\n')}\n\nOrijinal dosyalar WhatsApp klasöründen silinsin mi?`,
          [
            {
              text: 'Orijinalleri Koru',
              style: 'cancel',
              onPress: () => {
                onCompleted();
                onClose();
              },
            },
            {
              text: 'Orijinalleri Sil',
              style: 'destructive',
              onPress: async () => {
                await deleteSafOriginals(summary.originalUrisToDelete);
                onCompleted();
                onClose();
              },
            },
          ]
        );
      } else {
        Alert.alert('Aktarım Tamamlandı', msgParts.join('\n'), [
          {
            text: 'Tamam',
            onPress: () => {
              onCompleted();
              onClose();
            },
          },
        ]);
      }
    } catch (err) {
      Alert.alert('Hata', err instanceof Error ? err.message : 'İçe aktarma sırasında hata oluştu.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Kasaya Medya Aktar ({items.length})</Text>
            <TouchableOpacity onPress={onClose} disabled={importing}>
              <Ionicons name="close" size={24} color={VaultColors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Hedef Kişi Arşivi Seç</Text>
          <ScrollView style={styles.contactList}>
            {localContacts.map((c) => {
              const active = c.id === selectedId;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.contactRow, active && styles.contactRowActive]}
                  onPress={() => setSelectedId(c.id)}
                >
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={active ? VaultColors.primary : VaultColors.textMuted}
                  />
                  <Text style={styles.contactName}>{c.name}</Text>
                </TouchableOpacity>
              );
            })}
            {localContacts.length === 0 && (
              <Text style={styles.emptyText}>Henüz kişi yok. Aşağıdan yeni kişi ekleyin.</Text>
            )}
          </ScrollView>

          <View style={styles.newRow}>
            <TextInput
              style={styles.input}
              placeholder="Yeni kişi adı..."
              placeholderTextColor={VaultColors.textDim}
              value={newName}
              onChangeText={setNewName}
            />
            <TouchableOpacity style={styles.addBtn} onPress={handleCreateContact}>
              <Ionicons name="person-add-outline" size={18} color="#fff" />
              <Text style={styles.addBtnText}>Ekle</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.confirmBtn, importing && { opacity: 0.6 }]}
            onPress={handleImport}
            disabled={importing}
          >
            {importing ? (
              <ActivityIndicator color="#052E16" />
            ) : (
              <Text style={styles.confirmBtnText}>Seçili Kişinin Kasasına Aktar</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: VaultColors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '82%',
    borderTopWidth: 1,
    borderColor: VaultColors.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    color: VaultColors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  label: {
    color: VaultColors.textMuted,
    fontSize: 13,
    marginBottom: 8,
  },
  contactList: {
    maxHeight: 200,
    marginBottom: 12,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: VaultColors.surfaceElevated,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: VaultColors.border,
  },
  contactRowActive: {
    borderColor: VaultColors.primary,
    backgroundColor: VaultColors.primarySoft,
  },
  contactName: {
    color: VaultColors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  emptyText: {
    color: VaultColors.textDim,
    fontSize: 13,
    paddingVertical: 12,
  },
  newRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    backgroundColor: VaultColors.bg,
    borderWidth: 1,
    borderColor: VaultColors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: VaultColors.text,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: VaultColors.surfaceElevated,
    borderWidth: 1,
    borderColor: VaultColors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  addBtnText: {
    color: VaultColors.text,
    fontWeight: '600',
  },
  confirmBtn: {
    backgroundColor: VaultColors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#052E16',
    fontSize: 15,
    fontWeight: '700',
  },
});
