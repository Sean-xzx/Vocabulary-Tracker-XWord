; XWord 安装程序的 NSIS include 脚本（electron-builder nsis.include）
; 安装方式固定为“当前用户”：不显示“仅为我 / 为所有用户”那一页，也不需要管理员权限。
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; 构建时确认 electron-builder 模板能找到上面的宏（模板里写的是 customInstallmode）
!ifmacrodef customInstallmode
  !echo "XWORD-CHECK: customInstallMode defined, install mode forced to current user"
!else
  !error "XWORD-CHECK: customInstallMode macro not visible to template"
!endif
