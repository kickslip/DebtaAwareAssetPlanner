package za.co.debtaware.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import za.co.debtaware.BuildConfig

data class DebtAccount(
    val id: String,
    val name: String,
    val balance: Double,
    val monthlyPayment: Double,
)

data class DebtOverview(
    val totalDebt: Double,
    val monthlyDebtPayment: Double,
    val debtToIncomeRatio: Double,
    val monthlyRoom: Double,
    val debts: List<DebtAccount>,
)

data class MobileSession(val token: String, val userId: String)

object ApiClient {
    private const val TIMEOUT_MS = 12_000

    suspend fun signIn(email: String, password: String): MobileSession =
        withContext(Dispatchers.IO) {
            val response = request(
                path = "/auth/login",
                method = "POST",
                body = JSONObject()
                    .put("email", email.trim())
                    .put("password", password),
                clientPlatform = true,
            )
            MobileSession(
                token = response.getString("accessToken"),
                userId = response.getJSONObject("user").getString("id"),
            )
        }

    suspend fun loadOverview(token: String): DebtOverview =
        withContext(Dispatchers.IO) {
            val response = request(path = "/api/overview", token = token)
            val summary = response.getJSONObject("overview")
            val debtRows = response.getJSONArray("debts")
            val debts = buildList {
                for (index in 0 until debtRows.length()) {
                    val row = debtRows.getJSONObject(index)
                    add(
                        DebtAccount(
                            id = row.getString("id"),
                            name = row.getString("name"),
                            balance = row.getDouble("balance"),
                            monthlyPayment = row.getDouble("monthlyPayment"),
                        ),
                    )
                }
            }
            DebtOverview(
                totalDebt = summary.getDouble("totalDebt"),
                monthlyDebtPayment = summary.getDouble("monthlyDebtPayment"),
                debtToIncomeRatio = summary.getDouble("debtToIncomeRatio"),
                monthlyRoom = summary.getDouble("monthlyRoom"),
                debts = debts,
            )
        }

    suspend fun addPayment(
        token: String,
        debtAccountId: String?,
        amount: Double,
        note: String,
        idempotencyKey: String,
    ) = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("amount", amount)
            .put("note", note.trim())
        if (debtAccountId != null) body.put("debtAccountId", debtAccountId)
        request(
            path = "/api/payments",
            method = "POST",
            body = body,
            token = token,
            idempotencyKey = idempotencyKey,
        )
    }

    suspend fun signOut(token: String) = withContext(Dispatchers.IO) {
        request(path = "/auth/logout", method = "POST", token = token)
    }

    suspend fun updatePaymentReminders(token: String, enabled: Boolean) =
        withContext(Dispatchers.IO) {
            request(
                path = "/api/notification-preferences",
                method = "PATCH",
                body = JSONObject().put("paymentRemindersEnabled", enabled),
                token = token,
            )
        }

    suspend fun paymentRemindersEnabled(token: String): Boolean =
        withContext(Dispatchers.IO) {
            request(path = "/api/notification-preferences", token = token)
                .optBoolean("paymentRemindersEnabled", false)
        }

    private fun request(
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
        token: String? = null,
        clientPlatform: Boolean = false,
        idempotencyKey: String? = null,
    ): JSONObject {
        val connection =
            (URL(BuildConfig.API_BASE_URL.trimEnd('/') + path).openConnection() as HttpURLConnection)
        connection.requestMethod = method
        connection.connectTimeout = TIMEOUT_MS
        connection.readTimeout = TIMEOUT_MS
        connection.setRequestProperty("Accept", "application/json")
        if (body != null) connection.setRequestProperty("Content-Type", "application/json")
        if (clientPlatform) connection.setRequestProperty("X-Client-Platform", "android")
        if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
        if (idempotencyKey != null) {
            connection.setRequestProperty("Idempotency-Key", idempotencyKey)
        }

        return try {
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.bufferedWriter(Charsets.UTF_8).use {
                    it.write(body.toString())
                }
            }
            val status = connection.responseCode
            val stream =
                if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                .orEmpty()
            val json = if (responseText.isBlank()) JSONObject() else JSONObject(responseText)
            if (status !in 200..299) {
                throw IllegalStateException(json.optString("error", "The request failed."))
            }
            json
        } finally {
            connection.disconnect()
        }
    }
}
