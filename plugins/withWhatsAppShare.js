const { withAndroidManifest, withMainActivity, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config Plugin:
 * 1. android:allowBackup="false" ayarlar.
 * 2. MainActivity'ye ACTION_SEND ve ACTION_SEND_MULTIPLE (image/*, video/*) intent-filter ekler.
 * 3. WhatsAppNotificationListener (NotificationListenerService) servisini Manifest'e ekler.
 * 4. ShareIntentModule + NotificationBridge (Kotlin) dosyalarını Android projesine yazar.
 */
function withWhatsAppShare(config) {
  // 1. AndroidManifest düzenlemesi
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest.application?.[0];
    if (!application) return config;

    application.$['android:allowBackup'] = 'false';

    // Kişisel APK için WhatsApp klasörlerini otomatik bulabilme izni
    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    const hasManageStorage = manifest.manifest['uses-permission'].some(
      (p) => p.$['android:name'] === 'android.permission.MANAGE_EXTERNAL_STORAGE'
    );
    if (!hasManageStorage) {
      manifest.manifest['uses-permission'].push({
        $: { 'android:name': 'android.permission.MANAGE_EXTERNAL_STORAGE' },
      });
    }

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

    // NotificationListenerService kaydı
    application.service = application.service || [];
    const hasNotifService = application.service.some(
      (s) => s.$['android:name'] === '.WhatsAppNotificationListener'
    );
    if (!hasNotifService) {
      application.service.push({
        $: {
          'android:name': '.WhatsAppNotificationListener',
          'android:label': 'Özel Medya Kasası Bildirim Dinleyici',
          'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.service.notification.NotificationListenerService',
                },
              },
            ],
          },
        ],
      });
    }

    return config;
  });

  // 2. Kotlin Modülleri ve WhatsAppNotificationListener oluştur
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

      const listenerKt = `package ${packageName}

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

object NotificationEventStore {
    private const val PREFS_NAME = "wa_vault_notif_prefs"
    private const val KEY_EVENTS = "wa_notif_events"
    private const val MAX_EVENTS = 80

    @Synchronized
    fun record(context: Context, senderName: String, text: String, timestamp: Long) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_EVENTS, "[]") ?: "[]"
        val arr = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }

        val obj = JSONObject().apply {
            put("senderName", senderName)
            put("text", text)
            put("timestamp", timestamp)
        }
        arr.put(obj)

        // Yalnızca son MAX_EVENTS kaydını tut
        val trimmed = JSONArray()
        val start = maxOf(0, arr.length() - MAX_EVENTS)
        for (i in start until arr.length()) {
            trimmed.put(arr.get(i))
        }
        prefs.edit().putString(KEY_EVENTS, trimmed.toString()).apply()
    }

    @Synchronized
    fun readAll(context: Context): JSONArray {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_EVENTS, "[]") ?: "[]"
        return try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
    }

    @Synchronized
    fun clear(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_EVENTS, "[]").apply()
    }
}

class WhatsAppNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val pkg = sbn.packageName ?: return
        if (pkg != "com.whatsapp" && pkg != "com.whatsapp.w4b") return

        val notification = sbn.notification ?: return
        if ((notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return

        val extras = notification.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: return
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim() ?: ""

        if (title.isEmpty() || title.equals("WhatsApp", ignoreCase = true)) return

        val timestamp = if (sbn.postTime > 0) sbn.postTime else System.currentTimeMillis()
        NotificationEventStore.record(applicationContext, title, text, timestamp)

        val reactCtx = (application as? com.facebook.react.ReactApplication)
            ?.reactHost?.currentReactContext as? com.facebook.react.bridge.ReactApplicationContext
        ShareIntentModule.emitWhatsAppNotification(reactCtx)
    }
}
`;

      fs.writeFileSync(path.join(targetDir, 'WhatsAppNotificationListener.kt'), listenerKt, 'utf8');

      const moduleKt = `package ${packageName}

import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.OpenableColumns
import android.provider.Settings
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

    @ReactMethod
    fun isNotificationAccessEnabled(promise: Promise) {
        try {
            val cn = ComponentName(reactContext, WhatsAppNotificationListener::class.java)
            val flat = Settings.Secure.getString(
                reactContext.contentResolver,
                "enabled_notification_listeners"
            ) ?: ""
            val enabled = flat.contains(cn.flattenToString()) || flat.contains(reactContext.packageName)
            promise.resolve(enabled)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun openNotificationAccessSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SETTINGS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun openBatteryOptimizationSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("BATTERY_SETTINGS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getCapturedNotifications(promise: Promise) {
        try {
            val arr = NotificationEventStore.readAll(reactContext)
            val result: WritableArray = Arguments.createArray()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val map = Arguments.createMap()
                map.putString("senderName", obj.optString("senderName", ""))
                map.putString("text", obj.optString("text", ""))
                map.putDouble("timestamp", obj.optDouble("timestamp", 0.0))
                result.pushMap(map)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("NOTIF_READ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun clearCapturedNotifications(promise: Promise) {
        try {
            NotificationEventStore.clear(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("NOTIF_CLEAR_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun hasAllFilesAccess(promise: Promise) {
        try {
            val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Environment.isExternalStorageManager()
            } else {
                true
            }
            promise.resolve(granted)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun openAllFilesAccessSettings(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                    data = Uri.parse("package:\${reactContext.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            try {
                val fallback = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(fallback)
                promise.resolve(true)
            } catch (ex: Exception) {
                promise.reject("ALL_FILES_SETTINGS_ERROR", ex.message, ex)
            }
        }
    }

    @ReactMethod
    fun findWhatsAppMediaFolders(promise: Promise) {
        try {
            val root = Environment.getExternalStorageDirectory()
            val candidates = listOf(
                "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images",
                "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/Private",
                "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video",
                "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video/Private",
                "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Images",
                "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Video",
                "WhatsApp/Media/WhatsApp Images",
                "WhatsApp/Media/WhatsApp Video"
            )
            val found: WritableArray = Arguments.createArray()
            for (rel in candidates) {
                val dir = File(root, rel)
                if (dir.exists() && dir.isDirectory && dir.canRead()) {
                    found.pushString(Uri.fromFile(dir).toString())
                }
            }
            promise.resolve(found)
        } catch (e: Exception) {
            promise.reject("FIND_WA_FOLDERS_ERROR", e.message, e)
        }
    }

    companion object {
        fun emitNewShare(context: ReactApplicationContext?) {
            context?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("onSharedMediaReceived", null)
        }

        fun emitWhatsAppNotification(context: ReactApplicationContext?) {
            context?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("onWhatsAppNotification", null)
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
