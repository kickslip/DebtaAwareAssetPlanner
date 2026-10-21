package za.co.debtaware.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONObject

data class PendingPayment(
    val idempotencyKey: String,
    val userId: String,
    val debtAccountId: String?,
    val amount: Double,
    val note: String,
)

data class WidgetSummary(
    val totalDebt: Double,
    val monthlyRoom: Double,
    val showAmounts: Boolean,
)

class SecureTokenStore(context: Context) {
    private val preferences =
        context.getSharedPreferences("debtaware_secure_session", Context.MODE_PRIVATE)

    fun save(token: String, userId: String) {
        saveEncrypted(TOKEN_KEY, token)
        saveEncrypted(USER_ID_KEY, userId)
    }

    fun read(): String? = readEncrypted(TOKEN_KEY)

    fun readUserId(): String? = readEncrypted(USER_ID_KEY)

    fun savePendingPayment(payment: PendingPayment) {
        val pending = readPendingPayments()
            .filterNot { it.userId == payment.userId } + payment
        saveEncrypted(PENDING_PAYMENT_KEY, pending.toJson().toString())
    }

    fun readPendingPayment(userId: String): PendingPayment? =
        readPendingPayments().firstOrNull { it.userId == userId }

    fun clearPendingPayment(idempotencyKey: String) {
        val remaining = readPendingPayments()
            .filterNot { it.idempotencyKey == idempotencyKey }
        if (remaining.isEmpty()) {
            preferences.edit().remove(PENDING_PAYMENT_KEY).apply()
        } else {
            saveEncrypted(PENDING_PAYMENT_KEY, remaining.toJson().toString())
        }
    }

    private fun readPendingPayments(): List<PendingPayment> {
        val encoded = readEncrypted(PENDING_PAYMENT_KEY) ?: return emptyList()
        return try {
            val array = JSONArray(encoded)
            buildList {
                for (index in 0 until array.length()) {
                    val json = array.getJSONObject(index)
                    add(
                        PendingPayment(
                            idempotencyKey = json.getString("idempotencyKey"),
                            userId = json.getString("userId"),
                            debtAccountId = json.optString("debtAccountId")
                                .takeIf { it.isNotBlank() },
                            amount = json.getDouble("amount"),
                            note = json.optString("note"),
                        ),
                    )
                }
            }
        } catch (_: Exception) {
            preferences.edit().remove(PENDING_PAYMENT_KEY).apply()
            emptyList()
        }
    }

    fun saveWidgetSummary(summary: WidgetSummary) {
        saveEncrypted(
            WIDGET_SUMMARY_KEY,
            JSONObject()
                .put("totalDebt", summary.totalDebt)
                .put("monthlyRoom", summary.monthlyRoom)
                .put("showAmounts", summary.showAmounts)
                .toString(),
        )
    }

    fun readWidgetSummary(): WidgetSummary? {
        val encoded = readEncrypted(WIDGET_SUMMARY_KEY) ?: return null
        return try {
            val json = JSONObject(encoded)
            WidgetSummary(
                totalDebt = json.getDouble("totalDebt"),
                monthlyRoom = json.getDouble("monthlyRoom"),
                showAmounts = json.optBoolean("showAmounts", false),
            )
        } catch (_: Exception) {
            clearWidgetSummary()
            null
        }
    }

    fun clearWidgetSummary() {
        preferences.edit().remove(WIDGET_SUMMARY_KEY).apply()
    }

    fun clear() {
        preferences.edit()
            .remove(TOKEN_KEY)
            .remove(USER_ID_KEY)
            .apply()
    }

    fun hasLocalData(): Boolean = preferences.all.isNotEmpty()

    fun clearAll() {
        check(preferences.edit().clear().commit())
        KeyStore.getInstance("AndroidKeyStore").apply {
            load(null)
            if (containsAlias(KEY_ALIAS)) deleteEntry(KEY_ALIAS)
        }
    }

    private fun saveEncrypted(key: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val payload = ByteBuffer.allocate(1 + cipher.iv.size + ciphertext.size)
            .put(cipher.iv.size.toByte())
            .put(cipher.iv)
            .put(ciphertext)
            .array()
        preferences.edit()
            .putString(key, Base64.encodeToString(payload, Base64.NO_WRAP))
            .apply()
    }

    private fun readEncrypted(key: String): String? {
        val encoded = preferences.getString(key, null) ?: return null
        return try {
            val payload = ByteBuffer.wrap(Base64.decode(encoded, Base64.NO_WRAP))
            val ivLength = payload.get().toInt() and 0xff
            require(ivLength in 12..16 && payload.remaining() > ivLength)
            val iv = ByteArray(ivLength).also { payload.get(it) }
            val ciphertext = ByteArray(payload.remaining()).also { payload.get(it) }
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (_: Exception) {
            preferences.edit().remove(key).apply()
            null
        }
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                        KEY_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                    )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setRandomizedEncryptionRequired(true)
                        .build(),
                )
            }
            .generateKey()
    }

    private fun List<PendingPayment>.toJson(): JSONArray = JSONArray().also { array ->
        forEach { payment ->
            array.put(
                JSONObject()
                    .put("idempotencyKey", payment.idempotencyKey)
                    .put("userId", payment.userId)
                    .put("debtAccountId", payment.debtAccountId)
                    .put("amount", payment.amount)
                    .put("note", payment.note),
            )
        }
    }

    private companion object {
        const val TOKEN_KEY = "api_session_token"
        const val USER_ID_KEY = "api_user_id"
        const val PENDING_PAYMENT_KEY = "pending_payment"
        const val WIDGET_SUMMARY_KEY = "widget_summary"
        const val KEY_ALIAS = "debtaware_session_key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
