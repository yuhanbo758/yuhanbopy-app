!ifndef BUILD_UNINSTALLER
  Var pluginBackupDir
  Var configBackupDir
!endif

!macro customInit
  ; 备份放在旧安装目录旁，既避开旧版卸载范围，也能在恢复失败时继续保留。
  StrCpy $pluginBackupDir "$INSTDIR.plugin-update-backup"
  StrCpy $configBackupDir "$INSTDIR.plugin-config-update-backup"
  IfFileExists "$INSTDIR\plugins\*.*" preserve_current_plugins 0
  IfFileExists "$INSTDIR\resources\app\software\*.*" preserve_legacy_plugins preserve_config_start

preserve_current_plugins:
  StrCpy $R8 "$INSTDIR\plugins"
  Goto preserve_plugins

preserve_legacy_plugins:
  StrCpy $R8 "$INSTDIR\resources\app\software"

preserve_plugins:
  CreateDirectory "$pluginBackupDir"
  ClearErrors
  CopyFiles /SILENT "$R8\*.*" "$pluginBackupDir"
  IfErrors preserve_plugins_failed preserve_config_start

preserve_plugins_failed:
  MessageBox MB_ICONSTOP "无法完整备份本地插件，安装已停止。现有备份保留在：$pluginBackupDir"
  Abort

preserve_config_start:
  IfFileExists "$INSTDIR\plugin-configs\*.*" 0 preserve_config_done
  CreateDirectory "$configBackupDir"
  ClearErrors
  CopyFiles /SILENT "$INSTDIR\plugin-configs\*.*" "$configBackupDir"
  IfErrors preserve_config_failed preserve_config_done

preserve_config_failed:
  MessageBox MB_ICONSTOP "无法完整备份插件用户配置，安装已停止。现有备份保留在：$configBackupDir"
  Abort

preserve_config_done:
!macroend

!macro customInstall
  ; 旧程序卸载和新程序文件写入完成后，将本地插件放回用户选择的安装目录。
  IfFileExists "$pluginBackupDir\*.*" 0 restore_config_start
  CreateDirectory "$INSTDIR\plugins"
  ClearErrors
  CopyFiles /SILENT "$pluginBackupDir\*.*" "$INSTDIR\plugins"
  IfErrors restore_plugins_failed 0
  RMDir /r "$pluginBackupDir"
  Goto restore_config_start

restore_plugins_failed:
  MessageBox MB_ICONSTOP "无法完整恢复本地插件，安装已停止。备份仍保留在：$pluginBackupDir"
  Abort

restore_config_start:
  IfFileExists "$configBackupDir\*.*" 0 restore_config_end
  CreateDirectory "$INSTDIR\plugin-configs"
  ClearErrors
  CopyFiles /SILENT "$configBackupDir\*.*" "$INSTDIR\plugin-configs"
  IfErrors restore_config_failed 0
  RMDir /r "$configBackupDir"
  Goto restore_config_end

restore_config_failed:
  MessageBox MB_ICONSTOP "无法完整恢复插件用户配置，安装已停止。备份仍保留在：$configBackupDir"
  Abort

restore_config_end:
!macroend
