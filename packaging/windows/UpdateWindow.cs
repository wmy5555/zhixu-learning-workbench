using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Management;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class UpdateLocation {
    public string Custom,App,Data;
    public override string ToString(){return (Custom==null?"默认便携版":"自定义便携版")+" · "+Data;}
}
internal sealed class UpdateWindow : Form {
    readonly ComboBox targets=new ComboBox{Dock=DockStyle.Top,DropDownStyle=ComboBoxStyle.DropDownList};
    readonly TextBox paths=new TextBox{Dock=DockStyle.Top,Height=95,Multiline=true,ReadOnly=true,BorderStyle=BorderStyle.None};
    readonly Label phase=new Label{Dock=DockStyle.Top,Height=78};
    readonly ProgressBar progress=new ProgressBar{Dock=DockStyle.Top,Height=18};
    readonly Button start=new Button{Text="开始更新",AutoSize=true,Enabled=false};
    readonly Button selectExe=new Button{Text="选择原知序.exe",AutoSize=true};
    readonly Button selectData=new Button{Text="选择数据目录",AutoSize=true};
    readonly Button close=new Button{Text="关闭",AutoSize=true};
    readonly string[] args; bool working;
    public UpdateWindow(string[] input){
        args=input;Text="知序增量更新";ShowInTaskbar=true;StartPosition=FormStartPosition.CenterScreen;
        ClientSize=new Size(720,370);MinimumSize=new Size(650,400);Font=new Font("Microsoft YaHei UI",10);Padding=new Padding(22);
        var title=new Label{Text="更新知序",Dock=DockStyle.Top,Height=45,Font=new Font(Font,FontStyle.Bold)};
        var buttons=new FlowLayoutPanel{Dock=DockStyle.Bottom,Height=46};buttons.Controls.AddRange(new Control[]{start,selectExe,selectData,close});
        Controls.AddRange(new Control[]{progress,phase,paths,targets,title,buttons});
        targets.SelectedIndexChanged+=(s,e)=>{var t=targets.SelectedItem as UpdateLocation;if(t!=null)paths.Text="程序目录："+t.App+Environment.NewLine+"资料目录："+t.Data;};
        close.Click+=(s,e)=>Close();FormClosing+=(s,e)=>{if(working)e.Cancel=true;};
        start.Click+=(s,e)=>{var t=targets.SelectedItem as UpdateLocation;if(t==null)return;Working(true);Task.Run(()=>{var a=new List<string>(args);int pos=a.IndexOf("--data-dir");if(pos>=0)a.RemoveRange(pos,2);if(t.Custom!=null){a.Add("--data-dir");a.Add(t.Custom);}int code=Updater.Run(a.ToArray(),this);Post(()=>{Working(false);if(code==0)start.Enabled=false;});});};
        selectData.Click+=(s,e)=>{using(var picker=new FolderBrowserDialog{Description="选择原知序数据目录，或含 .complete 的程序缓存目录"})if(picker.ShowDialog(this)==DialogResult.OK){try{SetTargets(new[]{Updater.ResolveFolder(picker.SelectedPath)});}catch(Exception error){Progress(error.Message,0);}}};
        selectExe.Click+=(s,e)=>{using(var picker=new OpenFileDialog{Title="选择 2026-10-21 的原知序.exe",Filter="Windows 程序|*.exe",CheckFileExists=true})if(picker.ShowDialog(this)==DialogResult.OK){Working(true);string exe=picker.FileName;Task.Run(()=>{try{var target=Updater.ReadOriginalExe(exe,this);Post(()=>SetTargets(new[]{target}));}catch(Exception error){Progress(error.Message,0);}finally{Post(()=>Working(false));}});}};
        Shown+=(s,e)=>{Raise();Progress("正在查找兼容便携版…",0);Task.Run(()=>{try{var found=Updater.Discover(args);Post(()=>SetTargets(found));}catch(Exception error){Progress(error.Message,0);}});};
    }
    public void Post(Action action){if(!IsDisposed&&IsHandleCreated)BeginInvoke(action);}
    void Working(bool value){working=value;targets.Enabled=selectExe.Enabled=selectData.Enabled=close.Enabled=!value;start.Enabled=!value&&targets.SelectedItem!=null;}
    void SetTargets(UpdateLocation[] found){targets.Items.Clear();targets.Items.AddRange(found);if(found.Length>0){targets.SelectedIndex=0;start.Enabled=true;phase.Text=found.Length>1?"找到多个便携版，请选择要更新的资料目录。":"已找到知序。请先保存网页输入，再开始更新。";}else{start.Enabled=false;phase.Text="没有找到兼容旧版。请选择原知序.exe或数据目录。只有更新包、没有旧程序时，不能独立安装。";}}
    public void Progress(string text,int value){Post(()=>{phase.Text=text;progress.Value=Math.Max(0,Math.Min(100,value));});}
    public void Raise(){Post(()=>{if(WindowState==FormWindowState.Minimized)WindowState=FormWindowState.Normal;Show();TopMost=true;Activate();BringToFront();TopMost=false;});}
    public bool Confirm(string app,string data){return (bool)Invoke(new Func<bool>(()=>MessageBox.Show(this,"更新此便携版？\n\n程序："+app+"\n资料："+data+"\n\n请先保存网页输入。更新会退出此实例并保留旧程序，不替换资料、设置和凭据。","确认更新",MessageBoxButtons.OKCancel,MessageBoxIcon.Information)==DialogResult.OK));}
}
internal static partial class Updater {
    [DllImport("shell32.dll",CharSet=CharSet.Unicode)]static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
    static string PortableHome=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ZhixuPortable");
    static UpdateManifest LoadManifest(){using(var raw=Assembly.GetExecutingAssembly().GetManifestResourceStream("update.json"))using(var reader=new StreamReader(raw))return new JavaScriptSerializer{MaxJsonLength=32*1024*1024}.Deserialize<UpdateManifest>(reader.ReadToEnd());}
    static UpdateLocation Location(string custom){
        var m=LoadManifest();string data=Path.GetFullPath(custom??Path.Combine(PortableHome,"data")).TrimEnd('\\');
        string app=Path.Combine(custom==null?Path.Combine(PortableHome,"versions"):Path.Combine(data,".app","versions"),m.basePayloadHash.Substring(0,20));NoLink(data);NoLink(app);
        if(!File.Exists(Path.Combine(app,".complete"))||File.ReadAllText(Path.Combine(app,".complete"))!=m.basePayloadHash)throw new Exception("此目录没有兼容便携版。请选择原知序.exe或实际数据目录，不能更新 4318 源码服务。");
        return new UpdateLocation{Custom=custom==null?null:data,Data=data,App=app};
    }
    internal static UpdateLocation ResolveFolder(string folder){
        folder=Path.GetFullPath(folder).TrimEnd('\\');var m=LoadManifest();
        if(File.Exists(Path.Combine(folder,".complete"))){string parent=Path.GetDirectoryName(folder);if(String.Equals(parent,Path.Combine(PortableHome,"versions"),StringComparison.OrdinalIgnoreCase))return Location(null);
            if(Path.GetFileName(parent)=="versions"&&Path.GetFileName(Path.GetDirectoryName(parent))==".app")return Location(Path.GetDirectoryName(Path.GetDirectoryName(parent)));
            throw new Exception("程序缓存目录不符合原启动器布局，请选择原数据目录。");}
        if(String.Equals(folder,Path.Combine(PortableHome,"data"),StringComparison.OrdinalIgnoreCase))return Location(null);return Location(folder);
    }
    [DllImport("shell32.dll",SetLastError=true)]static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)]string command,out int count);
    [DllImport("kernel32.dll")]static extern IntPtr LocalFree(IntPtr pointer);
    static string[] Split(string command){int n;var p=CommandLineToArgvW(command,out n);if(p==IntPtr.Zero)return new string[0];try{var a=new string[n];for(int i=0;i<n;i++)a[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(p,i*IntPtr.Size));return a;}finally{LocalFree(p);}}
    internal static UpdateLocation[] Discover(string[] args){
        string custom=Arg(args,"--data-dir");if(custom!=null)return new[]{Location(custom)};
        var found=new List<UpdateLocation>();Action<UpdateLocation> add=t=>{if(!found.Exists(x=>String.Equals(x.App,t.App,StringComparison.OrdinalIgnoreCase)))found.Add(t);};try{add(Location(null));}catch{}
        // Old EXEs never registered their location. Inspect only known launchers'
        // identity and explicit custom path; do not scan disks or personal data.
        var m=LoadManifest();if(Arg(args,"--portable-home")==null)try{using(var search=new ManagementObjectSearcher("SELECT ExecutablePath,CommandLine FROM Win32_Process WHERE Name='知序.exe'"))using(var rows=search.Get())foreach(ManagementObject item in rows){try{string exe=item["ExecutablePath"] as string,cmd=item["CommandLine"] as string;if(exe!=null&&cmd!=null&&HashFile(exe)==m.baseExeSha256)add(Location(Arg(Split(cmd),"--data-dir")));}catch{}}}catch{}
        return found.ToArray();
    }
    internal static UpdateLocation ReadOriginalExe(string exe,UpdateWindow view){
        var m=LoadManifest();NoLink(exe);if(HashFile(exe)!=m.baseExeSha256)throw new Exception("所选 EXE 不是此更新包支持的 2026-10-21 原版，未启动或修改它。");
        try{return Location(null);}catch{}
        string versions=Path.Combine(PortableHome,"versions");NoLink(versions);Directory.CreateDirectory(versions);
        string stage=Path.Combine(versions,"base-"+Guid.NewGuid().ToString("N").Substring(0,8));Directory.CreateDirectory(stage);
        var assembly=Assembly.Load(File.ReadAllBytes(exe));using(var raw=assembly.GetManifestResourceStream("payload.zip"))if(raw==null||Hash(raw)!=m.basePayloadHash)throw new Exception("原 EXE 内置文件校验失败。");
        using(var raw=assembly.GetManifestResourceStream("payload.zip"))using(var zip=new ZipArchive(raw,ZipArchiveMode.Read)){int n=0;foreach(var entry in zip.Entries){if(entry.FullName.EndsWith("/"))continue;string dest=Within(stage,entry.FullName);Directory.CreateDirectory(Path.GetDirectoryName(dest));using(var src=entry.Open())using(var dst=new FileStream(dest,FileMode.CreateNew,FileAccess.Write))src.CopyTo(dst);if(++n%100==0&&view!=null)view.Progress("正在读取原程序，不启动知序（"+n+"）",n*100/zip.Entries.Count);}}
        // Original resource has an embedded archive hash; the updater also verifies
        // every baseline file again before any upgrade can be applied.
        File.WriteAllText(Path.Combine(stage,".complete"),m.basePayloadHash);string final=Path.Combine(versions,m.basePayloadHash.Substring(0,20));
        if(Directory.Exists(final))throw new Exception("目标缓存已存在但不兼容，原目录保持不变。请选择实际数据目录。");Directory.Move(stage,final);return Location(null);
    }
    [STAThread]static int Main(string[] args){
        AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling",false);AppContext.SetSwitch("Switch.System.IO.BlockLongPaths",false);SetCurrentProcessExplicitAppUserModelID("Zhixu.IncrementalUpdater");Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        Mutex ui=null;bool held=false;EventWaitHandle open=null;RegisteredWaitHandle wait=null;
        try{
            string homeOverride=Arg(args,"--portable-home");if(homeOverride!=null)PortableHome=Path.GetFullPath(homeOverride);string status=Arg(args,"--status-file");
            string original=Arg(args,"--original-exe");if(original!=null)ReadOriginalExe(original,null);
            if(Array.IndexOf(args,"--locate-only")>=0){string folder=Arg(args,"--select-folder");var locations=folder==null?Discover(args):new[]{ResolveFolder(folder)};if(status!=null)File.WriteAllText(status,new JavaScriptSerializer().Serialize(new{state="located",locations=locations}));return 0;}
            if(Array.IndexOf(args,"--yes")>=0)return Run(args,null);
            string name="Local\\ZhixuUpdaterUi-"+HashText(PortableHome.ToUpperInvariant()).Substring(0,24);ui=new Mutex(false,name+"-mutex");held=Own(ui,0);
            if(!held){try{using(var existing=EventWaitHandle.OpenExisting(name+"-open"))existing.Set();}catch(WaitHandleCannotBeOpenedException){}if(status!=null)File.WriteAllText(status,"{\"state\":\"focused-existing\"}");return 0;}
            open=new EventWaitHandle(false,EventResetMode.AutoReset,name+"-open");using(var view=new UpdateWindow(args)){wait=ThreadPool.RegisterWaitForSingleObject(open,(state,timeout)=>view.Raise(),null,Timeout.Infinite,false);Application.Run(view);}return 0;
        }catch(Exception error){string output=Arg(args,"--status-file");if(output!=null)File.WriteAllText(output,new JavaScriptSerializer().Serialize(new{state="failed",message=error.Message}));if(Array.IndexOf(args,"--yes")<0&&Array.IndexOf(args,"--locate-only")<0)MessageBox.Show(error.Message,"知序更新未完成");return 1;}
        finally{if(wait!=null)wait.Unregister(null);if(open!=null)open.Dispose();if(ui!=null){if(held)ui.ReleaseMutex();ui.Dispose();}}
    }
}
