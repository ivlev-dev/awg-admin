package space.ivlev.umbravpn.data.backup

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BackupCipherTest {
    private val password = "correct horse battery"
    private val payload = "SQLite format 3\u0000 backup payload".encodeToByteArray()

    @Test
    fun encryptsAndDecryptsRoundTrip() {
        val encrypted = BackupCipher.encrypt(payload, password)

        assertTrue(BackupCipher.isCurrentFormat(encrypted))
        assertArrayEquals(payload, BackupCipher.decrypt(encrypted, password))
    }

    @Test
    fun samePayloadProducesDifferentCiphertext() {
        val first = BackupCipher.encrypt(payload, password)
        val second = BackupCipher.encrypt(payload, password)

        assertFalse(first.contentEquals(second))
    }

    @Test
    fun rejectsWrongPassword() {
        val encrypted = BackupCipher.encrypt(payload, password)

        assertThrows(Exception::class.java) { BackupCipher.decrypt(encrypted, "wrong password!") }
    }

    @Test
    fun rejectsPasswordsShorterThanEightCharacters() {
        assertThrows(IllegalArgumentException::class.java) {
            BackupCipher.encrypt(payload, "short12")
        }
        assertThrows(IllegalArgumentException::class.java) { BackupCipher.encrypt(payload, "") }
    }

    @Test
    fun rejectsEmptyPasswordOnDecrypt() {
        val encrypted = BackupCipher.encrypt(payload, password)

        assertThrows(IllegalArgumentException::class.java) { BackupCipher.decrypt(encrypted, "") }
    }

    @Test
    fun decryptsLegacySha1Backups() {
        val legacy = legacyEncrypt(payload, "oldpass")

        assertFalse(BackupCipher.isCurrentFormat(legacy))
        assertArrayEquals(payload, BackupCipher.decrypt(legacy, "oldpass"))
    }

    @Test
    fun archiveWriteRejectsShortPassword() {
        val manifest =
            BackupManifest(
                platform = BackupArchive.PLATFORM_ANDROID,
                schemaVersion = 1,
                appVersionName = "test",
                encrypted = true,
            )

        assertThrows(IllegalArgumentException::class.java) {
            BackupArchive.write(ByteArrayOutputStream(), payload, manifest, "short")
        }
    }

    private fun legacyEncrypt(data: ByteArray, password: String): ByteArray {
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val spec = PBEKeySpec(password.toCharArray(), iv, 65_536, 128)
        val key =
            SecretKeySpec(
                SecretKeyFactoryHolder.sha1().generateSecret(spec).encoded,
                "AES",
            )
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        val encrypted = cipher.doFinal(data)
        return ByteBuffer.allocate(Int.SIZE_BYTES + iv.size + encrypted.size)
            .putInt(iv.size)
            .put(iv)
            .put(encrypted)
            .array()
    }

    private object SecretKeyFactoryHolder {
        fun sha1() = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1")
    }
}
