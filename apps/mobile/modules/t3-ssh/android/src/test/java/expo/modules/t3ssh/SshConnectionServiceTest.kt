package expo.modules.t3ssh

import android.app.Notification
import android.app.NotificationManager
import android.app.Application
import android.content.ContextWrapper
import android.content.Intent
import android.os.Looper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowPowerManager

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SshConnectionServiceTest {
  @Test
  fun `active SSH leases retain foreground notification power and heartbeat until the last closes`() {
    val context = RuntimeEnvironment.getApplication()
    val tasks = mutableListOf<String>()
    val first = SshConnectionService.retain(context, { tasks.add(it) }) { fail("Unexpected disconnect") }
    val second = SshConnectionService.retain(context, { tasks.add(it) }) { fail("Unexpected disconnect") }
    val application = shadowOf(context)
    val controller = Robolectric.buildService(SshConnectionService::class.java, application.nextStartedService)
      .create().startCommand(0, 1)
    try {
      controller.get().onStartCommand(application.nextStartedService, 0, 2)
      val firstClosed = SshConnectionService.waitUntilClosed(first.id)
      val secondClosed = SshConnectionService.waitUntilClosed(second.id)
      val service = shadowOf(controller.get())
      val notification = service.lastForegroundNotification
      assertTrue(notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
      assertEquals(NotificationManager.IMPORTANCE_LOW,
        context.getSystemService(NotificationManager::class.java).getNotificationChannel(notification.channelId).importance)
      assertTrue(ShadowPowerManager.getLatestWakeLock().isHeld)
      assertEquals(listOf(first.id, second.id), tasks)

      first.close()
      shadowOf(Looper.getMainLooper()).idle()
      assertTrue(firstClosed.isDone)
      assertFalse(secondClosed.isDone)
      assertFalse(service.isStoppedBySelf)
      assertTrue(ShadowPowerManager.getLatestWakeLock().isHeld)

      second.close()
      shadowOf(Looper.getMainLooper()).idle()
      assertTrue(secondClosed.isDone)
      assertTrue(service.isStoppedBySelf)
    } finally {
      first.close()
      second.close()
      controller.destroy()
    }
    assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
  }

  @Test
  fun `service shutdown closes its SSH sessions and finishes their background tasks`() {
    val context = RuntimeEnvironment.getApplication()
    var disconnected = false
    val lease = SshConnectionService.retain(context, {}) { disconnected = true }
    val closed = SshConnectionService.waitUntilClosed(lease.id)
    val controller = Robolectric.buildService(SshConnectionService::class.java, shadowOf(context).nextStartedService)
      .create().startCommand(0, 1)
    controller.destroy()
    assertTrue(disconnected)
    assertTrue(closed.isDone)
    assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
    lease.close()
  }

  @Test
  fun `cancel before service startup leaves no background task or persistent notification`() {
    val context = RuntimeEnvironment.getApplication()
    val lease = SshConnectionService.retain(context, { fail("Cancelled task started") }) {
      fail("Cancelled session disconnected twice")
    }
    val intent = shadowOf(context).nextStartedService
    lease.close()
    val controller = Robolectric.buildService(SshConnectionService::class.java, intent)
      .create().startCommand(0, 1)
    try {
      assertTrue(shadowOf(controller.get()).isStoppedBySelf)
      assertTrue(SshConnectionService.waitUntilClosed(lease.id).isDone)
    } finally {
      controller.destroy()
    }
    assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
  }

  @Test
  fun `a denied foreground start rolls back the lease without running SSH cleanup`() {
    val context = RuntimeEnvironment.getApplication()
    val denied = object : ContextWrapper(context) {
      override fun startForegroundService(service: Intent): android.content.ComponentName? {
        throw IllegalStateException("Background start denied")
      }
    }
    try {
      SshConnectionService.retain(denied, { fail("Denied task started") }) {
        fail("Unstarted session disconnected")
      }
      fail("Denied start succeeded")
    } catch (error: IllegalStateException) {
      assertEquals("Background start denied", error.message)
    }
    val lease = SshConnectionService.retain(context, {}) {}
    lease.close()
    val controller = Robolectric.buildService(SshConnectionService::class.java, shadowOf(context).nextStartedService)
      .create().startCommand(0, 1)
    try {
      assertTrue(shadowOf(controller.get()).isStoppedBySelf)
    } finally {
      controller.destroy()
    }
  }
}
