using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("知序增量更新")]
[assembly: AssemblyVersion("0.1.0.0")]
internal sealed class Entry { public string path; public string sha256; }
internal sealed class UpdateManifest {
    public string version, baseSourceSha, targetSourceSha, basePayloadHash, baseExeSha256;
    public Entry[] baseFiles, targetFiles, deltaFiles;
}
internal static partial class Updater {
    static string report; static bool quiet; static UpdateWindow window; static string phase="核对程序";
    static void Show(string text,int percent){phase=text;if(window!=null)window.Progress(text,percent);}
    static string Arg(string[] args,string name) { for(int i=0;i<args.Length;i++)if(args[i]==name){if(i+1==args.Length)throw new Exception("参数缺少值："+name);return args[i+1];}return null; }
    static string Hash(Stream stream) { using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
    static string HashFile(string file) { using(var s=File.Open(file,FileMode.Open,FileAccess.Read,FileShare.Read))return Hash(s); }
    static string HashText(string text) { using(var s=new MemoryStream(Encoding.UTF8.GetBytes(text)))return Hash(s); }
    static void NoLink(string file) {
        for(string p=file;!String.IsNullOrEmpty(p);p=Path.GetDirectoryName(p))
            if((File.Exists(p)||Directory.Exists(p))&&(File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0)throw new Exception("更新目录不能经过符号链接或联接："+p);
    }
    static string Within(string root,string relative) {
        if(String.IsNullOrEmpty(relative)||relative.Contains("\\")||relative.Contains(":")||relative.StartsWith("/")||Array.IndexOf(relative.Split('/'),"..")>=0)throw new Exception("更新文件路径无效。");
        string result=Path.GetFullPath(Path.Combine(root,relative.Replace('/',Path.DirectorySeparatorChar)));
        if(!result.StartsWith(root.TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase))throw new Exception("更新文件超出程序目录。");
        NoLink(result);return result;
    }
    static void Verify(string root,Entry[] files) { int i=0;string label=phase;foreach(var entry in files){if(HashFile(Within(root,entry.path))!=entry.sha256)throw new Exception("程序文件已改变，未执行更新："+entry.path);if(++i%100==0||i==files.Length)if(window!=null)window.Progress(label+"（"+i+"/"+files.Length+"）",i*100/files.Length);} }
    static bool Own(Mutex mutex,int timeout) { try{return mutex.WaitOne(timeout);}catch(AbandonedMutexException){return true;} }
    static void Record(object value) { if(report!=null)File.WriteAllText(report,new JavaScriptSerializer().Serialize(value),new UTF8Encoding(false)); }
    internal static int Run(string[] args,UpdateWindow view) {
        AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling",false);
        AppContext.SetSwitch("Switch.System.IO.BlockLongPaths",false);
        window=view;
        string stage=null,rollback=null,app=null;bool switched=false,held=false,updateHeld=false;
        Mutex gate=null,updateGate=null;
        try {
            quiet=Array.IndexOf(args,"--yes")>=0;report=Arg(args,"--status-file");
            UpdateManifest manifest;
            using(var raw=Assembly.GetExecutingAssembly().GetManifestResourceStream("update.json"))
            using(var reader=new StreamReader(raw))manifest=new JavaScriptSerializer(){MaxJsonLength=32*1024*1024}.Deserialize<UpdateManifest>(reader.ReadToEnd());
            string custom=Arg(args,"--data-dir"),home=PortableHome;
            string data=Path.GetFullPath(custom??Path.Combine(home,"data")).TrimEnd('\\');NoLink(data);
            string versions=custom==null?Path.Combine(home,"versions"):Path.Combine(data,".app","versions");
            app=Path.Combine(versions,manifest.basePayloadHash.Substring(0,20));NoLink(app);
            if(!File.Exists(Path.Combine(app,".complete"))||File.ReadAllText(Path.Combine(app,".complete"))!=manifest.basePayloadHash)throw new Exception("未找到 2026 年 10 月 21 日的知序便携版。请先运行原来的知序.exe，再运行本更新包。自定义数据目录请使用 --data-dir。此包不能更新 4318 源码服务。");
            string prefix="Local\\ZhixuPortable-"+HashText(data.ToUpperInvariant()).Substring(0,24);
            updateGate=new Mutex(false,prefix+"-update");updateHeld=Own(updateGate,0);
            if(!updateHeld)throw new Exception("另一个知序更新器正在运行，请等待它完成。");
            string current=Path.Combine(app,"package-manifest.json");
            var currentInfo=new JavaScriptSerializer(){MaxJsonLength=32*1024*1024}.DeserializeObject(File.ReadAllText(current)) as System.Collections.Generic.Dictionary<string,object>;
            if(currentInfo!=null&&currentInfo.ContainsKey("sourceSha")&&(string)currentInfo["sourceSha"]==manifest.targetSourceSha){Show("核对当前版本",0);Verify(app,manifest.targetFiles);Record(new{state="already-current",version=manifest.version});Show("当前已经是此更新包的版本，无需重复更新。",100);return 0;}
            Show("核对旧程序",0);
            Verify(app,manifest.baseFiles);
            using(var raw=Assembly.GetExecutingAssembly().GetManifestResourceStream("delta.zip"))if(Hash(raw)!=UpdateInfo.DeltaHash)throw new Exception("更新包校验失败，请重新复制。");
            if(!quiet&&view!=null&&!view.Confirm(app,data)){Show("已取消，程序和资料没有改变。",0);return 2;}
            Show("准备新版程序",0);
            // Keep temporary paths shorter than the original 20-character cache
            // key, so staging does not introduce a new Windows path-length limit.
            stage=Path.Combine(versions,"stage-"+Guid.NewGuid().ToString("N").Substring(0,8));Directory.CreateDirectory(stage);
            var delta=new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach(var entry in manifest.deltaFiles)delta.Add(entry.path);
            int copied=0;foreach(var entry in manifest.targetFiles)if(!delta.Contains(entry.path)) {
                string dest=Within(stage,entry.path);Directory.CreateDirectory(Path.GetDirectoryName(dest));File.Copy(Within(app,entry.path),dest);
                if(++copied%100==0&&view!=null)view.Progress("准备新版程序（"+copied+"）",copied*100/manifest.targetFiles.Length);
            }
            using(var raw=Assembly.GetExecutingAssembly().GetManifestResourceStream("delta.zip"))
            using(var zip=new ZipArchive(raw,ZipArchiveMode.Read)) {
                foreach(var entry in zip.Entries){if(!delta.Remove(entry.FullName))throw new Exception("更新包存在未声明或重复文件。");string dest=Within(stage,entry.FullName);Directory.CreateDirectory(Path.GetDirectoryName(dest));using(var src=entry.Open())using(var dst=new FileStream(dest,FileMode.CreateNew,FileAccess.Write))src.CopyTo(dst);}
            }
            if(delta.Count!=0)throw new Exception("更新包缺少文件。");Show("校验新版程序",0);Verify(stage,manifest.targetFiles);
            // The original EXE selects this immutable cache key. Keep its marker so
            // reopening that EXE selects the upgraded application, not its old payload.
            File.WriteAllText(Path.Combine(stage,".complete"),manifest.basePayloadHash);
            Show("等待知序安全退出",0);gate=new Mutex(false,prefix+"-mutex");held=Own(gate,0);
            if(!held){try{using(var stop=EventWaitHandle.OpenExisting(prefix+"-stop"))stop.Set();}catch(WaitHandleCannotBeOpenedException){throw new Exception("无法通知知序退出。请在托盘退出后重试。");}held=Own(gate,30000);if(!held)throw new Exception("知序仍在运行，未替换程序。请在托盘退出后重试。");}
            Show("切换前再次核对程序",0);Verify(app,manifest.baseFiles);NoLink(app);NoLink(stage);
            rollback=Path.Combine(versions,"rollback-"+Guid.NewGuid().ToString("N").Substring(0,8));
            Directory.Move(app,rollback);
            try{Directory.Move(stage,app);stage=null;switched=true;}catch{Directory.Move(rollback,app);rollback=null;throw;}
            Record(new{state="updated",version=manifest.version,sourceSha=manifest.targetSourceSha,rollback=rollback,dataPreserved=true});
            if(held){gate.ReleaseMutex();held=false;}
            Show("更新完成。请重新双击原来的知序.exe。旧程序保留在：\n"+rollback,100);
            return 0;
        } catch(Exception error) {
            try{Record(new{state="failed",message=error.Message,stage=stage,rollback=rollback,switched=switched});}catch{}
            Show(error.Message,0);return 1;
        } finally {if(gate!=null){if(held)gate.ReleaseMutex();gate.Dispose();}if(updateGate!=null){if(updateHeld)updateGate.ReleaseMutex();updateGate.Dispose();}}
    }
}
