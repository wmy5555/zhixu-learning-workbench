export function spawn() { throw Object.assign(Error('此电脑集成功能在桌面知序执行，请使用备份文件协作。'),{code:'DESKTOP_ONLY'}); }
export const execFileSync=spawn;
export default { spawn,execFileSync };
