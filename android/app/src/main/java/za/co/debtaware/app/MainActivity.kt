package za.co.debtaware.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.launch
import za.co.debtaware.widget.DebtAwareWidgetProvider
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

class MainActivity : ComponentActivity() {
    private lateinit var tokenStore: SecureTokenStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tokenStore = SecureTokenStore(applicationContext)
        setContent {
            MaterialTheme {
                DebtAwareScreen(
                    tokenStore = tokenStore,
                    startWithPayment = intent?.action == ACTION_ADD_PAYMENT,
                )
            }
        }
    }

    companion object {
        const val ACTION_ADD_PAYMENT = "za.co.debtaware.action.ADD_PAYMENT"
    }
}

@Composable
private fun DebtAwareScreen(tokenStore: SecureTokenStore, startWithPayment: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var token by remember { mutableStateOf(tokenStore.read()) }
    var overview by remember { mutableStateOf<DebtOverview?>(null) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var paymentAmount by remember { mutableStateOf("") }
    var paymentNote by remember { mutableStateOf("") }
    var selectedDebtId by remember { mutableStateOf<String?>(null) }
    var menuExpanded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var notificationEnabled by remember {
        mutableStateOf(PaymentNotification.isOptedIn(context))
    }
    val notificationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (!granted || token == null) {
            PaymentNotification.setOptedIn(context, false)
            notificationEnabled = false
        } else {
            scope.launch {
                try {
                    ApiClient.updatePaymentReminders(token!!, true)
                    PaymentNotification.setOptedIn(context, true)
                    notificationEnabled = true
                } catch (requestError: Exception) {
                    error = requestError.message
                        ?: "Could not save notification preference."
                }
            }
        }
    }

    LaunchedEffect(token) {
        if (token == null) {
            overview = null
            DebtAwareWidgetProvider.clear(context)
            OverviewSyncWorker.cancel(context)
            return@LaunchedEffect
        }
        try {
            notificationEnabled = ApiClient.paymentRemindersEnabled(token!!)
            PaymentNotification.setOptedIn(context, notificationEnabled)
            OverviewSyncWorker.schedule(context)
            val latest = ApiClient.loadOverview(token!!)
            overview = latest
            if (selectedDebtId == null) selectedDebtId = latest.debts.firstOrNull()?.id
            DebtAwareWidgetProvider.refresh(
                context,
                latest.totalDebt,
                latest.monthlyRoom,
            )
            error = ""
        } catch (requestError: Exception) {
            error = requestError.message ?: "Could not load your overview."
            if (requestError.message?.contains("Sign in") == true) {
                tokenStore.clear()
                token = null
            }
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = Color(0xFFF7F8F5),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    "debtaware",
                    color = Color(0xFF31533E),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    if (token == null) "Make room for what’s next." else "Your money, in motion.",
                    modifier = Modifier.padding(top = 8.dp),
                    color = Color(0xFF25392D),
                    fontSize = 25.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "South African rand · Planning estimates only",
                    modifier = Modifier.padding(top = 5.dp),
                    color = Color(0xFF7F8C82),
                    fontSize = 12.sp,
                )
            }

            if (token == null) {
                SignInCard(
                    email = email,
                    onEmailChange = { email = it },
                    password = password,
                    onPasswordChange = { password = it },
                    busy = busy,
                    error = error,
                    onSignIn = {
                        scope.launch {
                            busy = true
                            error = ""
                            try {
                                val newToken = ApiClient.signIn(email, password)
                                tokenStore.save(newToken)
                                token = newToken
                                password = ""
                            } catch (requestError: Exception) {
                                error = requestError.message ?: "Sign-in failed."
                            } finally {
                                busy = false
                            }
                        }
                    },
                )
            } else {
                val currentOverview = overview
                if (currentOverview == null) {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            "Loading your account overview…",
                            modifier = Modifier.padding(18.dp),
                            color = Color(0xFF748177),
                        )
                    }
                } else {
                    OverviewCard(currentOverview)
                    PaymentCard(
                        overview = currentOverview,
                        selectedDebtId = selectedDebtId,
                        onSelectDebt = { selectedDebtId = it },
                        menuExpanded = menuExpanded,
                        onMenuExpandedChange = { menuExpanded = it },
                        amount = paymentAmount,
                        onAmountChange = { paymentAmount = it },
                        note = paymentNote,
                        onNoteChange = { paymentNote = it },
                        busy = busy,
                        startWithPayment = startWithPayment,
                        onSave = {
                            val amount = paymentAmount.toDoubleOrNull()
                            if (amount == null || amount <= 0) {
                                error = "Enter a payment amount greater than zero."
                            } else {
                                scope.launch {
                                    busy = true
                                    error = ""
                                    try {
                                        ApiClient.addPayment(
                                            token!!,
                                            selectedDebtId,
                                            amount,
                                            paymentNote,
                                        )
                                        paymentAmount = ""
                                        paymentNote = ""
                                        overview = ApiClient.loadOverview(token!!)
                                        overview?.let {
                                            DebtAwareWidgetProvider.refresh(
                                                context,
                                                it.totalDebt,
                                                it.monthlyRoom,
                                            )
                                        }
                                        PaymentNotification.showPaymentSaved(context)
                                    } catch (requestError: Exception) {
                                        error =
                                            requestError.message ?: "Could not record the payment."
                                    } finally {
                                        busy = false
                                    }
                                }
                            }
                        },
                    )
                    NotificationCard(
                        enabled = notificationEnabled,
                        onToggle = {
                            if (notificationEnabled) {
                                scope.launch {
                                    try {
                                        ApiClient.updatePaymentReminders(token!!, false)
                                        PaymentNotification.setOptedIn(context, false)
                                        notificationEnabled = false
                                    } catch (requestError: Exception) {
                                        error = requestError.message
                                            ?: "Could not update notification preference."
                                    }
                                }
                            } else {
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                    val granted = ContextCompat.checkSelfPermission(
                                        context,
                                        Manifest.permission.POST_NOTIFICATIONS,
                                    ) == PackageManager.PERMISSION_GRANTED
                                    if (granted) {
                                        scope.launch {
                                            try {
                                                ApiClient.updatePaymentReminders(token!!, true)
                                                PaymentNotification.setOptedIn(context, true)
                                                notificationEnabled = true
                                            } catch (requestError: Exception) {
                                                error = requestError.message
                                                    ?: "Could not update notification preference."
                                            }
                                        }
                                    } else {
                                        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                                    }
                                } else {
                                    scope.launch {
                                        try {
                                            ApiClient.updatePaymentReminders(token!!, true)
                                            PaymentNotification.setOptedIn(context, true)
                                            notificationEnabled = true
                                        } catch (requestError: Exception) {
                                            error = requestError.message
                                                ?: "Could not update notification preference."
                                        }
                                    }
                                }
                            }
                        },
                    )
                }
                if (error.isNotBlank()) {
                    Text(error, color = Color(0xFFAA5D4D), fontSize = 12.sp)
                }
                TextButton(
                    onClick = {
                        scope.launch {
                            busy = true
                            try {
                                ApiClient.signOut(token!!)
                            } catch (_: Exception) {
                            } finally {
                                tokenStore.clear()
                                token = null
                                PaymentNotification.setOptedIn(context, false)
                                busy = false
                            }
                        }
                    },
                    enabled = !busy,
                    modifier = Modifier.align(Alignment.End),
                ) {
                    Text("Sign out")
                }
            }
            Text(
                "Estimates are not financial advice, credit decisions, or a promise of approval.",
                color = Color(0xFF929C94),
                fontSize = 10.sp,
            )
        }
    }
}

@Composable
private fun SignInCard(
    email: String,
    onEmailChange: (String) -> Unit,
    password: String,
    onPasswordChange: (String) -> Unit,
    busy: Boolean,
    error: String,
    onSignIn: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Sign in to your account", fontWeight = FontWeight.SemiBold)
            Text(
                "Create an account in the web workspace first.",
                color = Color(0xFF849087),
                fontSize = 11.sp,
            )
            OutlinedTextField(
                value = email,
                onValueChange = onEmailChange,
                label = { Text("Email address") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            )
            OutlinedTextField(
                value = password,
                onValueChange = onPasswordChange,
                label = { Text("Password") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
            )
            if (error.isNotBlank()) {
                Text(error, color = Color(0xFFAA5D4D), fontSize = 11.sp)
            }
            Button(
                onClick = onSignIn,
                enabled = !busy && email.isNotBlank() && password.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (busy) "Signing in…" else "Sign in")
            }
        }
    }
}

@Composable
private fun OverviewCard(overview: DebtOverview) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Current overview", color = Color(0xFF718074), fontSize = 11.sp)
            Text(
                formatCurrency(overview.totalDebt),
                color = Color(0xFF2B4434),
                fontSize = 27.sp,
                fontWeight = FontWeight.Bold,
            )
            Text("Total debt balance", color = Color(0xFF89948C), fontSize = 11.sp)
            Spacer(modifier = Modifier.height(2.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Metric("Monthly debt", formatCurrency(overview.monthlyDebtPayment))
                Metric("DTI", "${overview.debtToIncomeRatio.fmt()}%")
            }
            Metric("Modeled monthly room", formatCurrency(overview.monthlyRoom))
            if (overview.debts.isNotEmpty()) {
                Spacer(modifier = Modifier.height(3.dp))
                Text("Tracked accounts", fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                overview.debts.forEach { debt ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(debt.name, color = Color(0xFF748177), fontSize = 11.sp)
                        Text(formatCurrency(debt.balance), color = Color(0xFF46584B), fontSize = 11.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun Metric(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(label, color = Color(0xFF89948C), fontSize = 10.sp)
        Text(value, color = Color(0xFF506257), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun PaymentCard(
    overview: DebtOverview,
    selectedDebtId: String?,
    onSelectDebt: (String?) -> Unit,
    menuExpanded: Boolean,
    onMenuExpandedChange: (Boolean) -> Unit,
    amount: String,
    onAmountChange: (String) -> Unit,
    note: String,
    onNoteChange: (String) -> Unit,
    busy: Boolean,
    startWithPayment: Boolean,
    onSave: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Text(
                if (startWithPayment) "Quick add payment" else "Record a payment",
                fontWeight = FontWeight.SemiBold,
                fontSize = 15.sp,
            )
            Text(
                "Manual entry only. This does not move money from your bank.",
                color = Color(0xFF89948C),
                fontSize = 10.sp,
            )
            Column {
                OutlinedButton(
                    onClick = { onMenuExpandedChange(true) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        overview.debts.firstOrNull { it.id == selectedDebtId }?.name
                            ?: "General payment",
                    )
                }
                DropdownMenu(
                    expanded = menuExpanded,
                    onDismissRequest = { onMenuExpandedChange(false) },
                ) {
                    DropdownMenuItem(
                        text = { Text("General payment") },
                        onClick = {
                            onSelectDebt(null)
                            onMenuExpandedChange(false)
                        },
                    )
                    overview.debts.forEach { debt ->
                        DropdownMenuItem(
                            text = { Text(debt.name) },
                            onClick = {
                                onSelectDebt(debt.id)
                                onMenuExpandedChange(false)
                            },
                        )
                    }
                }
            }
            OutlinedTextField(
                value = amount,
                onValueChange = onAmountChange,
                label = { Text("Amount paid (R)") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
            OutlinedTextField(
                value = note,
                onValueChange = onNoteChange,
                label = { Text("Note (optional)") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Button(
                onClick = onSave,
                enabled = !busy && amount.toDoubleOrNull()?.let { it > 0 } == true,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (busy) "Saving…" else "Save payment")
            }
        }
    }
}

@Composable
private fun NotificationCard(enabled: Boolean, onToggle: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Payment confirmations", fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                Text(
                    "Optional notification after a payment is recorded.",
                    color = Color(0xFF89948C),
                    fontSize = 10.sp,
                )
            }
            TextButton(onClick = onToggle) {
                Text(if (enabled) "Disable" else "Enable")
            }
        }
    }
}

private fun formatCurrency(value: Double): String =
    NumberFormat.getCurrencyInstance(Locale("en", "ZA")).apply {
        currency = Currency.getInstance("ZAR")
        maximumFractionDigits = 0
    }.format(value)

private fun Double.fmt(): String = String.format(Locale.US, "%.1f", this)
