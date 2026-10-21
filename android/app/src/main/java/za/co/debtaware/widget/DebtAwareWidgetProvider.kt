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
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

class DebtAwareWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        manager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        val preferences =
            context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)
        val totalDebt = preferences.getFloat(TOTAL_DEBT_KEY, 0f).toDouble()
        val monthlyRoom = preferences.getFloat(MONTHLY_ROOM_KEY, 0f).toDouble()
        val signedIn = preferences.getBoolean(SIGNED_IN_KEY, false)

        appWidgetIds.forEach { widgetId ->
            val views = RemoteViews(context.packageName, R.layout.widget_overview)
            views.setTextViewText(
                R.id.widget_total_debt,
                if (signedIn) currency(totalDebt) else context.getString(R.string.widget_debt_default),
            )
            views.setTextViewText(
                R.id.widget_monthly_room,
                if (signedIn) {
                    "Modeled monthly room · ${currency(monthlyRoom)}"
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
        const val WIDGET_PREFS = "debtaware_widget_overview"
        const val TOTAL_DEBT_KEY = "total_debt"
        const val MONTHLY_ROOM_KEY = "monthly_room"
        const val SIGNED_IN_KEY = "signed_in"

        fun refresh(context: Context, totalDebt: Double, monthlyRoom: Double) {
            context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)
                .edit()
                .putFloat(TOTAL_DEBT_KEY, totalDebt.toFloat())
                .putFloat(MONTHLY_ROOM_KEY, monthlyRoom.toFloat())
                .putBoolean(SIGNED_IN_KEY, true)
                .apply()
            val manager = AppWidgetManager.getInstance(context)
            val component = ComponentName(context, DebtAwareWidgetProvider::class.java)
            val ids = manager.getAppWidgetIds(component)
            if (ids.isNotEmpty()) {
                DebtAwareWidgetProvider().onUpdate(context, manager, ids)
            }
        }

        fun clear(context: Context) {
            context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)
                .edit()
                .clear()
                .apply()
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
