; Qimchi Inno Setup installer script
;
; Packages the PyInstaller onedir output (packaging\build\qimchi\) into a
; signed Windows installer with desktop shortcut and Start Menu entry.
;
; Build via scripts/build_windows.ps1 (recommended) or directly:
;   ISCC.exe /DAppVersion=0.5.3 /Q packaging\setup.iss
;
; Per-user install is the default (no UAC prompt).  Pass /ALLUSERS on the
; command line, or let the user choose at install time via the dialog, to
; install system-wide under Program Files.

#ifndef AppVersion
#define AppVersion "0.0.0"
#endif

#ifndef AppFileVersion
#define AppFileVersion AppVersion
#endif

[Setup]
AppId={{7C5F3B82-A1E4-4D6F-9B2C-E5D8F3A7C6B1}
AppName=Qimchi
AppVersion={#AppVersion}
AppVerName=Qimchi {#AppVersion}
AppPublisher=squad-lab (FZJ)
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
; The installer file carries the release tag so a downloaded installer says
; which version it is. AppVersion stays a plain numeric version: Inno derives
; VersionInfoVersion from it, and that cannot hold an -rc suffix.
OutputBaseFilename=qimchi-setup-{#AppFileVersion}
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
WizardSmallImageFile=assets\qimchi-header.bmp,assets\qimchi-header@2x.bmp
WizardImageStretch=yes
DisableWelcomePage=yes
DisableDirPage=no
DisableReadyPage=yes
DisableFinishedPage=yes

; Minimum: Windows 11 21H2
MinVersion=10.0.22000

; Close a running (or stuck) Qimchi instead of failing on files in use. The
; bundle's Python extension modules (.pyd) are held open too.
CloseApplications=force
CloseApplicationsFilter=*.exe,*.dll,*.pyd
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[LangOptions]
DialogFontName=Segoe UI
DialogFontSize=10

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
; The configuration-page launch must bypass the installation marker too.
; Otherwise an interactive update exits immediately while Setup is still open.
Filename: "{app}\qimchi.exe"; \
    Parameters: "--after-update"; \
    Flags: nowait runasoriginaluser skipifsilent; \
    Check: ShouldLaunchQimchi
; Start Qimchi again after an in-app update (the updater passes /QIMCHIUPDATE=1),
; as the user who ran it rather than the elevated installer.
Filename: "{app}\qimchi.exe"; \
    Parameters: "--after-update"; \
    Flags: nowait runasoriginaluser skipifnotsilent; \
    Check: IsInAppUpdate

[UninstallRun]
; Nothing extra — Inno Setup removes everything under {app} automatically.

[Code]

var
  DesktopShortcutCheck: TNewCheckBox;
  LaunchQimchiCheck: TNewCheckBox;
  ApplyDesktopShortcutPreference: Boolean;

function ShouldLaunchQimchi: Boolean;
begin
  Result := LaunchQimchiCheck.Checked;
end;

procedure InitializeWizard;
var
  IntroLabel, FolderLabel, OptionsLabel, ScopeLabel: TNewStaticText;
begin
  WizardForm.Caption := 'Qimchi Setup';
  WizardForm.PageNameLabel.Font.Size := 14;
  WizardForm.PageNameLabel.Font.Color := $007A5730;
  WizardForm.PageNameLabel.Height := ScaleY(24);
  WizardForm.PageDescriptionLabel.SetBounds(
    WizardForm.PageNameLabel.Left,
    WizardForm.PageNameLabel.Top + WizardForm.PageNameLabel.Height + ScaleY(3),
    WizardForm.PageNameLabel.Width, ScaleY(18));
  WizardForm.SelectDirBitmapImage.Visible := False;
  WizardForm.SelectDirLabel.Visible := False;
  WizardForm.SelectDirBrowseLabel.Visible := False;

  IntroLabel := TNewStaticText.Create(WizardForm);
  IntroLabel.Parent := WizardForm.SelectDirPage;
  IntroLabel.SetBounds(0, 0, WizardForm.SelectDirPage.ClientWidth, ScaleY(32));
  IntroLabel.Caption := 'Plot your spicy quantum measurements';
  IntroLabel.Font.Size := 12;

  FolderLabel := TNewStaticText.Create(WizardForm);
  FolderLabel.Parent := WizardForm.SelectDirPage;
  FolderLabel.SetBounds(0, ScaleY(48), WizardForm.SelectDirPage.ClientWidth, ScaleY(20));
  FolderLabel.Caption := 'Install folder';
  FolderLabel.Font.Style := [fsBold];
  WizardForm.DirEdit.Top := ScaleY(74);
  WizardForm.DirBrowseButton.Top := WizardForm.DirEdit.Top;
  WizardForm.DirEdit.TabOrder := 0;
  WizardForm.DirBrowseButton.TabOrder := 1;

  ScopeLabel := TNewStaticText.Create(WizardForm);
  ScopeLabel.Parent := WizardForm.SelectDirPage;
  ScopeLabel.SetBounds(0, ScaleY(110), WizardForm.SelectDirPage.ClientWidth, ScaleY(20));
  if IsAdminInstallMode then
    ScopeLabel.Caption := 'Available to everyone on this computer.'
  else
    ScopeLabel.Caption := 'Installed for your account. No administrator rights needed.';
  ScopeLabel.Font.Color := $006B6257;

  OptionsLabel := TNewStaticText.Create(WizardForm);
  OptionsLabel.Parent := WizardForm.SelectDirPage;
  OptionsLabel.SetBounds(0, ScaleY(150), WizardForm.SelectDirPage.ClientWidth, ScaleY(20));
  OptionsLabel.Caption := 'Shortcuts and launch';
  OptionsLabel.Font.Style := [fsBold];

  DesktopShortcutCheck := TNewCheckBox.Create(WizardForm);
  DesktopShortcutCheck.Parent := WizardForm.SelectDirPage;
  DesktopShortcutCheck.SetBounds(0, ScaleY(178), WizardForm.SelectDirPage.ClientWidth, ScaleY(24));
  DesktopShortcutCheck.Caption := 'Create a desktop shortcut';
  { Inno creates the task controls only when it reaches wpSelectTasks.
    Keep an existing shortcut selected; new installs remain opt-in. }
  DesktopShortcutCheck.Checked := FileExists(ExpandConstant('{autodesktop}\Qimchi.lnk'));
  DesktopShortcutCheck.TabOrder := 2;

  LaunchQimchiCheck := TNewCheckBox.Create(WizardForm);
  LaunchQimchiCheck.Parent := WizardForm.SelectDirPage;
  LaunchQimchiCheck.SetBounds(0, ScaleY(208), WizardForm.SelectDirPage.ClientWidth, ScaleY(24));
  LaunchQimchiCheck.Caption := 'Start Qimchi after installation';
  LaunchQimchiCheck.Checked := True;
  LaunchQimchiCheck.TabOrder := 3;

  WizardForm.DiskSpaceLabel.Top := ScaleY(260);
  WizardForm.DiskSpaceLabel.Font.Color := $006B6257;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := PageID = wpSelectTasks;
  { Apply the configuration choice after Inno has created the native tasks.
    Silent installs keep Inno's previous selection and /TASKS overrides. }
  if Result and ApplyDesktopShortcutPreference then
  begin
    if DesktopShortcutCheck.Checked then
      WizardSelectTasks('desktopicon')
    else
      WizardSelectTasks('!desktopicon');
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpSelectDir then
  begin
    WizardForm.PageNameLabel.Caption := 'Configure Qimchi {#AppFileVersion}';
    WizardForm.PageDescriptionLabel.Caption := 'Step 1 of 2 - choose your preferences, then install.';
    WizardForm.NextButton.Caption := '&Install';
  end
  else if CurPageID = wpInstalling then
  begin
    WizardForm.PageNameLabel.Caption := 'Installing Qimchi {#AppFileVersion}';
    WizardForm.PageDescriptionLabel.Caption := 'Step 2 of 2 - getting everything ready.';
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  if (CurPageID = wpSelectDir) and not WizardSilent then
    ApplyDesktopShortcutPreference := True;
  Result := True;
end;

function IsInAppUpdate: Boolean;
begin
  Result := ExpandConstant('{param:QIMCHIUPDATE|0}') = '1';
end;

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

{ On uninstall, offer to remove only the app's CACHE from ~/.qimchi:
  the downloaded Chrome for image export (about 150 MB), the WebView storage
  (saved window/UI state), and the debug log. The library database
  (qimchi.db -- notes, hearts, tags) is deliberately KEPT so annotations
  survive a reinstall/upgrade, as are exports (~/Downloads), the datasets, and
  the live registry (live_measurements.db) written by qimchi-connect. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  QimchiHome: string;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    { ~ resolves to %USERPROFILE% for os.path.expanduser in the launcher. }
    QimchiHome := ExpandConstant('{%USERPROFILE%}\.qimchi');
    if DirExists(QimchiHome) then
    begin
      { No prompt possible in silent mode -> preserve everything. }
      if UninstallSilent then
        Exit;
      if MsgBox('Also remove the Qimchi cache?' + #13#10 +
          'This clears the downloaded Chrome for image export (about 150 MB), ' +
          'saved window/UI state, and the debug log.' + #13#10#13#10 +
          'Your library (notes, hearts, tags), exported plots, and datasets are KEPT.',
          mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      begin
        { Delete cache items individually -- never qimchi.db (and its -wal/-shm
          and .bak backups), which holds the user's library. }
        DelTree(QimchiHome + '\chrome', True, True, True);
        DelTree(QimchiHome + '\webview', True, True, True);
        { Logs are consolidated in <home>\logs (app log + rotation backups and
          the launcher's debug log). Remove the whole directory, plus the
          pre-consolidation files that older versions left in the home root. }
        DelTree(QimchiHome + '\logs', True, True, True);
        DeleteFile(QimchiHome + '\qimchi_debug.log');
        DeleteFile(QimchiHome + '\qimchi.log');
      end;
    end;
  end;
end;
