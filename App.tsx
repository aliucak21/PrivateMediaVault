import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { VaultColors } from './src/theme/colors';
import type {
  Contact,
  MainTab,
  MediaType,
  PendingImportItem,
  SortOrder,
  VaultMedia,
  VaultSettings,
} from './src/types/vault';
import {
  filterAndSortMedia,
  formatBytes,
  formatDateTr,
} from './src/utils/vaultCore';
import {
  createContact,
  deleteContact,
  deleteMediaItem,
  listAllMedia,
  listContacts,
} from './src/services/database';
import {
  isBiometricAvailable,
  loadSettings,
  saveSettings,
  setPin,
} from './src/services/security';
import {
  clearDecryptedCache,
  deleteContactFolder,
  deleteVaultFile,
  ensureVaultRoot,
  requestWhatsAppSafFolder,
  scanSafDirectoryForMedia,
} from './src/services/vaultStorage';
import {
  consumePendingSharedMedia,
  subscribeToSharedMedia,
} from './src/services/shareIntent';
import {
  findWhatsAppMediaFolders,
  hasAllFilesAccess,
  isNotificationAccessEnabled,
  openAllFilesAccessSettings,
  openBatteryOptimizationSettings,
  openNotificationAccessSettings,
  subscribeToWhatsAppNotifications,
  syncWhatsAppWithNotifications,
} from './src/services/notificationWatcher';
import { LockScreen } from './src/components/LockScreen';
import { MediaViewerModal } from './src/components/MediaViewerModal';
import { ImportModal } from './src/components/ImportModal';

export default function App() {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [settings, setSettings] = useState<VaultSettings>({
    pinSet: false,
    biometricEnabled: false,
    autoLockOnBackground: true,
    encryptionEnabled: false,
    lastSelectedContactId: null,
    whatsappSafUri: null,
    whatsappSafUris: [],
    autoSyncEnabled: false,
    autoDeleteOriginalOnSync: false,
    lastSyncAt: null,
  });
  const [notifAccessOk, setNotifAccessOk] = useState(false);
  const [allFilesOk, setAllFilesOk] = useState(false);
  const [autoDetectedFolders, setAutoDetectedFolders] = useState<string[]>([]);
  const [syncingAuto, setSyncingAuto] = useState(false);
  const [lastSyncInfo, setLastSyncInfo] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<MainTab>('vault');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [mediaList, setMediaList] = useState<VaultMedia[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [contactFilterType, setContactFilterType] = useState<MediaType | 'all'>('all');

  const [newContactName, setNewContactName] = useState('');
  const [viewerMedia, setViewerMedia] = useState<VaultMedia | null>(null);
  const [pendingImports, setPendingImports] = useState<PendingImportItem[]>([]);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [newPinDraft, setNewPinDraft] = useState('');
  const [bioHardwareOk, setBioHardwareOk] = useState(false);

  const refreshData = useCallback(async () => {
    const [cList, mList] = await Promise.all([listContacts(), listAllMedia()]);
    setContacts(cList);
    setMediaList(mList);
    setSelectedContact((prev) =>
      prev ? cList.find((c) => c.id === prev.id) || null : null
    );
  }, []);

  const checkPendingShares = useCallback(async () => {
    const shared = await consumePendingSharedMedia();
    if (shared.length > 0) {
      setPendingImports((prev) => [...prev, ...shared]);
      setImportModalVisible(true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await ensureVaultRoot();
      const [loadedSettings, bioOk, notifOk, filesOk] = await Promise.all([
        loadSettings(),
        isBiometricAvailable(),
        isNotificationAccessEnabled(),
        hasAllFilesAccess(),
      ]);
      const detected = filesOk ? await findWhatsAppMediaFolders() : [];
      setSettings(loadedSettings);
      setBioHardwareOk(bioOk);
      setNotifAccessOk(notifOk);
      setAllFilesOk(filesOk);
      setAutoDetectedFolders(detected);
      await refreshData();
      setReady(true);
    })();
  }, [refreshData]);

  const runAutoSync = useCallback(
    async (silent = false) => {
      if (syncingAuto) return;
      const detectedNow = allFilesOk ? await findWhatsAppMediaFolders() : [];
      if (detectedNow.length > 0) setAutoDetectedFolders(detectedNow);

      const allSafUris = Array.from(
        new Set([
          ...detectedNow,
          ...(settings.whatsappSafUris || []),
          ...(settings.whatsappSafUri ? [settings.whatsappSafUri] : []),
        ])
      );
      if (allSafUris.length === 0 || contacts.length === 0) {
        if (!silent) {
          Alert.alert(
            'Eksik Kurulum',
            'Otomatik aktarım için en az 1 kişi ekleyin ve "Tüm Dosyalara Erişim" iznini verin (veya WhatsApp klasörünü bağlayın).'
          );
        }
        return;
      }

      try {
        setSyncingAuto(true);
        const report = await syncWhatsAppWithNotifications(contacts, allSafUris, {
          encrypt: settings.encryptionEnabled,
          deleteOriginals: settings.autoDeleteOriginalOnSync,
        });
        const next = await saveSettings({ lastSyncAt: Date.now() });
        setSettings(next);

        if (report.syncedCount > 0) {
          await refreshData();
          const msg = `${report.syncedCount} dosya (${report.matchedNames.join(', ')}) kasaya aktarıldı.`;
          setLastSyncInfo(msg);
          if (!silent) Alert.alert('Otomatik Aktarım', msg);
        } else if (!silent) {
          Alert.alert(
            'Yeni Eşleşme Yok',
            'Son WhatsApp bildirimleriyle eşleşen yeni fotoğraf veya video bulunamadı.'
          );
        }
      } finally {
        setSyncingAuto(false);
      }
    },
    [
      syncingAuto,
      allFilesOk,
      settings.whatsappSafUris,
      settings.whatsappSafUri,
      settings.encryptionEnabled,
      settings.autoDeleteOriginalOnSync,
      contacts,
      refreshData,
    ]
  );

  useEffect(() => {
    if (!unlocked) return;
    checkPendingShares();
    const unsubShare = subscribeToSharedMedia(() => {
      checkPendingShares();
    });
    const unsubNotif = subscribeToWhatsAppNotifications(() => {
      if (settings.autoSyncEnabled) {
        setTimeout(() => {
          runAutoSync(true);
        }, 2500);
      }
    });
    if (settings.autoSyncEnabled) {
      runAutoSync(true);
    }
    return () => {
      unsubShare();
      unsubNotif();
    };
  }, [unlocked, checkPendingShares, settings.autoSyncEnabled, runAutoSync]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        const [notifOk, filesOk] = await Promise.all([
          isNotificationAccessEnabled(),
          hasAllFilesAccess(),
        ]);
        setNotifAccessOk(notifOk);
        setAllFilesOk(filesOk);
        if (filesOk) {
          setAutoDetectedFolders(await findWhatsAppMediaFolders());
        }
      } else {
        clearDecryptedCache();
        if (settings.autoLockOnBackground && settings.pinSet) {
          setUnlocked(false);
        }
      }
    });
    return () => sub.remove();
  }, [settings.autoLockOnBackground, settings.pinSet]);

  const handleUnlock = useCallback(async () => {
    const updated = await loadSettings();
    setSettings(updated);
    setUnlocked(true);
    await refreshData();
  }, [refreshData]);

  const handlePickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;

    const mapped: PendingImportItem[] = result.assets.map((asset, idx) => ({
      uri: asset.uri,
      fileName: asset.fileName || `galeri_${Date.now()}_${idx}.${asset.type === 'video' ? 'mp4' : 'jpg'}`,
      mimeType: asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      size: asset.fileSize || 0,
      isSafUri: false,
      createdAt: Date.now(),
    }));
    setPendingImports(mapped);
    setImportModalVisible(true);
  };

  const handleScanWhatsAppSaf = async () => {
    try {
      if (allFilesOk && autoDetectedFolders.length > 0) {
        const allFound: PendingImportItem[] = [];
        for (const folder of autoDetectedFolders) {
          const items = await scanSafDirectoryForMedia(folder);
          allFound.push(...items);
        }
        if (allFound.length > 0) {
          setPendingImports(allFound);
          setImportModalVisible(true);
          return;
        }
      }

      let dirUri = settings.whatsappSafUri;
      if (!dirUri) {
        Alert.alert(
          'WhatsApp Klasör İzni',
          'Açılacak ekranda WhatsApp medya klasörünü (Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images veya Video) seçip "Bu klasörü kullan" deyin.',
          [
            { text: 'İptal', style: 'cancel' },
            {
              text: 'Klasör Seç',
              onPress: async () => {
                const chosen = await requestWhatsAppSafFolder();
                if (!chosen) return;
                const next = await saveSettings({ whatsappSafUri: chosen });
                setSettings(next);
                const found = await scanSafDirectoryForMedia(chosen);
                if (found.length === 0) {
                  Alert.alert('Medya Bulunamadı', 'Seçilen klasörde fotoğraf veya video bulunamadı.');
                  return;
                }
                setPendingImports(found);
                setImportModalVisible(true);
              },
            },
          ]
        );
        return;
      }

      const found = await scanSafDirectoryForMedia(dirUri);
      if (found.length === 0) {
        Alert.alert('Yeni Medya Yok', 'Bağlı WhatsApp klasöründe içe aktarılacak dosya bulunamadı.');
        return;
      }
      setPendingImports(found);
      setImportModalVisible(true);
    } catch {
      Alert.alert(
        'Klasör Erişim Hatası',
        'Seçili klasöre erişilemedi. Ayarlardan WhatsApp klasörünü yeniden seçebilirsiniz.'
      );
    }
  };

  const handleAddContact = async () => {
    const trimmed = newContactName.trim();
    if (!trimmed) return;
    await createContact(trimmed);
    setNewContactName('');
    await refreshData();
  };

  const handleDeleteContact = (contact: Contact) => {
    Alert.alert(
      'Kişi Arşivini Sil',
      `${contact.name} kişisine ait tüm gizli fotoğraf ve videolar kalıcı olarak silinecek. Emin misiniz?`,
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            await deleteContactFolder(contact);
            await deleteContact(contact.id);
            if (selectedContact?.id === contact.id) setSelectedContact(null);
            await refreshData();
          },
        },
      ]
    );
  };

  const handleDeleteMedia = async (media: VaultMedia) => {
    await deleteVaultFile(media.vaultUri);
    await deleteMediaItem(media.id);
    setViewerMedia(null);
    await refreshData();
  };

  const handleUpdateSetting = async (partial: Partial<VaultSettings>) => {
    const next = await saveSettings(partial);
    setSettings(next);
  };

  const handleChangePin = async () => {
    if (!/^\d{4,6}$/.test(newPinDraft)) {
      Alert.alert('Geçersiz PIN', 'PIN kodu 4 ile 6 rakam arasında olmalıdır.');
      return;
    }
    await setPin(newPinDraft);
    setNewPinDraft('');
    Alert.alert('Güncellendi', 'Kasa PIN kodu başarıyla değiştirildi.');
  };

  const totalPhotos = useMemo(
    () => mediaList.filter((m) => m.mediaType === 'photo').length,
    [mediaList]
  );
  const totalVideos = useMemo(
    () => mediaList.filter((m) => m.mediaType === 'video').length,
    [mediaList]
  );
  const totalBytes = useMemo(
    () => mediaList.reduce((acc, m) => acc + m.sizeBytes, 0),
    [mediaList]
  );

  const visibleMedia = useMemo(() => {
    if (selectedContact) {
      return filterAndSortMedia(mediaList, {
        contactId: selectedContact.id,
        mediaType: contactFilterType,
        query: searchQuery,
        sortOrder,
      });
    }
    if (activeTab === 'photos') {
      return filterAndSortMedia(mediaList, {
        mediaType: 'photo',
        query: searchQuery,
        sortOrder,
      });
    }
    if (activeTab === 'videos') {
      return filterAndSortMedia(mediaList, {
        mediaType: 'video',
        query: searchQuery,
        sortOrder,
      });
    }
    return filterAndSortMedia(mediaList, {
      mediaType: 'all',
      query: searchQuery,
      sortOrder: 'newest',
    });
  }, [mediaList, selectedContact, contactFilterType, searchQuery, sortOrder, activeTab]);

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={VaultColors.primary} />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!unlocked) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <LockScreen
          isSetupMode={!settings.pinSet}
          biometricEnabled={settings.biometricEnabled}
          onUnlock={handleUnlock}
        />
      </SafeAreaProvider>
    );
  }

  const renderMediaGrid = (items: VaultMedia[]) => (
    <FlatList
      data={items}
      keyExtractor={(item) => String(item.id)}
      numColumns={3}
      contentContainerStyle={styles.gridContent}
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Ionicons name="images-outline" size={40} color={VaultColors.textDim} />
          <Text style={styles.emptyTitle}>Henüz gizli medya yok</Text>
          <Text style={styles.emptySub}>
            WhatsApp’tan paylaşabilir veya aşağıdan dosya ekleyebilirsiniz.
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.gridTile}
          onPress={() => setViewerMedia(item)}
        >
          {item.isEncrypted ? (
            <View style={styles.encryptedThumb}>
              <Ionicons
                name={item.mediaType === 'video' ? 'videocam' : 'lock-closed'}
                size={24}
                color={VaultColors.primary}
              />
              <Text style={styles.encryptedLabel}>Şifreli</Text>
            </View>
          ) : (
            <Image source={{ uri: item.vaultUri }} style={styles.thumbImg} />
          )}
          {item.mediaType === 'video' && !item.isEncrypted && (
            <View style={styles.videoBadge}>
              <Ionicons name="play" size={12} color="#fff" />
            </View>
          )}
        </TouchableOpacity>
      )}
    />
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />

        {/* Üst Başlık */}
        <View style={styles.topHeader}>
          {selectedContact ? (
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => setSelectedContact(null)}
            >
              <Ionicons name="arrow-back" size={22} color={VaultColors.text} />
            </TouchableOpacity>
          ) : (
            <Ionicons name="shield-checkmark" size={24} color={VaultColors.primary} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>
              {selectedContact ? selectedContact.name : 'Özel Medya Kasası'}
            </Text>
            <Text style={styles.headerSub}>
              {selectedContact
                ? `${selectedContact.photoCount || 0} fotoğraf • ${selectedContact.videoCount || 0} video`
                : 'Galeri dışı güvenli yerel arşiv'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.lockNowBtn}
            onPress={() => setUnlocked(false)}
          >
            <Ionicons name="lock-closed-outline" size={20} color={VaultColors.text} />
          </TouchableOpacity>
        </View>

        {/* Kişi Arşivi Detayı */}
        {selectedContact ? (
          <View style={styles.body}>
            <View style={styles.filterBar}>
              {(['all', 'photo', 'video'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.filterChip,
                    contactFilterType === t && styles.filterChipActive,
                  ]}
                  onPress={() => setContactFilterType(t)}
                >
                  <Text style={styles.filterChipText}>
                    {t === 'all' ? 'Tümü' : t === 'photo' ? 'Fotoğraf' : 'Video'}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.sortBtn}
                onPress={() =>
                  setSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))
                }
              >
                <Ionicons name="swap-vertical" size={16} color={VaultColors.accent} />
                <Text style={styles.sortText}>
                  {sortOrder === 'newest' ? 'En Yeni' : 'En Eski'}
                </Text>
              </TouchableOpacity>
            </View>
            {renderMediaGrid(visibleMedia)}
          </View>
        ) : (
          <View style={styles.body}>
            {activeTab === 'vault' && (
              <ScrollView contentContainerStyle={styles.scrollPad}>
                <View style={styles.statsCard}>
                  <Text style={styles.cardTitle}>Kasa Durumu</Text>
                  <View style={styles.statsRow}>
                    <View style={styles.statBox}>
                      <Text style={styles.statVal}>{contacts.length}</Text>
                      <Text style={styles.statLabel}>Kişi</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statVal}>{totalPhotos}</Text>
                      <Text style={styles.statLabel}>Fotoğraf</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statVal}>{totalVideos}</Text>
                      <Text style={styles.statLabel}>Video</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statVal}>{formatBytes(totalBytes)}</Text>
                      <Text style={styles.statLabel}>Boyut</Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.sectionTitle}>Hızlı Medya Aktarımı</Text>
                <TouchableOpacity style={styles.primaryAction} onPress={handleScanWhatsAppSaf}>
                  <Ionicons name="folder-open-outline" size={22} color="#052E16" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.primaryActionTitle}>
                      WhatsApp Klasörünü Tara (SAF)
                    </Text>
                    <Text style={styles.primaryActionSub}>
                      İzin verdiğiniz WhatsApp klasöründeki yeni dosyaları içe aktarın
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity style={styles.secondaryAction} onPress={handlePickFromGallery}>
                  <Ionicons name="images-outline" size={22} color={VaultColors.text} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.secondaryActionTitle}>
                      Cihazdan Toplu Fotoğraf / Video Seç
                    </Text>
                    <Text style={styles.secondaryActionSub}>
                      Çoklu seçimle seçtiğiniz kişinin kasasına ekleyin
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryAction}
                  onPress={() => runAutoSync(false)}
                  disabled={syncingAuto}
                >
                  <Ionicons
                    name={syncingAuto ? 'sync' : 'notifications-outline'}
                    size={22}
                    color={VaultColors.accent}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.secondaryActionTitle}>
                      {syncingAuto
                        ? 'Bildirimler Eşleştiriliyor...'
                        : 'Bildirim + Klasör Eşleştirmeyi Çalıştır'}
                    </Text>
                    <Text style={styles.secondaryActionSub}>
                      {lastSyncInfo ||
                        (notifAccessOk
                          ? 'Son WhatsApp bildirimlerindeki kişilere gelen dosyaları aktarır'
                          : 'Ayarlar’dan Bildirim Erişimi izni verilmesi gerekir')}
                    </Text>
                  </View>
                </TouchableOpacity>

                <View style={styles.infoBanner}>
                  <Ionicons name="logo-whatsapp" size={20} color={VaultColors.primary} />
                  <Text style={styles.infoBannerText}>
                    İpucu: WhatsApp’ta herhangi bir fotoğraf/videoyu seçip{' '}
                    <Text style={{ fontWeight: '700' }}>Paylaş → Özel Medya Kasası</Text> diyerek
                    doğrudan kasaya aktarabilirsiniz.
                  </Text>
                </View>
              </ScrollView>
            )}

            {activeTab === 'contacts' && (
              <View style={{ flex: 1 }}>
                <View style={styles.addContactBar}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Yeni kişi adı..."
                    placeholderTextColor={VaultColors.textDim}
                    value={newContactName}
                    onChangeText={setNewContactName}
                  />
                  <TouchableOpacity style={styles.addContactBtn} onPress={handleAddContact}>
                    <Ionicons name="add" size={22} color="#052E16" />
                  </TouchableOpacity>
                </View>

                <FlatList
                  data={contacts}
                  keyExtractor={(item) => String(item.id)}
                  contentContainerStyle={styles.scrollPad}
                  ListEmptyComponent={
                    <Text style={styles.emptySub}>Henüz kişi eklenmedi.</Text>
                  }
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.contactCard}
                      onPress={() => setSelectedContact(item)}
                    >
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {item.name.slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.contactTitle}>{item.name}</Text>
                        <Text style={styles.contactMeta}>
                          {item.photoCount || 0} fotoğraf • {item.videoCount || 0} video
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={{ padding: 6 }}
                        onPress={() => handleDeleteContact(item)}
                      >
                        <Ionicons name="trash-outline" size={18} color={VaultColors.danger} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}

            {(activeTab === 'photos' || activeTab === 'videos' || activeTab === 'recent') && (
              <View style={{ flex: 1 }}>
                <View style={styles.addContactBar}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Dosya veya kişi adına göre ara..."
                    placeholderTextColor={VaultColors.textDim}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                </View>
                {renderMediaGrid(visibleMedia)}
              </View>
            )}

            {activeTab === 'settings' && (
              <ScrollView contentContainerStyle={styles.scrollPad}>
                <Text style={styles.sectionTitle}>Güvenlik Ayarları</Text>

                <View style={styles.settingCard}>
                  <View style={styles.settingRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.settingTitle}>Parmak İzi / Biyometrik Kilit</Text>
                      <Text style={styles.settingSub}>
                        {bioHardwareOk
                          ? 'Kasa açılışında parmak izi kullan'
                          : 'Bu cihazda biyometrik donanım hazır değil'}
                      </Text>
                    </View>
                    <Switch
                      value={settings.biometricEnabled}
                      disabled={!bioHardwareOk}
                      onValueChange={(v) => handleUpdateSetting({ biometricEnabled: v })}
                    />
                  </View>

                  <View style={styles.settingRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.settingTitle}>Arka Planda Otomatik Kilitle</Text>
                      <Text style={styles.settingSub}>
                        Uygulamadan çıkıldığında kasa anında kilitlenir
                      </Text>
                    </View>
                    <Switch
                      value={settings.autoLockOnBackground}
                      onValueChange={(v) => handleUpdateSetting({ autoLockOnBackground: v })}
                    />
                  </View>

                  <View style={styles.settingRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.settingTitle}>İsteğe Bağlı Dosya Şifreleme</Text>
                      <Text style={styles.settingSub}>
                        8 MB altındaki dosyaları Keystore anahtarıyla şifreler
                      </Text>
                    </View>
                    <Switch
                      value={settings.encryptionEnabled}
                      onValueChange={(v) => handleUpdateSetting({ encryptionEnabled: v })}
                    />
                  </View>
                </View>

                <Text style={styles.sectionTitle}>PIN Değiştir</Text>
                <View style={styles.addContactBar}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Yeni 4-6 haneli PIN"
                    placeholderTextColor={VaultColors.textDim}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={6}
                    value={newPinDraft}
                    onChangeText={setNewPinDraft}
                  />
                  <TouchableOpacity style={styles.addContactBtn} onPress={handleChangePin}>
                    <Ionicons name="checkmark" size={22} color="#052E16" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.sectionTitle}>Otomatik WhatsApp Aktarımı (Bildirim + Klasör)</Text>
                <View style={styles.settingCard}>
                  <View style={styles.settingRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.settingTitle}>Bildirim + Klasör Otomatik Aktarım</Text>
                      <Text style={styles.settingSub}>
                        Bildirimdeki gönderen adını takip edilen kişiyle eşleştirip dosyayı otomatik alır
                      </Text>
                    </View>
                    <Switch
                      value={settings.autoSyncEnabled}
                      onValueChange={(v) => handleUpdateSetting({ autoSyncEnabled: v })}
                    />
                  </View>

                  <View style={styles.settingRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.settingTitle}>Aktarınca Orijinali Sil</Text>
                      <Text style={styles.settingSub}>
                        Kasaya kopyalama doğrulandıktan sonra WhatsApp klasöründen siler
                      </Text>
                    </View>
                    <Switch
                      value={settings.autoDeleteOriginalOnSync}
                      onValueChange={(v) => handleUpdateSetting({ autoDeleteOriginalOnSync: v })}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.secondaryAction}
                  onPress={() => openAllFilesAccessSettings()}
                >
                  <Ionicons
                    name={allFilesOk ? 'checkmark-circle' : 'folder-open-outline'}
                    size={22}
                    color={allFilesOk ? VaultColors.primary : VaultColors.warning}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.secondaryActionTitle}>
                      Tüm Dosyalara Erişim: {allFilesOk ? `Açık (${autoDetectedFolders.length} klasör bulundu)` : 'Kapalı (Otomatik Bul)'}
                    </Text>
                    <Text style={styles.secondaryActionSub}>
                      Açıldığında WhatsApp Images/Video/Private klasörlerini kendisi otomatik bulur
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryAction}
                  onPress={() => openNotificationAccessSettings()}
                >
                  <Ionicons
                    name={notifAccessOk ? 'checkmark-circle' : 'notifications-off-outline'}
                    size={22}
                    color={notifAccessOk ? VaultColors.primary : VaultColors.warning}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.secondaryActionTitle}>
                      Bildirim Erişimi: {notifAccessOk ? 'Açık' : 'Kapalı (İzin Ver)'}
                    </Text>
                    <Text style={styles.secondaryActionSub}>
                      WhatsApp bildirimlerinden gönderen adını okuyabilmek için gereklidir
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryAction}
                  onPress={async () => {
                    const chosen = await requestWhatsAppSafFolder();
                    if (chosen) {
                      const nextList = Array.from(
                        new Set([...(settings.whatsappSafUris || []), chosen])
                      );
                      await handleUpdateSetting({
                        whatsappSafUri: settings.whatsappSafUri || chosen,
                        whatsappSafUris: nextList,
                      });
                      Alert.alert(
                        'Klasör Bağlandı',
                        `Toplam ${nextList.length} WhatsApp klasörü izleniyor (Images ve Video klasörlerini ayrı ayrı ekleyebilirsiniz).`
                      );
                    }
                  }}
                >
                  <Ionicons name="folder-outline" size={20} color={VaultColors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.secondaryActionTitle}>
                      WhatsApp Klasörü Ekle ({(settings.whatsappSafUris || []).length} bağlı)
                    </Text>
                    <Text style={styles.secondaryActionSub} numberOfLines={1}>
                      WhatsApp Images ve WhatsApp Video klasörlerini bağlayın
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryAction}
                  onPress={() => openBatteryOptimizationSettings()}
                >
                  <Ionicons name="battery-charging-outline" size={20} color={VaultColors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.secondaryActionTitle}>
                      Xiaomi Pil Optimizasyonu Ayarları
                    </Text>
                    <Text style={styles.secondaryActionSub}>
                      Arka planda durdurulmaması için "Kısıtlama yok" seçin
                    </Text>
                  </View>
                </TouchableOpacity>

                <View style={styles.warningCard}>
                  <Text style={styles.warningTitle}>Önemli Veri & Cihaz Bilgisi</Text>
                  <Text style={styles.warningText}>
                    • Uygulamayı telefondan kaldırırsanız özel kasadaki tüm yerel dosyalar kalıcı
                    olarak silinir.{'\n'}
                    • Xiaomi (MIUI / HyperOS) cihazlarda arka plan kesintisi yaşamamak için Pil
                    Tasarrufu ayarını "Kısıtlama yok" yapmanız önerilir.{'\n'}
                    • WhatsApp’ın kendi gizlilik sınırları nedeniyle otomatik kişi-medya eşleştirmesi
                    yerine Paylaş menüsü ve SAF klasör taraması kullanılır.
                  </Text>
                </View>
              </ScrollView>
            )}
          </View>
        )}

        {/* Alt Navigasyon */}
        {!selectedContact && (
          <View style={styles.tabBar}>
            {(
              [
                { id: 'vault', label: 'Kasa', icon: 'shield-checkmark-outline' },
                { id: 'contacts', label: 'Kişiler', icon: 'people-outline' },
                { id: 'photos', label: 'Fotoğraf', icon: 'image-outline' },
                { id: 'videos', label: 'Video', icon: 'videocam-outline' },
                { id: 'recent', label: 'Son', icon: 'time-outline' },
                { id: 'settings', label: 'Ayarlar', icon: 'settings-outline' },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={styles.tabItem}
                  onPress={() => setActiveTab(tab.id)}
                >
                  <Ionicons
                    name={tab.icon}
                    size={20}
                    color={active ? VaultColors.primary : VaultColors.textDim}
                  />
                  <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <MediaViewerModal
          media={viewerMedia}
          onClose={() => setViewerMedia(null)}
          onDelete={handleDeleteMedia}
        />

        <ImportModal
          visible={importModalVisible}
          items={pendingImports}
          contacts={contacts}
          lastSelectedContactId={settings.lastSelectedContactId}
          encryptionEnabled={settings.encryptionEnabled}
          onClose={() => {
            setImportModalVisible(false);
            setPendingImports([]);
          }}
          onCompleted={refreshData}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: VaultColors.bg },
  center: {
    flex: 1,
    backgroundColor: VaultColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: VaultColors.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: VaultColors.text, fontSize: 18, fontWeight: '700' },
  headerSub: { color: VaultColors.textMuted, fontSize: 12 },
  lockNowBtn: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: VaultColors.surface,
    borderWidth: 1,
    borderColor: VaultColors.border,
  },
  body: { flex: 1 },
  scrollPad: { padding: 16, gap: 14 },
  statsCard: {
    backgroundColor: VaultColors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: VaultColors.border,
  },
  cardTitle: { color: VaultColors.text, fontSize: 15, fontWeight: '700', marginBottom: 12 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statBox: { alignItems: 'center', flex: 1 },
  statVal: { color: VaultColors.primary, fontSize: 18, fontWeight: '800' },
  statLabel: { color: VaultColors.textMuted, fontSize: 12, marginTop: 2 },
  sectionTitle: {
    color: VaultColors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 6,
  },
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: VaultColors.primary,
    borderRadius: 16,
    padding: 16,
  },
  primaryActionTitle: { color: '#052E16', fontSize: 15, fontWeight: '700' },
  primaryActionSub: { color: '#064E3B', fontSize: 12, marginTop: 2 },
  secondaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: VaultColors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: VaultColors.border,
  },
  secondaryActionTitle: { color: VaultColors.text, fontSize: 15, fontWeight: '600' },
  secondaryActionSub: { color: VaultColors.textMuted, fontSize: 12, marginTop: 2 },
  infoBanner: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: VaultColors.primarySoft,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.35)',
  },
  infoBannerText: { flex: 1, color: VaultColors.text, fontSize: 13, lineHeight: 19 },
  addContactBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  searchInput: {
    flex: 1,
    backgroundColor: VaultColors.surface,
    borderWidth: 1,
    borderColor: VaultColors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: VaultColors.text,
  },
  addContactBtn: {
    width: 46,
    borderRadius: 12,
    backgroundColor: VaultColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: VaultColors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: VaultColors.border,
    marginBottom: 10,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: VaultColors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: VaultColors.primary, fontSize: 17, fontWeight: '700' },
  contactTitle: { color: VaultColors.text, fontSize: 16, fontWeight: '600' },
  contactMeta: { color: VaultColors.textMuted, fontSize: 12, marginTop: 2 },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: VaultColors.surface,
    borderWidth: 1,
    borderColor: VaultColors.border,
  },
  filterChipActive: {
    backgroundColor: VaultColors.primarySoft,
    borderColor: VaultColors.primary,
  },
  filterChipText: { color: VaultColors.text, fontSize: 12, fontWeight: '600' },
  sortBtn: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sortText: { color: VaultColors.accent, fontSize: 12, fontWeight: '600' },
  gridContent: { padding: 4 },
  gridTile: {
    flex: 1 / 3,
    aspectRatio: 1,
    margin: 2,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: VaultColors.surface,
  },
  thumbImg: { width: '100%', height: '100%' },
  encryptedThumb: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VaultColors.surfaceElevated,
  },
  encryptedLabel: { color: VaultColors.textMuted, fontSize: 10, marginTop: 4 },
  videoBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 10,
    padding: 4,
  },
  emptyBox: { alignItems: 'center', paddingTop: 64, paddingHorizontal: 24 },
  emptyTitle: { color: VaultColors.text, fontSize: 16, fontWeight: '600', marginTop: 12 },
  emptySub: { color: VaultColors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 6 },
  settingCard: {
    backgroundColor: VaultColors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: VaultColors.border,
    gap: 14,
  },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingTitle: { color: VaultColors.text, fontSize: 14, fontWeight: '600' },
  settingSub: { color: VaultColors.textMuted, fontSize: 12, marginTop: 2 },
  warningCard: {
    backgroundColor: VaultColors.warningSoft,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
  },
  warningTitle: { color: VaultColors.warning, fontSize: 14, fontWeight: '700', marginBottom: 6 },
  warningText: { color: VaultColors.text, fontSize: 12, lineHeight: 18 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: VaultColors.surface,
    borderTopWidth: 1,
    borderTopColor: VaultColors.border,
    paddingVertical: 8,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 2 },
  tabLabel: { color: VaultColors.textDim, fontSize: 10, fontWeight: '600' },
  tabLabelActive: { color: VaultColors.primary },
});
