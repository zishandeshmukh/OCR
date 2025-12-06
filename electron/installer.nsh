!macro customInstall
  ; Create registry entries for file associations
  WriteRegStr HKCR ".vap" "" "VoterAlign.Project"
  WriteRegStr HKCR "VoterAlign.Project" "" "VoterAlign Pro Project"
  WriteRegStr HKCR "VoterAlign.Project\DefaultIcon" "" "$INSTDIR\VoterAlign Pro.exe,0"
  WriteRegStr HKCR "VoterAlign.Project\shell\open\command" "" '"$INSTDIR\VoterAlign Pro.exe" "%1"'
!macroend

!macro customUnInstall
  ; Remove registry entries
  DeleteRegKey HKCR ".vap"
  DeleteRegKey HKCR "VoterAlign.Project"
!macroend
