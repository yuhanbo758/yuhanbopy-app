!ifndef BUILD_UNINSTALLER
  Var pluginBackupDir
!endif

!macro customInit
  ; 备份放在旧安装目录旁，既避开旧版卸载范围，也能在恢复失败时继续保留。
  StrCpy $pluginBackupDir "$INSTDIR.plugin-update-backup"
  IfFileExists "$INSTDIR\plugins\*.*" preserve_current_plugins 0
  IfFileExists "$INSTDIR\resources\app\software\*.*" preserve_legacy_plugins preserve_plugins_done

preserve_current_plugins:
  StrCpy $R8 "$INSTDIR\plugins"
  Goto preserve_plugins

preserve_legacy_plugins:
  StrCpy $R8 "$INSTDIR\resources\app\software"

preserve_plugins:
  CreateDirectory "$pluginBackupDir"
  ClearErrors
  CopyFiles /SILENT "$R8\*.*" "$pluginBackupDir"
  IfErrors preserve_plugins_failed preserve_plugins_done

preserve_plugins_failed:
  MessageBox MB_ICONSTOP "无法完整备份本地插件，安装已停止。现有备份保留在：$pluginBackupDir"
  Abort

preserve_plugins_done:
!macroend

!macro customInstall
  ; 旧程序卸载和新程序文件写入完成后，将本地插件放回用户选择的安装目录。
  IfFileExists "$pluginBackupDir\*.*" 0 restore_plugins_end
  CreateDirectory "$INSTDIR\plugins"
  ClearErrors
  CopyFiles /SILENT "$pluginBackupDir\*.*" "$INSTDIR\plugins"
  IfErrors restore_plugins_failed 0
  RMDir /r "$pluginBackupDir"
  Goto restore_plugins_end

restore_plugins_failed:
  MessageBox MB_ICONSTOP "无法完整恢复本地插件，安装已停止。备份仍保留在：$pluginBackupDir"
  Abort

restore_plugins_end:
!macroend
