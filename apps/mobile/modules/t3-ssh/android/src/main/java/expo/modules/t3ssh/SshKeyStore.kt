package expo.modules.t3ssh

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class SshKeyStore(private val context: Context) {
  private fun file(ref: String): File {
    require(runCatching { UUID.fromString(ref).toString() == ref }.getOrDefault(false))
    val directory = File(context.noBackupFilesDir, "t3-ssh-keys")
    check(directory.isDirectory || directory.mkdirs())
    return File(directory, ref)
  }

  @Synchronized
  private fun storageKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val alias = "t3-ssh-private-keys-v1"
    return (store.getKey(alias, null) as? SecretKey) ?: KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"
    ).apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setKeySize(256)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build())
    }.generateKey()
  }

  fun save(text: String): String {
    val bytes = text.toByteArray(Charsets.UTF_8)
    require(bytes.isNotEmpty() && bytes.size <= SshKeys.MAX_KEY_BYTES)
    val ref = UUID.randomUUID().toString()
    val destination = file(ref)
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, storageKey())
      destination.writeBytes(cipher.iv + cipher.doFinal(bytes))
      return ref
    } catch (error: Exception) {
      destination.delete()
      throw error
    } finally {
      bytes.fill(0)
    }
  }

  fun read(ref: String): ByteArray {
    try {
      val source = file(ref)
      require(source.length() in 29L..(SshKeys.MAX_KEY_BYTES + 28).toLong())
      val encrypted = source.readBytes()
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, storageKey(), GCMParameterSpec(128, encrypted.copyOfRange(0, 12)))
      return cipher.doFinal(encrypted, 12, encrypted.size - 12)
    } catch (_: Exception) {
      throw sshError("SSH_KEY_INVALID", "Stored private key is missing or unreadable")
    }
  }

  fun delete(ref: String) {
    val source = file(ref)
    check(!source.exists() || source.delete())
  }
}
