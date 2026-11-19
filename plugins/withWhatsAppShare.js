const { withAndroidManifest, withMainActivity, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config Plugin:
 * 1. android:allowBackup="false" ayarlar (yerel kasa güvenliği).
 * 2. MainActivity'ye ACTION_SEND ve ACTION_SEND_MULTIPLE (image/*, video/*) intent-filter ekler.
 * 3. WhatsApp'tan paylaşılan content:// URI'lerini güvenle önbelleğe kopyalayıp JS'e ileten
 *    ShareIntentModule (Kotlin) dosyasını Android projesine ekler.
 */
function withWhatsAppShare(config) {
  // 1. AndroidManifest düzenlemesi
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest.application?.[0];
    if (!application) return config;

    application.$['android:allowBackup'] = 'false';

    const mainActivity = application.activity?.find(
      (act) => act.$['android:name'] === '.MainActivity'
    );

    if (mainActivity) {
      mainActivity.$['android:launchMode'] = 'singleTask';
      mainActivity['intent-filter'] = mainActivity['intent-filter'] || [];

      const hasShareFilter = mainActivity['intent-filter'].some((filter) =>
        filter.action?.some((a) => a.$['android:name'] === 'android.intent.action.SEND')
      );

      if (!hasShareFilter) {
        mainActivity['intent-filter'].push(
          {
            action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
            category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
            data: [
              { $: { 'android:mimeType': 'image/*' } },
              { $: { 'android:mimeType': 'video/*' } },
            ],
          },
          {
            action: [{ $: { 'android:name': 'android.intent.action.SEND_MULTIPLE' } }],
            category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
            data: [
              { $: { 'android:mimeType': 'image/*' } },
              { $: { 'android:mimeType': 'video/*' } },
            ],
          }
        );
      }
    }

    return config;
  });

  // 2. Kotlin ShareIntentModule & Package dosyalarını oluştur
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName = config.android?.package || 'com.privatemediavault.app';
      const packagePath = packageName.replace(/\./g, '/');
      const targetDir = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/java',
        packagePath
      );

      fs.mkdirSync(targetDir, { recursive: true });

      const moduleKt = `package ${packageName}

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.io.FileOutputStream

object ShareIntentHolder {
    private val pendingItems = mutableListOf<Map<String, Any>>()

    @Synchronized
    fun handleIntent(context: android.content.Context, intent: Intent?): Boolean {
        if (intent == null) return false
        val action = intent.action ?: return false
        if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return false

        val uris = mutableListOf<Uri>()
        if (action == Intent.ACTION_SEND) {
            @Suppress("DEPRECATION")
            val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            if (uri != null) uris.add(uri)
        } else {
            @Suppress("DEPRECATION")
            val list = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
            if (list != null) uris.addAll(list)
        }

        if (uris.isEmpty()) return false

        val inboxDir = File(context.cacheDir, "shared_inbox")
        if (!inboxDir.exists()) inboxDir.mkdirs()

        var added = false
        for (uri in uris) {
            try {
                val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"
                val fileName = resolveFileName(context, uri, mimeType)
                val destFile = File(inboxDir, "\${System.currentTimeMillis()}_\${fileName}")

                context.contentResolver.openInputStream(uri)?.use { input ->
                    FileOutputStream(destFile).use { output ->
                        input.copyTo(output)
                    }
                }

                if (destFile.exists() && destFile.length() > 0) {
                    pendingItems.add(
                        mapOf(
                            "uri" to Uri.fromFile(destFile).toString(),
                            "fileName" to fileName,
                            "mimeType" to mimeType,
                            "size" to destFile.length().toDouble()
                        )
                    )
                    added = true
                }
            } catch (_: Exception) {
                // Tekil dosya hatası diğer dosyaları engellemesin
            }
        }
        return added
    }

    private fun resolveFileName(context: android.content.Context, uri: Uri, mimeType: String): String {
        var name: String? = null
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && cursor.moveToFirst()) {
                name = cursor.getString(idx)
            }
        }
        if (!name.isNullOrBlank()) return name!!.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        val ext = if (mimeType.startsWith("video/")) "mp4" else "jpg"
        return "wa_media_\${System.currentTimeMillis()}.\${ext}"
    }

    @Synchronized
    fun consumeItems(): List<Map<String, Any>> {
        val copy = pendingItems.toList()
        pendingItems.clear()
        return copy
    }
}

class ShareIntentModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ShareIntentModule"

    @ReactMethod
    fun getSharedMedia(promise: Promise) {
        try {
            val items = ShareIntentHolder.consumeItems()
            val array: WritableArray = Arguments.createArray()
            for (item in items) {
                val map = Arguments.createMap()
                map.putString("uri", item["uri"] as String)
                map.putString("fileName", item["fileName"] as String)
                map.putString("mimeType", item["mimeType"] as String)
                map.putDouble("size", item["size"] as Double)
                array.pushMap(map)
            }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("SHARE_INTENT_ERROR", e.message, e)
        }
    }

    companion object {
        fun emitNewShare(context: ReactApplicationContext?) {
            context?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("onSharedMediaReceived", null)
        }
    }
}

class ShareIntentPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(ShareIntentModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
`;

      fs.writeFileSync(path.join(targetDir, 'ShareIntentModule.kt'), moduleKt, 'utf8');

      // MainApplication.kt içine ShareIntentPackage ekle
      const mainAppPath = path.join(targetDir, 'MainApplication.kt');
      if (fs.existsSync(mainAppPath)) {
        let mainApp = fs.readFileSync(mainAppPath, 'utf8');
        if (!mainApp.includes('ShareIntentPackage()')) {
          mainApp = mainApp.replace(
            'PackageList(this).packages.apply {',
            'PackageList(this).packages.apply {\n              add(ShareIntentPackage())'
          );
          fs.writeFileSync(mainAppPath, mainApp, 'utf8');
        }
      }

      return config;
    },
  ]);

  // 3. MainActivity.kt içine onCreate / onNewIntent hook ekle
  config = withMainActivity(config, (config) => {
    let src = config.modResults.contents;

    if (!src.includes('import android.content.Intent')) {
      src = src.replace('import android.os.Bundle', 'import android.content.Intent\nimport android.os.Bundle');
    }

    if (!src.includes('ShareIntentHolder.handleIntent')) {
      src = src.replace(
        'super.onCreate(null)',
        'super.onCreate(null)\n    ShareIntentHolder.handleIntent(this, intent)'
      );
      if (!src.includes('ShareIntentHolder.handleIntent')) {
        src = src.replace(
          'super.onCreate(savedInstanceState)',
          'super.onCreate(savedInstanceState)\n    ShareIntentHolder.handleIntent(this, intent)'
        );
      }

      const onNewIntentBlock = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (ShareIntentHolder.handleIntent(this, intent)) {
      val reactCtx = (application as? com.facebook.react.ReactApplication)
        ?.reactHost?.currentReactContext as? com.facebook.react.bridge.ReactApplicationContext
      ShareIntentModule.emitNewShare(reactCtx)
    }
  }
`;
      const lastBrace = src.lastIndexOf('}');
      src = src.slice(0, lastBrace) + onNewIntentBlock + '\n}';
    }

    config.modResults.contents = src;
    return config;
  });

  return config;
}

module.exports = withWhatsAppShare;
