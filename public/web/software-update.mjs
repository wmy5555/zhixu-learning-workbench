import { escape as e } from './markdown.mjs';

export const softwareVersion = '2026.10.23.1';
export function softwareUpdateHTML() {
  return `<section id="settings-update"><h2>软件更新</h2><p>当前版本 ${softwareVersion}</p><div class="actions"><button type="button" class="secondary" data-software-update>检查更新</button></div><div data-update-result role="status" aria-live="polite"></div></section>`;
}

export function updateResult(release) {
  if (!release || !/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(release.version) ||
      !/^\/updates\/[a-z0-9-]+\.exe$/.test(release.url) ||
      !/^[a-f0-9]{64}$/.test(release.sha256) || !Number.isSafeInteger(release.bytes) || release.bytes <= 0) {
    throw Error('更新信息不完整，请稍后重试。');
  }
  const newer = release.version.localeCompare(softwareVersion, 'en', {numeric:true}) > 0;
  return `<p>${newer ? `可更新至 ${e(release.version)}` : `此处提供的版本为 ${e(release.version)}，无需重复更新。`}</p><p>此增量包用于升级 2026 年 10 月 21 日的知序便携版。先保存网页输入，再运行更新 EXE；更新会保留资料、设置和旧程序。</p><a class="secondary" href="${e(release.url)}" download>下载增量更新 EXE（${(release.bytes / 1048576).toFixed(1)} MB）</a><details><summary>文件校验</summary><p class="preserve-text">SHA-256: ${e(release.sha256)}</p></details>`;
}

export function mountSoftwareUpdate(root = document, request = fetch) {
  const button = root.querySelector('[data-software-update]');
  if (!button) return;
  const result = root.querySelector('[data-update-result]');
  button.onclick = async () => {
    if (button.disabled) return;
    button.disabled = true;
    result.textContent = '正在检查…';
    try {
      const response = await request('/updates/latest.json', {cache:'no-store', credentials:'omit', signal:AbortSignal.timeout(10000)});
      if (response.status === 404) throw Error('此实例尚未提供更新包。已有增量更新 EXE 时，保存输入后直接运行它；当前版本不代表已是最新。');
      if (!response.ok) throw Error('暂时无法读取更新信息，请重试。');
      result.innerHTML = updateResult(await response.json());
    } catch (error) {
      result.textContent = error.name === 'TimeoutError' ? '检查超时，请重试。' : error.message;
    } finally { button.disabled = false; }
  };
}
