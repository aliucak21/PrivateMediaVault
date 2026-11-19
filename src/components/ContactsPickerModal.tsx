import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Contacts from 'expo-contacts';
import { Ionicons } from '@expo/vector-icons';
import { VaultColors } from '../theme/colors';

interface ContactsPickerModalProps {
  visible: boolean;
  existingNames: string[];
  onSelectName: (name: string) => void;
  onClose: () => void;
}

interface PhoneContactItem {
  id: string;
  name: string;
  phone?: string;
}

export function ContactsPickerModal({
  visible,
  existingNames,
  onSelectName,
  onClose,
}: ContactsPickerModalProps) {
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [phoneContacts, setPhoneContacts] = useState<PhoneContactItem[]>([]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const { status } = await Contacts.requestPermissionsAsync();
        if (status !== 'granted') {
          if (active) {
            Alert.alert('İzin Gerekli', 'Rehberden kişi seçmek için Kişiler izni vermelisiniz.');
            onClose();
          }
          return;
        }
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        });
        if (!active) return;

        const mapped: PhoneContactItem[] = [];
        const seen = new Set<string>();
        for (const c of data) {
          const name = (c.name || '').trim();
          if (!name) continue;
          const key = name.toLocaleLowerCase('tr-TR');
          if (seen.has(key)) continue;
          seen.add(key);
          mapped.push({
            id: c.id || key,
            name,
            phone: c.phoneNumbers?.[0]?.number,
          });
        }
        mapped.sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'));
        setPhoneContacts(mapped);
      } catch (err) {
        if (active) {
          Alert.alert(
            'Hata',
            err instanceof Error ? `Telefon rehberi okunamadı: ${err.message}` : 'Telefon rehberi okunamadı.'
          );
          onClose();
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [visible]);

  const existingSet = useMemo(
    () => new Set(existingNames.map((n) => n.trim().toLocaleLowerCase('tr-TR'))),
    [existingNames]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR');
    if (!q) return phoneContacts;
    return phoneContacts.filter(
      (c) =>
        c.name.toLocaleLowerCase('tr-TR').includes(q) ||
        (c.phone || '').toLowerCase().includes(q)
    );
  }, [phoneContacts, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Rehberden Kişi Seç</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={VaultColors.textMuted} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.searchInput}
            placeholder="Rehberde ara..."
            placeholderTextColor={VaultColors.textDim}
            value={query}
            onChangeText={setQuery}
          />

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={VaultColors.primary} />
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={styles.emptyText}>Eşleşen kişi bulunamadı.</Text>
              }
              renderItem={({ item }) => {
                const alreadyAdded = existingSet.has(item.name.toLocaleLowerCase('tr-TR'));
                return (
                  <TouchableOpacity
                    style={[styles.row, alreadyAdded && styles.rowDisabled]}
                    disabled={alreadyAdded}
                    onPress={() => {
                      onSelectName(item.name);
                      onClose();
                    }}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{item.name}</Text>
                      {item.phone ? <Text style={styles.phone}>{item.phone}</Text> : null}
                    </View>
                    {alreadyAdded ? (
                      <Text style={styles.addedBadge}>Ekli</Text>
                    ) : (
                      <Ionicons name="add-circle-outline" size={22} color={VaultColors.primary} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          )}
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
    height: '78%',
    borderTopWidth: 1,
    borderColor: VaultColors.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { color: VaultColors.text, fontSize: 18, fontWeight: '700' },
  searchInput: {
    backgroundColor: VaultColors.bg,
    borderWidth: 1,
    borderColor: VaultColors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: VaultColors.text,
    marginBottom: 12,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: VaultColors.textDim, textAlign: 'center', paddingTop: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: VaultColors.surfaceElevated,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: VaultColors.border,
  },
  rowDisabled: { opacity: 0.5 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: VaultColors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: VaultColors.primary, fontWeight: '700' },
  name: { color: VaultColors.text, fontSize: 15, fontWeight: '600' },
  phone: { color: VaultColors.textMuted, fontSize: 12 },
  addedBadge: { color: VaultColors.textDim, fontSize: 12, fontWeight: '600' },
});
