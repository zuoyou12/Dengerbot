; electron-builder includes this file in the NSIS installer. Its `protocols` setting registers the
; dengerbot:// scheme only on macOS and Linux, so the installer writes the Windows key itself.

; electron-builder's assisted installer adds a `${APP_FILENAME}` sub-folder to a chosen folder that
; does not contain the product name, and it does so after the custom page below. That rule cannot
; keep a default folder named `dengerbotapp`, and it also adds a sub-folder to an existing
; installation in a folder such as `...\Dengerbot`, which would move every update there. Remove the
; built-in page and declare it again in `customPageAfterChangeDir`, where the recorded installation
; folder is checked before the sub-folder rule.
!undef allowToChangeInstallationDirectory
!include StrContains.nsh

; The installer keeps one installation for this user, so the first default folder is written to
; HKCU. The write happens only when neither registry view records an installation: an update must
; keep the folder the user already has, and a machine-wide installation keeps its own folder. D:
; receives the default. A computer without that drive gets the standard per-user folder from
; electron-builder, because the installer must not propose a folder on a missing drive.
!macro preInit
  SetRegView 64
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $1 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  SetRegView 32
  ReadRegStr $2 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $3 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
  ${AndIf} $1 == ""
  ${AndIf} $2 == ""
  ${AndIf} $3 == ""
    ${If} ${FileExists} "D:\*.*"
      SetRegView 64
      WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "D:\DengerBot\dengerbotapp"
      SetRegView 32
      WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "D:\DengerBot\dengerbotapp"
    ${EndIf}
  ${EndIf}
  ; `check64BitAndSetRegView` runs after this macro and selects the view for the rest of the
  ; installer. Leave the 32-bit view, which is also correct on a 32-bit Windows.
  SetRegView 32
!macroend

; A chosen folder such as D:\OpenBot inherits Modify rights for "Authenticated Users" from the drive
; root, so another account could replace OpenBot.exe. Give access only to this user, SYSTEM and
; Administrators, as %LOCALAPPDATA% does, and reset the files to inherit it. This runs before the
; files are copied at each install and update, because an update deletes the folder. The installer
; makes the folder, so this user owns it and icacls can change it. On a drive with no ACLs, such as
; exFAT, icacls fails and the install continues.
!macro openBotRestrictInstallDirectory
  Push $0
  Push $1
  ReadEnvStr $0 USERDOMAIN
  ReadEnvStr $1 USERNAME
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "$0\$1:(OI)(CI)F" /Q'
  Pop $0
  ${if} $0 == 0
    nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR\*" /reset /T /C /Q'
    Pop $0
  ${endIf}
  Pop $1
  Pop $0
!macroend

; This replaces the check after the earlier version is removed, so it keeps that check first.
!macro customUnInstallCheck
  ${if} ${Errors}
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
  ${elseIf} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${endIf}
  CreateDirectory "$INSTDIR"
  !insertmacro openBotRestrictInstallDirectory
!macroend

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\dengerbot" "" "URL:Dengerbot invitations"
  WriteRegStr SHCTX "Software\Classes\dengerbot" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\dengerbot\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHCTX "Software\Classes\dengerbot\shell\open\command" "" '"$appExe" "%1"'
!macroend

; An update runs the old uninstaller first. Keep the key then, so that links work during the update.
; Delete the key only when it still opens this copy. Another copy can own it now.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $0
    ReadRegStr $0 SHCTX "Software\Classes\dengerbot\shell\open\command" ""
    ${if} $0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
      DeleteRegKey SHCTX "Software\Classes\dengerbot"
    ${endIf}
    Pop $0
  ${endIf}
!macroend

; Dengerbot installs for the current user only. An update finds only one installation. This skips
; the "All users" page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; The uninstaller and each update delete the whole installation folder. A chosen folder such as
; %USERPROFILE%\DengerBot (the agent data root) must not be deleted, so a folder that does not hold
; the product name receives a `Dengerbot` sub-folder first. Another account can also make a folder
; first and keep its rights on it. Use only a folder that does not exist or that holds this user's
; earlier installation. The page shows nothing; Abort skips it.
;
; The directory page is declared here because the built-in one is removed above. The recorded
; installation folder comes first: an update and a fresh install whose default was written by
; `preInit` both arrive with `$INSTDIR` equal to it, and the sub-folder rule must not change that
; folder. The `skipPageIfUpdated` macro keeps the page out of a silent update.
!macro customPageAfterChangeDir
  !include FileFunc.nsh

  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_DIRECTORY

  ; electron-builder reads this flag later, when it decides whether an old uninstaller keeps the
  ; shortcuts. Only the directory page above needs the flag removed, so restore it for that check.
  !define allowToChangeInstallationDirectory

  Page custom openBotSafeInstallDirectory

  Function openBotSafeInstallDirectory
    Push $0
    Push $1
    ReadRegStr $1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    StrCpy $0 $INSTDIR 1 -1
    ${if} $0 == "\"
      StrCpy $INSTDIR $INSTDIR -1
    ${endIf}
    StrCpy $0 $1 1 -1
    ${if} $0 == "\"
      StrCpy $1 $1 -1
    ${endIf}
    ${if} $INSTDIR != $1
      ${StrContains} $0 "${APP_FILENAME}" $INSTDIR
      ${if} $0 == ""
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      ${endIf}
      ${do}
        ${if} $INSTDIR == $1
          ${exitDo}
        ${endIf}
        ${DirState} "$INSTDIR" $0
        ${if} $0 == -1
          ${exitDo}
        ${endIf}
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      ${loop}
    ${endIf}
    Pop $1
    Pop $0
    Abort
  FunctionEnd
!macroend
