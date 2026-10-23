package expo.modules.zhixuruntime

import android.content.Intent
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Opt-in device acceptance against the isolated candidate only. Uses synthetic
 * text and never clears app data or enables an external provider. */
@RunWith(AndroidJUnit4::class)
class NativeUiInstrumentedTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val device = UiDevice.getInstance(instrumentation)
  private val packageName = "com.zhixu.learning.nativeapp"
  private fun find(selector: BySelector): UiObject2 {
    repeat(8) {
      device.findObject(selector)?.let { return it }
      val scroll = device.findObjects(By.scrollable(true)).maxByOrNull {
        it.visibleBounds.width() * it.visibleBounds.height()
      }
      scroll?.scroll(Direction.DOWN, 0.7f)
      device.waitForIdle()
    }
    return device.wait(Until.findObject(selector), 5000) ?: throw AssertionError("Missing control: $selector")
  }
  private fun click(text: String, bottom: Boolean = false) {
    val selector = if (device.hasObject(By.desc(text))) By.desc(text) else By.text(text)
    find(selector)
    val nodes = device.findObjects(selector)
    (if (bottom) nodes.maxBy { it.visibleBounds.bottom } else nodes.first()).click()
    device.waitForIdle()
  }
  private fun launch() {
    val intent = Intent().setClassName(packageName, "$packageName.MainActivity")
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    instrumentation.context.startActivity(intent)
    assertTrue("Workbench did not become ready", device.wait(Until.hasObject(By.textContains("今日预算")), 25000))
  }
  @Test fun offlineCaptureEditBackAndRestart() {
    val output = File(instrumentation.targetContext.getExternalFilesDir(null), "zhixu-native-acceptance").apply { mkdirs() }
    val started = SystemClock.elapsedRealtime()
    launch()
    val readyMs = SystemClock.elapsedRealtime() - started
    assertTrue(device.takeScreenshot(File(output, "01-today.png")))
    val title = "合成原生验收 " + System.currentTimeMillis()
    val body = "这是一份合成验收资料。\n离线保存原文，并保留用户自己的回答。"
    click("收集", bottom = true)
    device.findObject(By.desc("标题")).apply { click(); text = title }
    device.findObject(By.desc("原始资料")).apply { click(); text = body }
    device.pressBack() // dismiss keyboard; the capture tab retains its input
    click("保存原文")
    assertTrue(device.wait(Until.hasObject(By.text(title)), 15000))
    assertTrue(device.wait(Until.hasObject(By.textContains("合成验收资料")), 15000))
    assertTrue(device.takeScreenshot(File(output, "02-saved-note.png")))
    click("编辑")
    val editor = find(By.desc("正文"))
    editor.click()
    editor.text = body + "\n未保存的合成修改"
    device.pressBack()
    if (!device.wait(Until.hasObject(By.text("继续编辑")), 700)) device.pressBack()
    assertTrue("Dirty edit must require a decision", device.wait(Until.hasObject(By.text("继续编辑")), 5000))
    click("继续编辑")
    assertTrue(device.takeScreenshot(File(output, "03-draft-preserved.png")))
    device.pressBack()
    click("放弃修改")
    device.executeShellCommand("am force-stop $packageName")
    launch()
    click("知识库", bottom = true)
    assertTrue("Saved source must survive process restart", device.wait(Until.hasObject(By.text(title)), 15000))
    click(title)
    assertFalse(device.hasObject(By.textContains("未保存的合成修改")))
    assertTrue(device.takeScreenshot(File(output, "04-reopened.png")))
    File(output, "result.json").writeText(JSONObject().put("synthetic", true)
      .put("initialReadyMs", readyMs).put("capturedTitle", title)
      .put("scope", "offline capture, native read, discard decision, process restart").toString())
  }
}
