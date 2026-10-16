package expo.modules.t3ssh

import expo.modules.kotlin.exception.CodedException
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.SecurityUtils
import net.schmizz.sshj.userauth.keyprovider.KeyFormat
import net.schmizz.sshj.userauth.keyprovider.KeyProvider
import net.schmizz.sshj.userauth.keyprovider.KeyProviderUtil
import net.schmizz.sshj.userauth.password.PasswordFinder
import net.schmizz.sshj.userauth.password.Resource
import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.util.encoders.Base64
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.security.Provider
import java.security.PublicKey
import java.security.SecureRandom
import java.security.Security

internal fun sshError(code: String, message: String) = CodedException(code, message, null)

internal object SshCrypto {
  private class SshProvider : Provider("T3SSHBC", 1.0, "T3 SSH cryptography") {
    init { putAll(BouncyCastleProvider()) }
  }

  @Synchronized
  fun initialize() {
    // Android's bundled BC provider lacks algorithms used by SSHJ.
    if (Security.getProvider("T3SSHBC") == null) Security.addProvider(SshProvider())
    SecurityUtils.setRegisterBouncyCastle(false)
    SecurityUtils.setSecurityProvider("T3SSHBC")
  }
}

internal object SshKeys {
  const val MAX_KEY_BYTES = 64 * 1024
  private val random = SecureRandom()

  data class Generated(val privateKey: String, val publicKey: String)
  data class Info(val publicKey: String?, val encrypted: Boolean)

  fun generate(comment: String): Generated {
    require(comment.toByteArray(Charsets.UTF_8).size <= 4096 && comment.none { it.isISOControl() })
    val pair = Ed25519KeyPairGenerator().apply {
      init(Ed25519KeyGenerationParameters(random))
    }.generateKeyPair()
    val seed = (pair.private as Ed25519PrivateKeyParameters).encoded
    val public = (pair.public as Ed25519PublicKeyParameters).encoded
    try {
      return Generated(encodeEd25519(seed, public, comment), "ssh-ed25519 ${Base64.toBase64String(ed25519Blob(public))} $comment")
    } finally {
      seed.fill(0)
    }
  }

  private fun DataOutputStream.string(bytes: ByteArray) {
    writeInt(bytes.size)
    write(bytes)
  }

  private fun DataOutputStream.string(text: String) = string(text.toByteArray(Charsets.UTF_8))

  private fun ed25519Blob(public: ByteArray): ByteArray {
    val bytes = ByteArrayOutputStream()
    DataOutputStream(bytes).apply {
      string("ssh-ed25519")
      string(public)
    }
    return bytes.toByteArray()
  }

  fun encodeEd25519(seed: ByteArray, public: ByteArray, comment: String): String {
    require(seed.size == 32 && public.size == 32)
    val privateBytes = ByteArrayOutputStream()
    val combined = seed + public
    val check = random.nextInt(Int.MAX_VALUE)
    DataOutputStream(privateBytes).apply {
      writeInt(check)
      writeInt(check)
      string("ssh-ed25519")
      string(public)
      string(combined)
      string(comment)
      // PROTOCOL.key pads the private section to the "none" cipher's 8-byte block.
      var padding = 1
      while (privateBytes.size() % 8 != 0) writeByte(padding++)
    }
    val privateBlock = privateBytes.toByteArray()
    val bytes = ByteArrayOutputStream()
    DataOutputStream(bytes).apply {
      write("openssh-key-v1\u0000".toByteArray(Charsets.US_ASCII))
      string("none")
      string("none")
      string(ByteArray(0))
      writeInt(1)
      string(ed25519Blob(public))
      string(privateBlock)
    }
    val encoded = bytes.toByteArray()
    try {
      return "-----BEGIN OPENSSH PRIVATE KEY-----\n" +
        Base64.toBase64String(encoded).chunked(70).joinToString("\n") +
        "\n-----END OPENSSH PRIVATE KEY-----\n"
    } finally {
      combined.fill(0)
      privateBlock.fill(0)
      encoded.fill(0)
    }
  }

  fun publicKey(key: PublicKey): String {
    val blob = Buffer.PlainBuffer().putPublicKey(key).compactData
    val type = Buffer.PlainBuffer(blob).readString()
    return "$type ${Base64.toBase64String(blob)}"
  }

  fun fingerprint(key: PublicKey): String = fingerprint(Buffer.PlainBuffer().putPublicKey(key).compactData)

  fun fingerprint(blob: ByteArray): String =
    "SHA256:" + Base64.toBase64String(MessageDigest.getInstance("SHA-256").digest(blob)).trimEnd('=')

  fun inspect(client: SSHClient, text: String): Info = try {
    val key = load(client, text, null)
    Info(publicKey(key.public), false)
  } catch (error: CodedException) {
    if (error.code == "SSH_PASSPHRASE_REQUIRED") Info(null, true) else throw error
  }

  fun load(client: SSHClient, text: String, passphrase: CharArray?): KeyProvider {
    var passwordRequested = false
    val finder = object : PasswordFinder {
      override fun reqPassword(resource: Resource<*>?): CharArray {
        passwordRequested = true
        return passphrase?.clone() ?: throw IOException("Private key requires a passphrase")
      }

      override fun shouldRetry(resource: Resource<*>?) = false
    }
    try {
      require(text.isNotEmpty() && text.toByteArray(Charsets.UTF_8).size <= MAX_KEY_BYTES)
      require(KeyProviderUtil.detectKeyFileFormat(text, false) != KeyFormat.Unknown)
      return client.loadKeys(text, null, finder).also {
        // Key providers parse lazily; authentication errors must not hide bad passphrases.
        requireNotNull(it.private)
        requireNotNull(it.public)
      }
    } catch (_: Exception) {
      if (passwordRequested) throw sshError("SSH_PASSPHRASE_REQUIRED", "Private key passphrase is required or incorrect")
      throw sshError("SSH_KEY_INVALID", "Private key format is invalid or unsupported")
    }
  }
}
