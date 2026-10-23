package expo.modules.zhixuruntime

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** No key bytes are exported to JS, files, portable backups or Android backups. */
internal class DeviceSecrets(private val alias: String = "com.zhixu.learning.nativeapp.master-v1") {
  @Synchronized private fun key(create: Boolean): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    if (!create) throw RuntimeFailure("SECRET_LOCKED", "设备凭据密钥不可用，请重新配置供应商")
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true).build())
    }.generateKey()
  }

  fun seal(value: String): String {
    val bytes = value.toByteArray(Charsets.UTF_8)
    if (bytes.size > 65536) throw RuntimeFailure("INVALID", "凭据过长")
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key(true))
    val encrypted = cipher.doFinal(bytes)
    return Base64.encodeToString(byteArrayOf(1) + cipher.iv + encrypted, Base64.NO_WRAP)
  }

  fun open(value: String): String {
    try {
      val bytes = Base64.decode(value, Base64.DEFAULT)
      if (bytes.size < 29 || bytes.size > 65565 || bytes[0] != 1.toByte()) throw IllegalArgumentException()
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
      return String(cipher.doFinal(bytes, 13, bytes.size - 13), Charsets.UTF_8)
    } catch (_: Exception) {
      throw RuntimeFailure("SECRET_LOCKED", "设备凭据无法解密，请重新配置供应商")
    }
  }
}
