package io.github.wmy5555.zhixu.sharedtest;

import android.content.Intent;
import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.function.BooleanSupplier;
import org.json.JSONObject;

/** Content checks for single, user-selected documents; never interprets paths or YAML. */
final class SourceDocumentFiles {
    static final int MAX_SOURCE_BYTES = 160 * 1024;
    static final int MAX_BACKUP_BYTES = 32 * 1024 * 1024;
    private static final String[] SOURCE_FIELDS = { "platform", "author", "url", "date", "locator", "topic" };

    static Uri selectedDocument(Intent data) throws LocalSourceStore.StoreException {
        Uri uri = data == null ? null : data.getData();
        if (uri == null || !"content".equals(uri.getScheme()) || (data.getClipData() != null
            && (data.getClipData().getItemCount() != 1 || !uri.equals(data.getClipData().getItemAt(0).getUri())))) {
            throw invalid("请选择单个有效的文档文件。");
        }
        return uri;
    }

    static void writeBytes(OutputStream stream, byte[] bytes, BooleanSupplier active) throws IOException {
        if (stream == null) throw new IOException("No output stream");
        try (OutputStream output = stream) {
            if (bytes == null) throw new IOException("Missing document bytes");
            for (int offset = 0; offset < bytes.length; offset += 8192) {
                if (!active.getAsBoolean()) throw new IOException("Operation interrupted");
                output.write(bytes, offset, Math.min(8192, bytes.length - offset));
            }
            if (!active.getAsBoolean()) throw new IOException("Operation interrupted");
            output.flush();
        }
    }

    static String validateName(String name, boolean backup) throws LocalSourceStore.StoreException {
        if (name == null || name.isEmpty() || name.length() > 1024
            || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) throw invalid("所选文件名不正确。");
        for (int i = 0; i < name.length(); i++) {
            if (Character.isISOControl(name.charAt(i))) throw invalid("所选文件名不正确。");
        }
        String lower = name.toLowerCase(Locale.ROOT);
        if (backup ? !lower.endsWith(".json") : !(lower.endsWith(".txt") || lower.endsWith(".md"))) {
            throw invalid(backup ? "请选择 JSON 备份文件。" : "请选择 UTF-8 编码的 TXT 或 Markdown 文件。");
        }
        return name;
    }

    static String readUtf8(InputStream input, int limit) throws IOException, LocalSourceStore.StoreException {
        if (input == null) throw new IOException("No document stream");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(Math.min(limit, 8192));
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer, 0, Math.min(buffer.length, limit - bytes.size() + 1))) != -1) {
            // Some providers produce short or zero-length reads. Make progress without an unbounded loop.
            if (count == 0) {
                int one = input.read();
                if (one == -1) break;
                bytes.write(one);
            } else bytes.write(buffer, 0, count);
            if (bytes.size() > limit) throw new LocalSourceStore.StoreException("FILE_TOO_LARGE", "所选文件超过允许的大小。");
        }
        byte[] value = bytes.toByteArray();
        int offset = value.length >= 3 && value[0] == (byte) 0xef && value[1] == (byte) 0xbb && value[2] == (byte) 0xbf ? 3 : 0;
        try {
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(value, offset, value.length - offset)).toString();
            if (text.trim().isEmpty()) throw invalid("所选文件没有正文。");
            return text;
        } catch (java.nio.charset.CharacterCodingException exception) {
            throw invalid("所选文件不是有效的 UTF-8 文本，请转换编码后重试。");
        }
    }

    static byte[] sourceExchange(JSONObject note) throws Exception {
        JSONObject source = new JSONObject();
        JSONObject meta = note.optJSONObject("meta");
        for (String field : SOURCE_FIELDS) {
            Object value = meta == null ? null : meta.opt(field);
            if (value instanceof String) source.put(field, value);
        }
        JSONObject header = new JSONObject().put("format", "zhixu-source-exchange").put("version", 1)
            .put("title", note.getString("title")).put("source", source);
        return ("---\n" + header.toString() + "\n---\n" + note.getString("body")).getBytes(StandardCharsets.UTF_8);
    }

    private static LocalSourceStore.StoreException invalid(String message) {
        return new LocalSourceStore.StoreException("VALIDATION", message);
    }

    private SourceDocumentFiles() {}
}
