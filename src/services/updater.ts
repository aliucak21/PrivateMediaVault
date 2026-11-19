import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

const GITHUB_RELEASE_API =
  'https://api.github.com/repos/aliucak21/PrivateMediaVault/releases/latest';

export const CURRENT_BUILD_NUMBER = Number(
  process.env.EXPO_PUBLIC_BUILD_NUMBER || '0'
);

export interface UpdateCheckResult {
  hasUpdate: boolean;
  latestTag: string;
  latestBuildNumber: number;
  apkUrl: string | null;
}

export function parseBuildNumberFromTag(tag: string): number {
  const match = tag.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  const response = await fetch(GITHUB_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
  });

  if (!response.ok) {
    throw new Error('Güncelleme sunucusuna bağlanılamadı.');
  }

  const data = (await response.json()) as {
    tag_name?: string;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  };

  const latestTag = data.tag_name || 'v1.0.0';
  const latestBuildNumber = parseBuildNumberFromTag(latestTag);
  const apkAsset = data.assets?.find((a) => (a.name || '').endsWith('.apk'));

  return {
    hasUpdate: Boolean(apkAsset?.browser_download_url) && latestBuildNumber > CURRENT_BUILD_NUMBER,
    latestTag,
    latestBuildNumber,
    apkUrl: apkAsset?.browser_download_url || null,
  };
}

export async function downloadAndInstallApk(
  apkUrl: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('Uygulama içi APK güncelleme yalnızca Android’de desteklenir.');
  }

  const destUri = `${FileSystem.cacheDirectory}PrivateMediaVault-update.apk`;
  await FileSystem.deleteAsync(destUri, { idempotent: true });

  const downloadResumable = FileSystem.createDownloadResumable(
    apkUrl,
    destUri,
    {},
    (progress) => {
      if (progress.totalBytesExpectedToWrite > 0 && onProgress) {
        const pct = Math.round(
          (progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100
        );
        onProgress(pct);
      }
    }
  );

  const result = await downloadResumable.downloadAsync();
  if (!result?.uri) {
    throw new Error('APK dosyası indirilemedi.');
  }

  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  const mod = NativeModules.ShareIntentModule as
    | { installApk?: (uri: string) => Promise<boolean> }
    | undefined;

  if (!mod?.installApk) {
    throw new Error('Yükleyici modülü bulunamadı.');
  }

  await mod.installApk(contentUri);
}
