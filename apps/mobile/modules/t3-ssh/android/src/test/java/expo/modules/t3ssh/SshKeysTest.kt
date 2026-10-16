package expo.modules.t3ssh

import expo.modules.kotlin.exception.CodedException
import net.schmizz.sshj.SSHClient
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.util.encoders.Base64
import org.bouncycastle.util.encoders.Hex
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.fail
import org.junit.BeforeClass
import org.junit.Test
import java.security.Signature

class SshKeysTest {
  @Test
  fun `OpenSSH ed25519 serialization loads and signs with SSHJ`() {
    // RFC 8032 section 7.1 test vector; this key is public test data.
    val seed = Hex.decode("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
    val public = Hex.decode("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
    val expectedSignature = Hex.decode(
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
        "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
    )
    SSHClient().use { client ->
      val key = SshKeys.load(client, SshKeys.encodeEd25519(seed, public, "CI test"), null)
      assertEquals("ssh-ed25519 $PUBLIC_BLOB", SshKeys.publicKey(key.public))
      val signer = Signature.getInstance("Ed25519", "T3SSHBC")
      signer.initSign(key.private)
      org.junit.Assert.assertArrayEquals(expectedSignature, signer.sign())
    }
  }

  @Test
  fun `OpenSSH padding handles every block boundary and UTF-8 comments`() {
    val seed = ByteArray(32) { it.toByte() }
    val public = Ed25519PrivateKeyParameters(seed, 0).generatePublicKey().encoded
    SSHClient().use { client ->
      for (length in 0..7) {
        val text = SshKeys.encodeEd25519(seed, public, "тест " + "x".repeat(length))
        assertNotNull(SshKeys.load(client, text, null).private)
      }
    }
  }

  @Test
  fun `generated key uses the same SSHJ loading path as imported keys`() {
    val generated = SshKeys.generate("android-test")
    SSHClient().use { client ->
      val info = SshKeys.inspect(client, generated.privateKey)
      assertFalse(info.encrypted)
      assertEquals("${info.publicKey} android-test", generated.publicKey)
    }
  }

  @Test
  fun `fingerprint hashes the SSH wire blob and omits base64 padding`() {
    assertEquals(
      "SHA256:bbXpuKG6zhzdmnxq256TlqzFBzRl2f6OOg722cYNbU8",
      SshKeys.fingerprint(Base64.decode(PUBLIC_BLOB)),
    )
  }

  @Test
  fun `import rejects unknown oversized and malformed keys with a coded error`() {
    SSHClient().use { client ->
      listOf(
        "not a private key",
        "x".repeat(SshKeys.MAX_KEY_BYTES + 1),
        "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n",
      ).forEach { text ->
        try {
          SshKeys.inspect(client, text)
          fail("Invalid key was accepted")
        } catch (error: CodedException) {
          assertEquals("SSH_KEY_INVALID", error.code)
        }
      }
    }
  }

  companion object {
    private const val PUBLIC_BLOB = "AAAAC3NzaC1lZDI1NTE5AAAAINdamAGCsQq31Uv+08lkBzoO4XLz2qYjJa8CGmj3B1Ea"

    @BeforeClass
    @JvmStatic
    fun initializeCrypto() { SshCrypto.initialize() }
  }
}
