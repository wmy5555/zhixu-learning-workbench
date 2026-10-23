package expo.modules.zhixuruntime

import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.regex.Pattern

/** Explicit opt-in: this test restores SYNTHETIC fixtures over a disposable
 * candidate library. Never run against a user's populated installation. */
@RunWith(AndroidJUnit4::class)
class LibraryBenchmarkTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val device = UiDevice.getInstance(instrumentation)
  private val packageName = "com.zhixu.learning.nativeapp"
  private fun click(text: String) {
    val selector = if (device.hasObject(By.desc(text))) By.desc(text) else By.text(text)
    repeat(8) {
      if (!device.hasObject(selector)) {
        device.findObjects(By.scrollable(true)).maxByOrNull {
          it.visibleBounds.width() * it.visibleBounds.height()
        }?.scroll(Direction.DOWN, 0.7f)
        device.waitForIdle()
      }
    }
    assertTrue("Missing: $text", device.wait(Until.hasObject(selector), 15000))
    device.findObjects(selector).maxBy { it.visibleBounds.bottom }.click()
    device.waitForIdle()
  }
  private fun open(route: String) {
    instrumentation.context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("zhixu://$route"))
      .setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }
  @Test fun restoreSyntheticLibrariesAndMeasureVisibleReadiness() {
    assumeTrue(InstrumentationRegistry.getArguments().getString("syntheticBenchmark") == "true")
    val output = File(instrumentation.targetContext.getExternalFilesDir(null), "zhixu-native-acceptance").apply { mkdirs() }
    val measurements = JSONArray()
    for (count in listOf(1000, 10000)) {
      open("section/backup")
      click("选择备份并预览")
      val file = "zhixu-synthetic-$count.json"
      if (!device.wait(Until.hasObject(By.text(file)), 1500)) {
        device.findObject(By.desc(Pattern.compile("Show roots|显示根目录|打开导航抽屉|打开导航栏")))?.click()
        val downloads = device.findObject(By.text("Downloads")) ?: device.findObject(By.text("下载"))
        assertNotNull("Open the Downloads provider", downloads)
        downloads!!.click()
      }
      click(file)
      val previewStart = SystemClock.elapsedRealtime()
      assertTrue("Backup preview failed", device.wait(Until.hasObject(By.text("恢复预览已通过")), 120000))
      val previewMs = SystemClock.elapsedRealtime() - previewStart
      click("确认恢复"); click("继续")
      val restoreStart = SystemClock.elapsedRealtime()
      assertTrue("Restore did not complete", device.wait(Until.gone(By.text("恢复预览已通过")), 300000))
      val restoreMs = SystemClock.elapsedRealtime() - restoreStart
      device.executeShellCommand("am force-stop $packageName")
      val coldStart = SystemClock.elapsedRealtime()
      instrumentation.context.startActivity(Intent().setClassName(packageName, "$packageName.MainActivity")
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
      assertTrue("Library cold start exceeded 30 seconds", device.wait(Until.hasObject(By.textContains("今日预算")), 30000))
      val coldReadyMs = SystemClock.elapsedRealtime() - coldStart
      click("知识库")
      val listStart = SystemClock.elapsedRealtime()
      assertTrue(device.wait(Until.hasObject(By.textStartsWith("合成资料 ")), 30000))
      val listReadyMs = SystemClock.elapsedRealtime() - listStart
      device.setOrientationLeft(); device.waitForIdle()
      device.findObjects(By.textStartsWith("合成资料 ")).first().click()
      assertTrue(device.wait(Until.hasObject(By.text("编辑")), 15000))
      device.takeScreenshot(File(output, "library-$count.png"))
      measurements.put(JSONObject().put("notes", count).put("previewMs", previewMs)
        .put("restoreMs", restoreMs).put("coldReadyMs", coldReadyMs).put("listReadyMs", listReadyMs)
        .put("screenWidthPx", device.displayWidth).put("screenHeightPx", device.displayHeight))
      File(output, "library-performance.json").writeText(measurements.toString(2))
      device.setOrientationNatural()
    }
  }
}
