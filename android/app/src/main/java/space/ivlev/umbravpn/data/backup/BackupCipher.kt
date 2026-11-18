package space.ivlev.umbravpn.data.backup

import java.nio.ByteBuffer
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Password based encryption for backup files.
 *
 * New backups use a versioned container: `magic "UMBRA01\0" | version | kdf id | iterations | salt
 * | iv | ciphertext`. Files written by the old library start with an IV length and are still
 * decrypted with the legacy PBKDF2-HMAC-SHA1 settings.
 */
internal object BackupCipher {
    const val MIN_PASSWORD_LENGTH = 8

    private const val CIPHER = "AES/GCM/NoPadding"
    private const val CURRENT_VERSION = 1
    private const val KDF_PBKDF2_HMAC_SHA256 = 1
    private const val CURRENT_ITERATIONS = 600_000
    private const val CURRENT_KEY_BITS = 256
    private const val SALT_LENGTH = 16
    private const val IV_LENGTH = 12
    private const val TAG_BITS = 128

    private const val LEGACY_ITERATIONS = 65_536
    private const val LEGACY_KEY_BITS = 128
    private const val LEGACY_KDF = "PBKDF2WithHmacSHA1"

    private val MAGIC = byteArrayOf(0x55, 0x4D, 0x42, 0x52, 0x41, 0x30, 0x31, 0x00)
    private val random = SecureRandom()

    fun encrypt(data: ByteArray, password: String): ByteArray {
        require(password.length >= MIN_PASSWORD_LENGTH) {
            "backup password must be at least $MIN_PASSWORD_LENGTH characters"
        }
        val salt = ByteArray(SALT_LENGTH).also { random.nextBytes(it) }
        val iv = ByteArray(IV_LENGTH).also { random.nextBytes(it) }
        val key = deriveKey(password, salt, CURRENT_ITERATIONS, CURRENT_KEY_BITS)
        val cipher = Cipher.getInstance(CIPHER)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        val encrypted = cipher.doFinal(data)

        return ByteBuffer.allocate(
                MAGIC.size + 1 + 1 + Int.SIZE_BYTES + 1 + salt.size + 1 + iv.size + encrypted.size,
            )
            .put(MAGIC)
            .put(CURRENT_VERSION.toByte())
            .put(KDF_PBKDF2_HMAC_SHA256.toByte())
            .putInt(CURRENT_ITERATIONS)
            .put(salt.size.toByte())
            .put(salt)
            .put(iv.size.toByte())
            .put(iv)
            .put(encrypted)
            .array()
    }

    fun decrypt(data: ByteArray, password: String): ByteArray {
        require(password.isNotEmpty()) { "empty password" }
        return if (startsWithMagic(data)) decryptCurrent(data, password)
        else decryptLegacy(data, password)
    }

    fun isCurrentFormat(data: ByteArray): Boolean = startsWithMagic(data)

    private fun decryptCurrent(data: ByteArray, password: String): ByteArray {
        val buffer = ByteBuffer.wrap(data)
        val magic = ByteArray(MAGIC.size).also { buffer.get(it) }
        require(magic.contentEquals(MAGIC)) { "bad backup header" }
        val version = buffer.get().toInt() and 0xFF
        require(version == CURRENT_VERSION) { "unsupported backup version" }
        val kdf = buffer.get().toInt() and 0xFF
        require(kdf == KDF_PBKDF2_HMAC_SHA256) { "unsupported kdf" }
        val iterations = buffer.int
        require(iterations >= CURRENT_ITERATIONS) { "weak kdf parameters" }
        val saltLength = buffer.get().toInt() and 0xFF
        require(saltLength in SALT_LENGTH..64 && buffer.remaining() >= saltLength) {
            "bad salt length"
        }
        val salt = ByteArray(saltLength).also { buffer.get(it) }
        require(buffer.remaining() >= 1) { "truncated backup" }
        val ivLength = buffer.get().toInt() and 0xFF
        require(ivLength == IV_LENGTH) { "unexpected iv length" }
        require(buffer.remaining() >= ivLength + TAG_BITS / 8) { "truncated backup" }
        val iv = ByteArray(ivLength).also { buffer.get(it) }
        val encrypted = ByteArray(buffer.remaining()).also { buffer.get(it) }
        val key = deriveKey(password, salt, iterations, CURRENT_KEY_BITS)
        val cipher = Cipher.getInstance(CIPHER)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        return cipher.doFinal(encrypted)
    }

    private fun decryptLegacy(data: ByteArray, password: String): ByteArray {
        require(data.size >= Int.SIZE_BYTES + IV_LENGTH + TAG_BITS / 8) { "short backup" }
        val buffer = ByteBuffer.wrap(data)
        val ivLength = buffer.int
        require(ivLength == IV_LENGTH) { "unexpected iv length" }
        require(buffer.remaining() >= ivLength + TAG_BITS / 8) { "truncated backup" }
        val iv = ByteArray(ivLength).also { buffer.get(it) }
        val encrypted = ByteArray(buffer.remaining()).also { buffer.get(it) }
        val key = deriveKey(password, iv, LEGACY_ITERATIONS, LEGACY_KEY_BITS, LEGACY_KDF)
        val cipher = Cipher.getInstance(CIPHER)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        return cipher.doFinal(encrypted)
    }

    private fun deriveKey(
        password: String,
        salt: ByteArray,
        iterations: Int,
        keyBits: Int,
        algorithm: String = "PBKDF2WithHmacSHA256",
    ): SecretKeySpec {
        val spec = PBEKeySpec(password.toCharArray(), salt, iterations, keyBits)
        try {
            val encoded = SecretKeyFactory.getInstance(algorithm).generateSecret(spec).encoded
            return SecretKeySpec(encoded, "AES")
        } finally {
            spec.clearPassword()
        }
    }

    private fun startsWithMagic(data: ByteArray): Boolean {
        if (data.size < MAGIC.size) return false
        for (index in MAGIC.indices) {
            if (data[index] != MAGIC[index]) return false
        }
        return true
    }
}
