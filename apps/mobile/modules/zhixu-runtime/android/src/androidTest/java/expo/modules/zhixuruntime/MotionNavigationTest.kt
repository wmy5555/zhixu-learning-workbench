package expo.modules.zhixuruntime

import android.content.Intent
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Opt-in navigation sampling on the isolated synthetic candidate. No input,
 * save, provider action, data reset or restore is performed by this driver. */
@RunWith(AndroidJUnit4::class)
class MotionNavigationTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val device = UiDevice.getInstance(instrumentation)
  private val packageName = "com.zhixu.learning.nativeapp"
  private val measurements = JSONArray()
  private lateinit var output: File
  private lateinit var label: String

  private fun ready(selector: BySelector): UiObject2 {
    val node = device.wait(Until.findObject(By.copy(selector).pkg(packageName)), 15000)
      ?: throw AssertionError("Visible readiness target missing: $selector")
    assertTrue("Readiness target is outside the visible screen: $selector", !node.visibleBounds.isEmpty)
    assertTrue("Readiness target is disabled: $selector", node.isEnabled)
    return node
  }

  private fun control(selector: BySelector, bottom: Boolean = false): UiObject2 {
    ready(selector)
    val nodes = device.findObjects(By.copy(selector).pkg(packageName)).filter { !it.visibleBounds.isEmpty }
    var node = if (bottom) nodes.maxByOrNull { it.visibleBounds.bottom } else nodes.firstOrNull()
    repeat(8) {
      if (node != null && !node!!.isClickable) node = node!!.parent
    }
    val target = node ?: throw AssertionError("Clickable control missing: $selector")
    assertTrue("Control is not enabled and clickable: $selector", target.isEnabled && target.isClickable)
    return target
  }

  private fun sample(action: String, round: Int, target: BySelector, perform: () -> Unit) {
    // Resolve the source control before calling this method. The clock starts
    // before dispatching the click/back, never after an implicit idle wait.
    val start = SystemClock.elapsedRealtimeNanos()
    var success = false
    try {
      perform()
      ready(target)
      success = true
    } finally {
      measurements.put(JSONObject().put("action", action).put("round", round)
        .put("visibleReadyMs", (SystemClock.elapsedRealtimeNanos() - start) / 1000000.0)
        .put("success", success))
      persist("running")
    }
  }

  private fun persist(status: String, failure: String? = null) {
    File(output, "motion-$label.json").writeText(JSONObject()
      .put("schemaVersion", 1).put("motionLabel", label).put("syntheticMotion", true)
      .put("package", packageName).put("status", status)
      .put("waitForIdleTimeoutMs", 0).put("targetTimeoutMs", 15000)
      .put("scope", "5 drawer/topic/back loops and one pass through five tabs; no input or data reset")
      .put("measurement", "input dispatch to visible target control; not animation completion or touch-to-photon")
      .put("measurements", measurements).put("failure", failure ?: JSONObject.NULL).toString(2))
  }

  @Test fun sampleDrawerRoutesAndTabs() {
    val args = InstrumentationRegistry.getArguments()
    assumeTrue("Requires an explicitly authorized synthetic installation", args.getString("syntheticMotion") == "true")
    label = args.getString("motionLabel") ?: ""
    require(label == "before" || label == "after") { "motionLabel must be before or after" }
    val external = instrumentation.targetContext.getExternalFilesDir(null)
      ?: throw AssertionError("Test external files directory unavailable")
    output = File(external, "zhixu-native-acceptance").apply {
      check(isDirectory || mkdirs()) { "Cannot create motion evidence directory" }
    }
    val configuration = Configurator.getInstance()
    val previousIdleTimeout = configuration.waitForIdleTimeout
    var status = "failed"
    var failure: String? = null
    try {
      configuration.setWaitForIdleTimeout(0)
      // A normal launcher intent preserves the candidate's existing private data.
      instrumentation.context.startActivity(Intent(Intent.ACTION_MAIN)
        .addCategory(Intent.CATEGORY_LAUNCHER)
        .setClassName(packageName, "$packageName.MainActivity")
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      ready(By.desc("知序，打开侧栏"))
      control(By.desc("今日"), bottom = true).click()
      ready(By.textStartsWith("今日预算"))
      File(output, "motion-$label-gfxinfo-reset-before.txt")
        .writeText(device.executeShellCommand("dumpsys gfxinfo $packageName reset"))

      repeat(5) { index ->
        val round = index + 1
        val brand = control(By.desc("知序，打开侧栏"))
        sample("open-drawer", round, By.text("主题学习")) { brand.click() }
        val topics = control(By.text("主题学习"))
        sample("open-topics", round, By.text("新建主题")) { topics.click() }
        sample("system-back", round, By.desc("知序，打开侧栏")) {
          assertTrue("System Back was not dispatched", device.pressBack())
        }
        ready(By.textStartsWith("今日预算"))
      }

      val tabs = listOf(
        "收集" to By.desc("原始资料"),
        "知识库" to By.desc("查找资料"),
        "学习" to By.text("学习从一份资料开始"),
        "应用" to By.desc("问题或输出目标"),
        "今日" to By.textStartsWith("今日预算"),
      )
      for ((tab, target) in tabs) {
        val button = control(By.desc(tab), bottom = true)
        sample("tab-$tab", 1, target) { button.click() }
      }
      status = "passed"
    } catch (error: Throwable) {
      failure = error.javaClass.simpleName + ": " + (error.message ?: "")
      throw error
    } finally {
      try {
        File(output, "motion-$label-gfxinfo-after.txt")
          .writeText(device.executeShellCommand("dumpsys gfxinfo $packageName framestats"))
        File(output, "motion-$label-gfxinfo-reset-after.txt")
          .writeText(device.executeShellCommand("dumpsys gfxinfo $packageName reset"))
        persist(status, failure)
      } finally {
        configuration.setWaitForIdleTimeout(previousIdleTimeout)
      }
    }
  }
}
