import * as Picker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
export async function pickFile({ maxBytes = 50_000_000 } = {}) {
  const result = await Picker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  const size = asset.size ?? file.size;
  if (size > maxBytes) throw Error(`每个文件最多 ${maxBytes / 1_000_000} MB`);
  return { ...asset, size, file };
}
export async function shareJSON(data: unknown, name = "zhixu-backup.json") {
  const file = new File(Paths.cache, name);
  file.write(JSON.stringify(data, null, 2));
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    UTI: "public.json",
  });
}
export async function shareAttachment(data: any) {
  const file = new File(Paths.cache, data.descriptor.name);
  file.write(data.base64, { encoding: "base64" });
  await Sharing.shareAsync(file.uri, { mimeType: data.descriptor.mime });
}

export async function shareText(text: string, name: string) {
  const file = new File(Paths.cache, name);
  file.write(text);
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/plain",
    UTI: "public.plain-text",
  });
}
