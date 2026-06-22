; Qimchi Inno Setup installer script
;
; Packages the PyInstaller onedir output (packaging\build\qimchi\) into a
; signed Windows installer with desktop shortcut and Start Menu entry.
;
; Build via build_local.ps1 (recommended) or directly:
;   ISCC.exe /DAppVersion=0.5.3 /Q packaging\setup.iss
;
; Per-user install is the default (no UAC prompt).  Pass /ALLUSERS on the
; command line, or let the user choose at install time via the dialog, to
; install system-wide under Program Files.

#ifndef AppVersion
#define AppVersion "0.0.0"
#endif

[Setup]
AppId={{7C5F3B82-A1E4-4D6F-9B2C-E5D8F3A7C6B1}
AppName=Qimchi
AppVersion={#AppVersion}
AppVerName=Qimchi {#AppVersion}
AppPublisher=squad-lab (FZJ / NISER)
AppPublisherURL=https://gitlab.com/squad-lab/qimchi
AppSupportURL=https://gitlab.com/squad-lab/qimchi/-/issues
AppUpdatesURL=https://gitlab.com/squad-lab/qimchi/-/releases

; Per-user by default (no UAC).  /ALLUSERS on the command line or the
; "Install for all users" dialog choice switches to machine-wide under PF.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline dialog

; Install dir adapts to per-user vs. all-users mode (see [Code] below).
DefaultDirName={code:GetDefaultInstallDir}
DefaultGroupName=Qimchi
DisableProgramGroupPage=yes

; Output
OutputBaseFilename=qimchi-setup
OutputDir=..\packaging\build
SetupIconFile=..\packaging\build\qimchi-logo.ico
UninstallDisplayName=Qimchi {#AppVersion}
UninstallDisplayIcon={app}\qimchi.exe

; Compression
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes

; UI
WizardStyle=modern
DisableWelcomePage=no

; Minimum: Windows 11 21H2
MinVersion=10.0.22000

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
; Desktop shortcut is opt-in
Name: "desktopicon"; \
    Description: "{cm:CreateDesktopIcon}"; \
    GroupDescription: "{cm:AdditionalIcons}"; \
    Flags: unchecked

[Files]
; The entire onedir output — qimchi.exe plus _internal/ with Python runtime,
; all dependencies, bundled fd.exe, and the frontend/backend data.
Source: "..\packaging\build\qimchi\*"; \
    DestDir: "{app}"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Start Menu
Name: "{group}\Qimchi"; \
    Filename: "{app}\qimchi.exe"
Name: "{group}\{cm:UninstallProgram,Qimchi}"; \
    Filename: "{uninstallexe}"
; Desktop (optional task)
Name: "{autodesktop}\Qimchi"; \
    Filename: "{app}\qimchi.exe"; \
    Tasks: desktopicon

[Run]
; Offer to launch after install
Filename: "{app}\qimchi.exe"; \
    Description: "{cm:LaunchProgram,Qimchi}"; \
    Flags: nowait postinstall skipifsilent

[UninstallRun]
; Nothing extra — Inno Setup removes everything under {app} automatically.

[Code]

{ Return the appropriate default install directory.
  Per-user → LocalAppData\Qimchi   (no UAC)
  All-users → Program Files\Qimchi (requires admin) }
function GetDefaultInstallDir(Param: string): string;
begin
  if IsAdminInstallMode then
    Result := ExpandConstant('{commonpf64}\Qimchi')
  else
    Result := ExpandConstant('{localappdata}\Qimchi');
end;
