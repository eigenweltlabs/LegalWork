// Synthetic Cloud Files provider. No OneDrive account or customer files are used.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class CloudFilesFixture {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct Registration {
    public uint Size;
    [MarshalAs(UnmanagedType.LPWStr)] public string Name;
    [MarshalAs(UnmanagedType.LPWStr)] public string Version;
    public IntPtr RootIdentity; public uint RootIdentityLength;
    public IntPtr FileIdentity; public uint FileIdentityLength; public Guid Provider;
  }
  [StructLayout(LayoutKind.Sequential)] struct Policy {
    public uint Size; public ushort Hydration, HydrationModifier, Population, PopulationModifier;
    public uint InSync, HardLink, Management;
  }
  [StructLayout(LayoutKind.Sequential)] struct BasicInfo {
    public long Created, Accessed, Modified, Changed; public uint Attributes;
  }
  [StructLayout(LayoutKind.Sequential)] struct Metadata { public BasicInfo Basic; public long Size; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Placeholder {
    [MarshalAs(UnmanagedType.LPWStr)] public string Name;
    public Metadata Metadata; public IntPtr Identity; public uint IdentityLength, Flags;
    public int Result; public long Usn;
  }
  [StructLayout(LayoutKind.Sequential)] struct CallbackInfo {
    public uint Size; public long Connection; public IntPtr Context, VolumeGuid, VolumeDos;
    public uint VolumeSerial; public long RootFileId; public IntPtr RootIdentity; public uint RootIdentityLength;
    public long FileId, FileSize; public IntPtr FileIdentity; public uint FileIdentityLength;
    public IntPtr Path; public long Transfer; public byte Priority; public IntPtr Correlation, Process; public long Request;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
    public uint Size, Pid; public IntPtr Image, Package, Application, Command; public uint Session;
  }
  [StructLayout(LayoutKind.Sequential)] struct CallbackRegistration { public int Type; public IntPtr Handler; }
  [StructLayout(LayoutKind.Sequential)] struct Operation {
    public uint Size; public int Type; public long Connection, Transfer;
    public IntPtr Correlation, SyncStatus; public long Request;
  }
  [StructLayout(LayoutKind.Explicit, Size = 40)] struct Transfer {
    [FieldOffset(0)] public uint Size;
    [FieldOffset(8)] public uint Flags;
    [FieldOffset(12)] public int Status;
    [FieldOffset(16)] public IntPtr Buffer;
    [FieldOffset(24)] public long Offset;
    [FieldOffset(32)] public long Length;
  }
  [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate void Callback(ref CallbackInfo info, IntPtr parameters);
  [DllImport("cldapi.dll", CharSet = CharSet.Unicode)] static extern int CfRegisterSyncRoot(string root, ref Registration registration, ref Policy policy, uint flags);
  [DllImport("cldapi.dll", CharSet = CharSet.Unicode)] static extern int CfUnregisterSyncRoot(string root);
  [DllImport("cldapi.dll", CharSet = CharSet.Unicode)] static extern int CfConnectSyncRoot(string root, CallbackRegistration[] callbacks, IntPtr context, uint flags, out long connection);
  [DllImport("cldapi.dll")] static extern int CfDisconnectSyncRoot(long connection);
  [DllImport("cldapi.dll", CharSet = CharSet.Unicode)] static extern int CfCreatePlaceholders(string root, [In, Out] Placeholder[] files, uint count, uint flags, out uint processed);
  [DllImport("cldapi.dll")] static extern int CfExecute(ref Operation operation, ref Transfer transfer);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFile(string file, uint access, uint sharing, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("cldapi.dll")] static extern int CfSetInSyncState(IntPtr handle, int state, uint flags, IntPtr usn);
  [DllImport("cldapi.dll")] static extern int CfDehydratePlaceholder(IntPtr handle, long offset, long length, uint flags, IntPtr overlapped);

  const int FileSize = 65536;
  static readonly object Gate = new object();
  static readonly byte[] Content = MakeContent();
  static Callback callback = Fetch;
  static byte[] MakeContent() {
    var bytes = new byte[FileSize];
    for (int i = 0; i < bytes.Length; i++) bytes[i] = (byte)'A';
    Encoding.UTF8.GetBytes("Synthetic fixture-clause.\n").CopyTo(bytes, 0);
    return bytes;
  }
  static void Check(int result, string operation) {
    if (result < 0) throw new Exception(operation + " failed: 0x" + result.ToString("X8"));
  }
  static string Json(string value) { return "\"" + (value ?? "unknown").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n") + "\""; }
  static void Emit(string value) { lock (Gate) { Console.WriteLine(value); Console.Out.Flush(); } }
  static void Fetch(ref CallbackInfo info, IntPtr parameters) {
    var operation = new Operation { Size = (uint)Marshal.SizeOf(typeof(Operation)), Connection = info.Connection, Transfer = info.Transfer, Request = info.Request };
    string file = Path.GetFileName(Marshal.PtrToStringUni(info.Path));
    string image = "unknown"; uint pid = 0;
    if (info.Process != IntPtr.Zero) {
      var process = (ProcessInfo)Marshal.PtrToStructure(info.Process, typeof(ProcessInfo));
      image = Marshal.PtrToStringUni(process.Image) ?? "unknown"; pid = process.Pid;
    }
    Emit("{\"event\":\"hydrate\",\"file\":" + Json(file) + ",\"image\":" + Json(image) + ",\"pid\":" + pid + "}");
    ThreadPool.QueueUserWorkItem(delegate { Supply(operation); });
  }
  static void Supply(Operation operation) {
    IntPtr buffer = Marshal.AllocHGlobal(FileSize);
    try {
      Marshal.Copy(Content, 0, buffer, FileSize);
      var transfer = new Transfer { Size = 40, Buffer = buffer, Length = FileSize };
      Check(CfExecute(ref operation, ref transfer), "CfExecute");
    } catch (Exception error) { Emit("{\"event\":\"callback-error\",\"message\":" + Json(error.Message) + "}"); }
    finally { Marshal.FreeHGlobal(buffer); }
  }
  public static void Main(string[] args) {
    string root = Path.GetFullPath(args[0]);
    long connection = 0;
    Directory.CreateDirectory(root);
    var registration = new Registration { Size = (uint)Marshal.SizeOf(typeof(Registration)), Name = "LegalWork synthetic hydration test", Version = "1", Provider = new Guid("6e671a73-777d-4bc3-9c0c-443791f592a8") };
    var policy = new Policy { Size = (uint)Marshal.SizeOf(typeof(Policy)), Hydration = 2, HydrationModifier = 4, Population = 3 };
    Check(CfRegisterSyncRoot(root, ref registration, ref policy, 0), "CfRegisterSyncRoot");
    try {
      var registrations = new[] {
        new CallbackRegistration { Type = 0, Handler = Marshal.GetFunctionPointerForDelegate(callback) },
        new CallbackRegistration { Type = -1 }
      };
      Check(CfConnectSyncRoot(root, registrations, IntPtr.Zero, 6, out connection), "CfConnectSyncRoot");
      long time = DateTime.UtcNow.AddDays(-1).ToFileTimeUtc();
      IntPtr identity = Marshal.StringToHGlobalUni("synthetic");
      try {
      for (int index = 0; index < 24; index++) {
        string name = "document-" + index.ToString("D2") + ".txt";
        var files = new[] { new Placeholder { Name = name, Flags = 2, Identity = identity, IdentityLength = 18,
          Metadata = new Metadata { Size = FileSize, Basic = new BasicInfo { Created = time, Accessed = time, Modified = time, Changed = time, Attributes = 0x80 } } } };
        uint processed;
        Check(CfCreatePlaceholders(root, files, 1, 0, out processed), "CfCreatePlaceholders");
        Check(files[0].Result, "placeholder");
      }
      } finally { Marshal.FreeHGlobal(identity); }
      Emit("{\"event\":\"ready\",\"files\":24}");
      string command;
      while ((command = Console.ReadLine()) != null && command != "stop") {
        if (command == "dehydrate") {
          foreach (string file in Directory.GetFiles(root, "document-*.txt")) {
            // Attribute/WRITE_DAC access avoids hydrating files while resetting the fixture.
            IntPtr handle = CreateFile(file, 0x40100, 0, IntPtr.Zero, 3, 0x200000, IntPtr.Zero);
            if (handle == new IntPtr(-1)) throw new Exception("CreateFile failed: " + Marshal.GetLastWin32Error());
            try {
              Check(CfSetInSyncState(handle, 1, 0, IntPtr.Zero), "CfSetInSyncState");
              Check(CfDehydratePlaceholder(handle, 0, -1, 0, IntPtr.Zero), "CfDehydratePlaceholder");
            } finally { CloseHandle(handle); }
          }
          Emit("{\"event\":\"dehydrated\"}");
        }
      }
    } finally {
      if (connection != 0) CfDisconnectSyncRoot(connection);
      CfUnregisterSyncRoot(root);
    }
    GC.KeepAlive(callback);
  }
}
