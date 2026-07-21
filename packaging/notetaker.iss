; Instalador de Note Taker para Windows (Inno Setup).
; Se compila en GitHub Actions: ISCC /DAppVersion=<tag> packaging\notetaker.iss
; Instala por usuario (sin permisos de administrador / sin UAC).

#ifndef AppVersion
  #define AppVersion "1.1"
#endif

[Setup]
AppName=Note Taker
AppVersion={#AppVersion}
AppPublisher=Philippe Prince Tritto
DefaultDirName={localappdata}\Programs\Note Taker
DefaultGroupName=Note Taker
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=Output
OutputBaseFilename=NoteTaker-Setup
SetupIconFile=..\logo\icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "..\dist\Note Taker\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Note Taker"; Filename: "{app}\Note Taker.exe"
Name: "{userdesktop}\Note Taker"; Filename: "{app}\Note Taker.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; Flags: unchecked

[Run]
Filename: "{app}\Note Taker.exe"; Description: "Abrir Note Taker"; Flags: nowait postinstall skipifsilent
