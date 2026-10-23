package expo.modules.zhixuruntime

import android.system.ErrnoException
import android.os.Build
import android.system.Os
import android.system.OsConstants
import android.system.StructStat
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.ByteArrayOutputStream

internal class RuntimeFailure(val code: String, message: String) : Exception(message)

/** Only this app's private, backup-excluded library is reachable from JS. */
internal class NativeFiles(val root: File) {
  init {
    if (!root.isDirectory && !root.mkdirs()) throw RuntimeFailure("IO_ERROR", "无法创建本地资料目录")
  }

  private fun statOrNull(file: File) = try {
    Os.lstat(file.path)
  } catch (error: ErrnoException) {
    if (error.errno == OsConstants.ENOENT) null else throw error
  }

  fun checked(raw: String, followLast: Boolean = true): File {
    if (raw.isEmpty() || raw.contains('\u0000') || !File(raw).isAbsolute)
      throw RuntimeFailure("PATH_ESCAPE", "路径必须在本机资料库内")
    // Resolve lexical components before touching disk; canonicalPath would follow links.
    val pieces = ArrayList<String>()
    raw.split('/').forEach {
      when (it) {
        "", "." -> Unit
        ".." -> if (pieces.isNotEmpty()) pieces.removeAt(pieces.lastIndex)
        else -> pieces.add(it)
      }
    }
    val file = File("/" + pieces.joinToString("/"))
    val base = root.absolutePath.trimEnd('/')
    if (file.path != base && !file.path.startsWith("$base/"))
      throw RuntimeFailure("PATH_ESCAPE", "路径超出本机资料库")
    var current = root
    val suffix = file.path.removePrefix(base).trimStart('/')
    val segments = if (suffix.isEmpty()) emptyList() else suffix.split('/')
    for ((index, segment) in segments.withIndex()) {
      current = File(current, segment)
      val stat = statOrNull(current) ?: continue
      if (OsConstants.S_ISLNK(stat.st_mode) && (followLast || index < segments.lastIndex))
        throw RuntimeFailure("SYMLINK", "资料路径不能经过符号链接")
    }
    return file
  }

  private fun notRoot(file: File) {
    if (file.absolutePath == root.absolutePath)
      throw RuntimeFailure("PATH_ESCAPE", "不能替换或删除资料库根目录")
  }

  private fun remove(file: File, recursive: Boolean) {
    val stat = Os.lstat(file.path)
    if (OsConstants.S_ISLNK(stat.st_mode)) throw RuntimeFailure("SYMLINK", "拒绝操作符号链接")
    if (OsConstants.S_ISDIR(stat.st_mode)) {
      if (!recursive) throw RuntimeFailure("EISDIR", "删除目录需要明确授权")
      (file.listFiles() ?: throw RuntimeFailure("EACCES", "无法读取目录")).forEach {
        remove(checked(it.path), true)
      }
      Os.remove(file.path)
    } else Os.remove(file.path)
  }

  private fun stamps(stat: StructStat): Pair<Long, Long> {
    val modified = if (Build.VERSION.SDK_INT >= 27) stat.st_mtim.tv_sec * 1_000_000_000L + stat.st_mtim.tv_nsec else stat.st_mtime * 1_000_000_000L
    val changed = if (Build.VERSION.SDK_INT >= 27) stat.st_ctim.tv_sec * 1_000_000_000L + stat.st_ctim.tv_nsec else stat.st_ctime * 1_000_000_000L
    return modified to changed
  }

  private fun readBytes(file: File, limit: Int? = null): ByteArray {
    val fd = Os.open(file.path, OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW, 0)
    try {
      return FileInputStream(fd).use { stream ->
        if (limit == null) stream.readBytes()
        else {
          val output = ByteArrayOutputStream()
          val buffer = ByteArray(8192)
          while (true) {
            val size = stream.read(buffer)
            if (size < 0) break
            if (output.size() + size > limit) throw RuntimeFailure("FILE_TOO_LARGE", "资料文件超过读取上限")
            output.write(buffer, 0, size)
          }
          output.toByteArray()
        }
      }
    } finally {
      // Android streams constructed from an existing descriptor do not own it.
      if (fd.valid()) Os.close(fd)
    }
  }

  private fun scanMarkdown(directory: File, fingerprints: JSONObject): List<Map<String, Any>> {
    val rows = ArrayList<Map<String, Any>>()
    var remainingBytes = 32 * 1024 * 1024
    fun visit(dir: File) {
      for (name in dir.list()?.sorted() ?: throw RuntimeFailure("ENOTDIR", "无法读取资料目录")) {
        if (name.startsWith('.')) continue
        val child = checked(File(dir, name).path, false)
        val stat = Os.lstat(child.path)
        if (OsConstants.S_ISLNK(stat.st_mode)) continue
        if (OsConstants.S_ISDIR(stat.st_mode)) visit(checked(child.path))
        else if (OsConstants.S_ISREG(stat.st_mode) && name.lowercase().endsWith(".md") && stat.st_size <= 5_000_000L) {
          val (modified, changed) = stamps(stat)
          val fingerprint = "${stat.st_dev}:${stat.st_ino}:${stat.st_size}:$modified:$changed"
          val row = mutableMapOf<String, Any>("file" to child.path, "fingerprint" to fingerprint)
          if (fingerprints.optString(child.path) != fingerprint && stat.st_size <= remainingBytes) {
            try {
              // Repeat path checks immediately before O_NOFOLLOW reads. This is
              // only a read batch, never a cache for writes or restore checks.
              val bytes = readBytes(checked(child.path), 5_000_000)
              if (bytes.size <= remainingBytes) {
                row["base64"] = Base64.encodeToString(bytes, Base64.NO_WRAP)
                remainingBytes -= bytes.size
              }
            } catch (_: Exception) {
              // Let the existing per-file reader report a conflict with fresh
              // checks. A raced or unreadable file never becomes valid content.
            }
          }
          rows.add(row)
        }
      }
    }
    visit(directory)
    return rows
  }

  fun call(operation: String, args: JSONObject): Any {
    val file = checked(args.optString("path"), operation != "stat" || args.optBoolean("follow", true))
    return when (operation) {
      "exists" -> statOrNull(file) != null
      "mkdir" -> {
        if (args.optBoolean("recursive")) {
          if (!file.isDirectory && !file.mkdirs()) throw RuntimeFailure("IO_ERROR", "无法创建目录")
        } else Os.mkdir(file.path, 448)
        JSONObject.NULL
      }
      "read" -> {
        Base64.encodeToString(readBytes(file), Base64.NO_WRAP)
      }
      "write" -> {
        val bytes = Base64.decode(args.getString("data"), Base64.DEFAULT)
        val flags = OsConstants.O_WRONLY or OsConstants.O_CREAT or OsConstants.O_NOFOLLOW or
          (if (args.optBoolean("exclusive")) OsConstants.O_EXCL else OsConstants.O_TRUNC)
        val fd = Os.open(file.path, flags, 384)
        try { FileOutputStream(fd).use { it.write(bytes); it.fd.sync() } }
        finally { if (fd.valid()) Os.close(fd) }
        JSONObject.NULL
      }
      "rename", "link" -> {
        val target = checked(args.getString("to"))
        notRoot(file); notRoot(target)
        if (operation == "rename") Os.rename(file.path, target.path) else Os.link(file.path, target.path)
        JSONObject.NULL
      }
      "unlink", "remove" -> {
        notRoot(file)
        if (statOrNull(file) == null && args.optBoolean("force")) JSONObject.NULL
        else {
          if (operation == "unlink") {
            if (OsConstants.S_ISDIR(Os.lstat(file.path).st_mode)) throw RuntimeFailure("EISDIR", "不能用 unlink 删除目录")
            Os.remove(file.path)
          } else remove(file, args.optBoolean("recursive"))
          JSONObject.NULL
        }
      }
      "stat" -> {
        val stat = Os.lstat(file.path)
        val (mtimeNs, ctimeNs) = stamps(stat)
        mapOf("kind" to when {
          OsConstants.S_ISLNK(stat.st_mode) -> "symlink"
          OsConstants.S_ISDIR(stat.st_mode) -> "directory"
          else -> "file"
        }, "size" to stat.st_size, "nlink" to stat.st_nlink,
          "dev" to stat.st_dev.toString(), "ino" to stat.st_ino.toString(),
          "mtimeNs" to mtimeNs.toString(), "ctimeNs" to ctimeNs.toString(),
          "mtimeMs" to mtimeNs.toDouble() / 1_000_000)
      }
      "list" -> (file.list()?.sorted() ?: throw RuntimeFailure("ENOTDIR", "无法读取目录"))
      "scan" -> scanMarkdown(file, args.optJSONObject("fingerprints") ?: JSONObject())
      "realpath" -> file.path
      "sync" -> {
        val fd = Os.open(file.path, OsConstants.O_RDWR or OsConstants.O_NOFOLLOW, 0)
        try { Os.fsync(fd) } finally { Os.close(fd) }
        JSONObject.NULL
      }
      else -> throw RuntimeFailure("UNSUPPORTED", "文件操作未实现")
    }
  }
}
