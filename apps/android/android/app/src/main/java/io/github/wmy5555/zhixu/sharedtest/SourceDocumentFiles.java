package io.github.wmy5555.zhixu.sharedtest;

import android.content.Intent;
import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.IDN;
import java.net.URI;
import java.net.URL;
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

    static Intent documentIntent(boolean writing, boolean backup, String name) {
        Intent intent = new Intent(writing ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(backup ? "application/json" : writing ? "text/markdown" : "*/*");
        // Ask for access only to the single URI returned by the user's picker, never a prefix or durable grant.
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | (writing ? Intent.FLAG_GRANT_WRITE_URI_PERMISSION : 0));
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
        if (writing) intent.putExtra(Intent.EXTRA_TITLE, name);
        return intent;
    }

    static Uri selectedDocument(Intent data) throws LocalSourceStore.StoreException {
        Uri uri = data == null ? null : data.getData();
        if (uri == null || !"content".equals(uri.getScheme()) || (data.getClipData() != null
            && (data.getClipData().getItemCount() != 1 || !uri.equals(data.getClipData().getItemAt(0).getUri())))) {
            throw invalid("请选择单个有效的文档文件。");
        }
        return uri;
    }

    interface OutputOpener { OutputStream open() throws IOException; }

    static final class DocumentWriteException extends IOException {
        final String stage;
        DocumentWriteException(String stage, Exception cause) {
            super("Document export failed", cause);
            this.stage = stage;
        }
    }

    static void writeDocument(OutputOpener opener, byte[] bytes, BooleanSupplier active) throws IOException {
        // Validate before opening: a provider's truncate mode must never erase a file for a cancelled/lost payload.
        if (bytes == null) throw new DocumentWriteException("payload", new IOException("Missing document bytes"));
        if (!active.getAsBoolean()) throw new DocumentWriteException("before-open", new IOException("Operation interrupted"));
        OutputStream stream;
        try {
            stream = opener.open();
            if (stream == null) throw new IOException("No output stream");
        } catch (IOException | RuntimeException exception) {
            throw new DocumentWriteException("open-output", exception);
        }
        writeBytes(stream, bytes, active);
    }

    static void writeBytes(OutputStream stream, byte[] bytes, BooleanSupplier active) throws IOException {
        if (stream == null) throw new DocumentWriteException("open-output", new IOException("No output stream"));
        String stage = "payload";
        try (OutputStream output = stream) {
            if (bytes == null) throw new IOException("Missing document bytes");
            stage = "write";
            for (int offset = 0; offset < bytes.length; offset += 8192) {
                if (!active.getAsBoolean()) throw new IOException("Operation interrupted");
                output.write(bytes, offset, Math.min(8192, bytes.length - offset));
            }
            if (!active.getAsBoolean()) throw new IOException("Operation interrupted");
            stage = "flush";
            output.flush();
            stage = "close";
        } catch (IOException | RuntimeException exception) {
            throw new DocumentWriteException(stage, exception);
        }
    }

    static void copyDocument(OutputOpener opener, InputStream input, int limit, BooleanSupplier active) throws IOException {
        if (input == null) throw new DocumentWriteException("read-input", new IOException("Missing document input"));
        String stage = "before-open";
        try {
            if (!active.getAsBoolean()) throw new IOException("Operation interrupted");
            byte[] buffer = new byte[8192];
            stage = "read-input";
            int count = readChunk(input, buffer, Math.min(buffer.length, limit + 1));
            if (count < 1) throw new IOException("Empty document input");
            if (count > limit) throw new IOException("Document exceeds byte limit");
            if (!active.getAsBoolean()) throw new IOException("Operation interrupted");
            stage = "open-output";
            OutputStream stream = opener.open();
            if (stream == null) throw new IOException("No output stream");
            try (OutputStream output = stream) {
                int total = 0;
                while (count != -1) {
                    if (!active.getAsBoolean()) throw new IOException("Operation interrupted");
                    if (count > limit - total) throw new IOException("Document exceeds byte limit");
                    stage = "write";
                    output.write(buffer, 0, count);
                    total += count;
                    stage = "read-input";
                    count = readChunk(input, buffer, Math.min(buffer.length, limit - total + 1));
                }
                if (!active.getAsBoolean()) throw new IOException("Operation interrupted");
                stage = "flush";
                output.flush();
                stage = "close";
            }
        } catch (IOException | RuntimeException exception) {
            throw new DocumentWriteException(stage, exception);
        }
    }

    private static int readChunk(InputStream input, byte[] buffer, int count) throws IOException {
        int result = input.read(buffer, 0, count);
        if (result != 0) return result;
        int one = input.read();
        if (one == -1) return -1;
        buffer[0] = (byte) one;
        return 1;
    }

    static String failureDiagnostic(String stage, Exception exception) {
        Throwable failure = exception;
        if (exception instanceof DocumentWriteException) {
            stage = ((DocumentWriteException) exception).stage;
            failure = exception.getCause();
        }
        Throwable cause = failure.getCause();
        // Fixed operation stage and class names only: never include provider messages, paths, text or stack traces.
        return "stage=" + stage + " exception=" + failure.getClass().getSimpleName()
            + " cause=" + (cause == null ? "none" : cause.getClass().getSimpleName());
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
        String title = note.getString("title");
        validateSingleLine(title, 200, true);
        JSONObject source = new JSONObject();
        JSONObject meta = note.optJSONObject("meta");
        for (String field : SOURCE_FIELDS) {
            Object value = meta == null ? null : meta.opt(field);
            if (value instanceof String) {
                validateSingleLine((String) value, "url".equals(field) || "locator".equals(field) ? 2048 : 200, false);
                if ("url".equals(field)) validateExchangeUrl((String) value);
                source.put(field, value);
            }
        }
        JSONObject header = new JSONObject().put("format", "zhixu-source-exchange").put("version", 1)
            .put("title", title).put("source", source);
        return ("---\n" + header.toString() + "\n---\n" + note.getString("body")).getBytes(StandardCharsets.UTF_8);
    }

    private static void validateSingleLine(String value, int limit, boolean title) throws LocalSourceStore.StoreException {
        boolean invalidValue = value.codePointCount(0, value.length()) > limit || (title && value.trim().isEmpty());
        if (!value.isEmpty() && (boundaryWhitespace(value.charAt(0)) || boundaryWhitespace(value.charAt(value.length() - 1)))) invalidValue = true;
        for (int index = 0; index < value.length(); index++) {
            char unit = value.charAt(index);
            if (unit == '\r' || unit == '\n' || unit == '\0' || (title && Character.isISOControl(unit))) invalidValue = true;
        }
        if (invalidValue) throw invalid("标题或来源信息无法用于原文交换。请在资料编辑中检查长度、换行与首尾空白后重新导出；原资料不会自动修改。");
    }

    private static boolean boundaryWhitespace(char value) {
        // Union of Java trim and ECMAScript trim, so both importers preserve attribution verbatim.
        return value <= 0x20 || value == 0x00a0 || value == 0x1680 || value >= 0x2000 && value <= 0x200a
            || value == 0x2028 || value == 0x2029 || value == 0x202f || value == 0x205f || value == 0x3000 || value == 0xfeff;
    }

    private static void validatePortableDnsHost(String host) {
        String dnsHost = host.endsWith(".") ? host.substring(0, host.length() - 1) : host;
        for (String label : dnsHost.split("\\.", -1)) {
            String decoded = label;
            if (label.regionMatches(true, 0, "xn--", 0, 4)) {
                decoded = IDN.toUnicode(label);
                if (decoded.equalsIgnoreCase(label)
                    || !IDN.toASCII(decoded, IDN.USE_STD3_ASCII_RULES).equalsIgnoreCase(label)) throw new IllegalArgumentException();
            }
            // Same explicit repertoire as the web importer; do not depend on differing IDNA versions.
            if (!decoded.matches("[a-zA-Z0-9\u4e00-\u9fff](?:[a-zA-Z0-9\u4e00-\u9fff-]*[a-zA-Z0-9\u4e00-\u9fff])?")) {
                throw new IllegalArgumentException();
            }
        }
        String ascii = IDN.toASCII(dnsHost, IDN.USE_STD3_ASCII_RULES);
        if (ascii.length() > 253) throw new IllegalArgumentException();
    }

    private static void validateExchangeUrl(String value) throws LocalSourceStore.StoreException {
        if (value.isEmpty()) return;
        try {
            // Match the stored/exchange field limit; never truncate or silently drop a source.
            if (value.codePointCount(0, value.length()) > 2048 || value.indexOf('\0') >= 0) throw new IllegalArgumentException();
            for (int index = 0; index < value.length(); index++) {
                if (Character.isISOControl(value.charAt(index))) throw new IllegalArgumentException();
            }
            // Parsing only: URL/URI/IDN perform no network request or DNS lookup here.
            URL parsed = new URL(value);
            if (!("http".equalsIgnoreCase(parsed.getProtocol()) || "https".equalsIgnoreCase(parsed.getProtocol()))
                || parsed.getHost().isEmpty() || parsed.getPort() > 65535) throw new IllegalArgumentException();
            // URL.getPort() conflates an omitted port and explicit :-1; validate the original spelling too.
            String authority = parsed.getAuthority();
            String hostPort = authority.substring(authority.lastIndexOf('@') + 1);
            String port = null;
            if (hostPort.startsWith("[")) {
                int closingBracket = hostPort.indexOf(']');
                if (closingBracket == -1) throw new IllegalArgumentException();
                String suffix = hostPort.substring(closingBracket + 1);
                if (!suffix.isEmpty()) {
                    if (!suffix.startsWith(":")) throw new IllegalArgumentException();
                    port = suffix.substring(1);
                }
            } else if (hostPort.indexOf(':') != -1) {
                port = hostPort.substring(hostPort.lastIndexOf(':') + 1);
            }
            // WHATWG allows an empty port, but no sign, decimal point, exponent or radix prefix.
            if (port != null && !port.matches("[0-9]*")) throw new IllegalArgumentException();
            String host = parsed.getHost();
            if (host.startsWith("[")) {
                // Java accepts scoped IPv6 (%eth0 / %25eth0), but WHATWG URL cannot import it.
                if (host.indexOf('%') != -1) throw new IllegalArgumentException();
                if (host.indexOf('.') != -1) {
                    // Embedded IPv4 follows stricter IPv6 grammar: four decimal parts without leading zeros.
                    validateDottedIpv4(host.substring(host.lastIndexOf(':') + 1, host.length() - 1));
                }
            } else validatePortableDnsHost(host);
            String asciiHost = host.startsWith("[") ? host : IDN.toASCII(host, IDN.USE_STD3_ASCII_RULES);
            if (new URI("http://" + asciiHost).getHost() == null) throw new IllegalArgumentException();
            // WHATWG treats a host ending in a number as IPv4; reject malformed numeric hosts.
            String numericHost = asciiHost.endsWith(".") ? asciiHost.substring(0, asciiHost.length() - 1) : asciiHost;
            String lastLabel = numericHost.substring(numericHost.lastIndexOf('.') + 1);
            if (lastLabel.matches("[0-9]+") || lastLabel.matches("(?i)0x[0-9a-f]*")) {
                validateDottedIpv4(numericHost);
            }
        } catch (Exception exception) {
            throw invalid("来源链接无法用于原文交换。请在资料编辑中改为含有效主机的 HTTP 或 HTTPS 完整网址（最多 2048 个字符），或清空链接后重新导出；其他来源信息会保留。");
        }
    }

    private static void validateDottedIpv4(String value) {
        String[] parts = value.split("\\.", -1);
        if (parts.length != 4) throw new IllegalArgumentException();
        for (String part : parts) {
            if (!part.matches("0|[1-9][0-9]{0,2}") || Integer.parseInt(part) > 255) throw new IllegalArgumentException();
        }
    }

    private static LocalSourceStore.StoreException invalid(String message) {
        return new LocalSourceStore.StoreException("VALIDATION", message);
    }

    private SourceDocumentFiles() {}
}
