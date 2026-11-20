package expo.modules.t3ssh

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import java.io.Closeable
import java.util.UUID
import java.util.concurrent.CompletableFuture

class SshConnectionService : Service() {
  private val owned = mutableSetOf<Lease>()
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent): IBinder? = null

  @SuppressLint("WakelockTimeout") // Released with the last SSH lease or service destruction.
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    current = this
    val lease = synchronized(leases) { leases[intent?.getStringExtra(LEASE_ID)] }
    try {
      val manager = getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= 26) {
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "SSH connections", NotificationManager.IMPORTANCE_LOW))
      }
      val launch = packageManager.getLaunchIntentForPackage(packageName)?.let {
        PendingIntent.getActivity(this, NOTIFICATION_ID, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      }
      val notification = NotificationCompat.Builder(this, CHANNEL)
        .setSmallIcon(R.drawable.t3_ssh_notification)
        .setContentTitle("T3 Code · SSH")
        .setContentText("Keeping your server connections available in the background")
        .setContentIntent(launch)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setShowWhen(false)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setColorized(false)
        .build()
      if (Build.VERSION.SDK_INT >= 29) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      if (wakeLock == null) {
        wakeLock = getSystemService(PowerManager::class.java)
          .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "T3Code:SSH")
          .apply { setReferenceCounted(false); acquire() }
      }
      if (lease != null && owned.add(lease)) lease.startTask()
      stopIfIdle()
    } catch (_: Exception) {
      lease?.cancel()
      stopIfIdle()
    }
    return START_NOT_STICKY
  }

  private fun stopIfIdle() {
    owned.removeAll { it.closed.isDone }
    if (synchronized(leases) { leases.isEmpty() }) stopSelf()
  }

  override fun onDestroy() {
    if (current === this) current = null
    try {
      owned.toList().forEach { it.cancel() }
      owned.clear()
    } finally {
      wakeLock?.let { if (it.isHeld) it.release() }
      wakeLock = null
      stopForeground(STOP_FOREGROUND_REMOVE)
      super.onDestroy()
    }
  }

  class Lease internal constructor(
    val id: String,
    private val beginTask: (String) -> Unit,
    private val onStopped: () -> Unit,
  ) : Closeable {
    internal val closed = CompletableFuture<Unit>()

    internal fun startTask() {
      if (!closed.isDone) beginTask(id)
    }

    override fun close() { finish(false) }

    internal fun cancel() { finish(true) }

    private fun finish(disconnect: Boolean) {
      val removed = synchronized(leases) { leases.remove(id, this) }
      if (!removed) return
      closed.complete(Unit)
      try {
        if (disconnect) onStopped()
      } finally {
        Handler(Looper.getMainLooper()).post { current?.stopIfIdle() }
      }
    }
  }

  companion object {
    private const val CHANNEL = "ssh-connections"
    private const val NOTIFICATION_ID = 73003
    private const val LEASE_ID = "leaseId"
    private val leases = mutableMapOf<String, Lease>()
    private var current: SshConnectionService? = null

    fun retain(context: Context, startTask: (String) -> Unit, onStopped: () -> Unit): Lease {
      val lease = Lease(UUID.randomUUID().toString(), startTask, onStopped)
      synchronized(leases) { leases[lease.id] = lease }
      try {
        val intent = Intent(context, SshConnectionService::class.java).putExtra(LEASE_ID, lease.id)
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      } catch (error: Exception) {
        lease.close()
        throw error
      }
      return lease
    }

    fun waitUntilClosed(id: String): CompletableFuture<Unit> = synchronized(leases) {
      leases[id]?.closed ?: CompletableFuture.completedFuture(Unit)
    }
  }
}
