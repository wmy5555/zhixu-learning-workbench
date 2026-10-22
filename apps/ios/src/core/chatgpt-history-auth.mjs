// Desktop pipe authentication stays in the desktop companion; never read device credentials.
export async function readHistoryHandoffKey(){throw Object.assign(Error('历史快照管道需要电脑知序；请使用导出文件协作。'),{code:'DESKTOP_ONLY'});}
