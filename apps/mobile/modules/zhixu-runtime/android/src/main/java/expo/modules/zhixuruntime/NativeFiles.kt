package expo.modules.zhixuruntime

import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

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
        val fd = Os.open(file.path, OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW, 0)
        FileInputStream(fd).use { Base64.encodeToString(it.readBytes(), Base64.NO_WRAP) }
      }
      "write" -> {
        val bytes = Base64.decode(args.getString("data"), Base64.DEFAULT)
        val flags = OsConstants.O_WRONLY or OsConstants.O_CREAT or OsConstants.O_NOFOLLOW or
          (if (args.optBoolean("exclusive")) OsConstants.O_EXCL else OsConstants.O_TRUNC)
        val fd = Os.open(file.path, flags, 384)
        FileOutputStream(fd).use { it.write(bytes); it.fd.sync() }
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
        mapOf("kind" to when {
          OsConstants.S_ISLNK(stat.st_mode) -> "symlink"
          OsConstants.S_ISDIR(stat.st_mode) -> "directory"
          else -> "file"
        }, "size" to stat.st_size, "nlink" to stat.st_nlink,
          "mtimeMs" to stat.st_mtime.toDouble() * 1000)
      }
      "list" -> (file.list()?.sorted() ?: throw RuntimeFailure("ENOTDIR", "无法读取目录"))
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
