package za.co.debtaware.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import za.co.debtaware.R
import za.co.debtaware.app.MainActivity
import za.co.debtaware.app.SecureTokenStore
import za.co.debtaware.app.WidgetSummary
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

class DebtAwareWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        manager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        val summary = SecureTokenStore(context).readWidgetSummary()

        appWidgetIds.forEach { widgetId ->
            val views = RemoteViews(context.packageName, R.layout.widget_overview)
            views.setTextViewText(
                R.id.widget_total_debt,
                when {
                    summary == null -> context.getString(R.string.widget_debt_default)
                    summary.showAmounts -> currency(summary.totalDebt)
                    else -> context.getString(R.string.widget_balances_hidden)
                },
            )
            views.setTextViewText(
                R.id.widget_monthly_room,
                if (summary?.showAmounts == true) {
                    "Modeled monthly room · ${currency(summary.monthlyRoom)}"
                } else {
                    context.getString(R.string.widget_room_default)
                },
            )
            val intent = Intent(context, MainActivity::class.java).apply {
                action = MainActivity.ACTION_ADD_PAYMENT
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                context,
                widgetId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_add_payment, pendingIntent)
            manager.updateAppWidget(widgetId, views)
        }
    }

    companion object {
        fun refresh(
            context: Context,
            totalDebt: Double,
            monthlyRoom: Double,
            showAmounts: Boolean? = null,
        ) {
            val store = SecureTokenStore(context)
            val current = store.readWidgetSummary()
            store.saveWidgetSummary(
                WidgetSummary(
                    totalDebt = totalDebt,
                    monthlyRoom = monthlyRoom,
                    showAmounts = showAmounts ?: current?.showAmounts ?: false,
                ),
            )
            val manager = AppWidgetManager.getInstance(context)
            val component = ComponentName(context, DebtAwareWidgetProvider::class.java)
            val ids = manager.getAppWidgetIds(component)
            if (ids.isNotEmpty()) {
                DebtAwareWidgetProvider().onUpdate(context, manager, ids)
            }
        }

        fun clear(context: Context) {
            SecureTokenStore(context).clearWidgetSummary()
            val manager = AppWidgetManager.getInstance(context)
            val component = ComponentName(context, DebtAwareWidgetProvider::class.java)
            val ids = manager.getAppWidgetIds(component)
            if (ids.isNotEmpty()) {
                DebtAwareWidgetProvider().onUpdate(context, manager, ids)
            }
        }

        private fun currency(amount: Double): String =
            NumberFormat.getCurrencyInstance(Locale("en", "ZA")).apply {
                currency = Currency.getInstance("ZAR")
                maximumFractionDigits = 0
            }.format(amount)
    }
}
