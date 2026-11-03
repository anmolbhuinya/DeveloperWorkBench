Developer Workbench - development workspace
===========================================
src\            Editable copy of the Workbench (server, UI source with node_modules, tools, workflows, installer sources).
                Change things here, not in ..\DeveloperWorkBench.
tools\node\     Portable Node.js + npm: builds the React UI offline (Internal_Developer_Tool\ui).
tools\deploy_src\  Source of Deploy.exe.
build.ps1       Builds everything not in git: portable Node, node_modules, the UI, Deploy.exe and CreateInstaller.exe.
Deploy.exe      Publishes src\ to the running installation (and CreateInstaller.exe to the DWB folder):
                  1. builds the UI (portable Node.js)
                  2. copies every changed CODE file to ..\DeveloperWorkBench  (the built UI is mirrored exactly)
                     secrets.xlsx, other .xlsx/.docx, idp_config.json and run history are never overwritten
                  3. restarts the Workbench if it was running
                Silent:  Deploy.exe /S [/NOBUILD] [/NORESTART]

Not part of src\: the bundled Python (use ..\DeveloperWorkBench\python\python.exe to run scripts), secrets, run history.
Build a new installer from the installation with ..\CreateInstaller.exe (run Deploy.exe first so the installation is current).

Project data lives outside the program, in ..\DWB_Projects\<type> (GP_Build, Jenkins_BaseLine, Jenkins_IT_Regression, Jenkins_Commit_Job, Payor_Utils_Certification, Clone_Workflow, Local_Clone, Remote_Setup, Remote_Regression, Melissa_Data, Sprint, AI_Analyzer).
Set DWB_PROJECTS to use another folder. ExportProjects.exe / ImportProjects.exe move that data between machines.
