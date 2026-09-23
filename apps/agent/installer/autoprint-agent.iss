; Inno Setup script — packages the pkg-built AutoPrint-Agent.exe into a
; Windows installer with a Start Menu entry and optional "run at startup".
; Build the .exe first with `npm run package:win`, then compile this with
; the Inno Setup Compiler (ISCC.exe) on Windows.

#define MyAppName "AutoPrint Agent"
#define MyAppVersion "1.0.0"
#define MyAppExeName "AutoPrint-Agent.exe"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={autopf}\AutoPrint Agent
DefaultGroupName=AutoPrint Agent
OutputBaseFilename=AutoPrint-Agent-Setup
Compression=lzma
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64

[Files]
Source: "..\dist\AutoPrint-Agent.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\AutoPrint Agent"; Filename: "{app}\{#MyAppExeName}"
Name: "{userstartup}\AutoPrint Agent"; Filename: "{app}\{#MyAppExeName}"; Tasks: startup

[Tasks]
Name: "startup"; Description: "Start AutoPrint Agent automatically when Windows starts"; GroupDescription: "Startup:"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch AutoPrint Agent now"; Flags: nowait postinstall skipifsilent
