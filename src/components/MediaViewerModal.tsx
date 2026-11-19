import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { VaultColors } from '../theme/colors';
import type { VaultMedia } from '../types/vault';
import { formatBytes, formatDateTr } from '../utils/vaultCore';
import {
  exportMediaToGallery,
  resolvePlayableUri,
  shareMediaOut,
} from '../services/vaultStorage';

interface MediaViewerModalProps {
  media: VaultMedia | null;
  onClose: () => void;
  onDelete: (media: VaultMedia) => void;
}

function VaultVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });

  return (
    <VideoView
      style={styles.videoView}
      player={player}
      allowsPictureInPicture={false}
    />
  );
}

export function MediaViewerModal({ media, onClose, onDelete }: MediaViewerModalProps) {
  const [resolvedUri, setResolvedUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setResolvedUri(null);
    if (!media) return;
    (async () => {
      try {
        const uri = await resolvePlayableUri(media);
        if (active) setResolvedUri(uri);
      } catch {
        if (active) Alert.alert('Hata', 'Medya dosyası açılamadı.');
      }
    })();
    return () => {
      active = false;
    };
  }, [media]);

  if (!media) return null;

  const handleSaveToGallery = async () => {
    try {
      setBusy(true);
      await exportMediaToGallery(media);
      Alert.alert('Başarılı', 'Medya telefon galerisine kopyalandı.');
    } catch (err) {
      Alert.alert('Hata', err instanceof Error ? err.message : 'Dışa aktarma başarısız.');
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    try {
      setBusy(true);
      await shareMediaOut(media);
    } catch (err) {
      Alert.alert('Hata', err instanceof Error ? err.message : 'Paylaşılamadı.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Kasadan Sil',
      'Bu dosya özel kasadan kalıcı olarak silinecek. Emin misiniz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: () => onDelete(media),
        },
      ]
    );
  };

  return (
    <Modal visible={Boolean(media)} animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn}>
            <Ionicons name="close" size={24} color={VaultColors.text} />
          </TouchableOpacity>
          <View style={styles.metaBox}>
            <Text style={styles.fileName} numberOfLines={1}>
              {media.fileName}
            </Text>
            <Text style={styles.fileMeta}>
              {media.contactName || 'Kişi'} • {formatBytes(media.sizeBytes)} •{' '}
              {formatDateTr(media.createdAt)}
            </Text>
          </View>
        </View>

        <View style={styles.stage}>
          {!resolvedUri ? (
            <ActivityIndicator size="large" color={VaultColors.primary} />
          ) : media.mediaType === 'video' ? (
            <VaultVideoPlayer uri={resolvedUri} />
          ) : (
            <Image source={{ uri: resolvedUri }} style={styles.image} resizeMode="contain" />
          )}
        </View>

        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleSaveToGallery} disabled={busy}>
            <Ionicons name="download-outline" size={20} color={VaultColors.text} />
            <Text style={styles.actionText}>Galeriye Aktar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleShare} disabled={busy}>
            <Ionicons name="share-outline" size={20} color={VaultColors.text} />
            <Text style={styles.actionText}>Paylaş</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={confirmDelete} disabled={busy}>
            <Ionicons name="trash-outline" size={20} color={VaultColors.danger} />
            <Text style={[styles.actionText, { color: VaultColors.danger }]}>Sil</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(9,13,22,0.9)',
  },
  iconBtn: {
    padding: 8,
    marginRight: 8,
  },
  metaBox: {
    flex: 1,
  },
  fileName: {
    color: VaultColors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  fileMeta: {
    color: VaultColors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  stage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  videoView: {
    width: '100%',
    height: '100%',
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    paddingBottom: 28,
    backgroundColor: 'rgba(9,13,22,0.92)',
    borderTopWidth: 1,
    borderTopColor: VaultColors.border,
  },
  actionBtn: {
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    color: VaultColors.text,
    fontSize: 12,
    fontWeight: '500',
  },
});
