// listwfc.js — Print all workflow commands grouped by section.
// Usage: listwfc [filter]   e.g.  listwfc docker  or  listwfc payor

'use strict';

var filter = (process.argv[2] || '').toLowerCase();

// ── ANSI colour helpers ───────────────────────────────────────
var C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  navy:    '\x1b[34m',
  teal:    '\x1b[36m',
  green:   '\x1b[32m',
  purple:  '\x1b[35m',
  yellow:  '\x1b[33m',
  white:   '\x1b[97m',
  grey:    '\x1b[90m',
  bgNavy:  '\x1b[44m',
  bgTeal:  '\x1b[46m',
  bgPurple:'\x1b[45m',
};

function bold(s)    { return C.bold  + s + C.reset; }
function dim(s)     { return C.dim   + s + C.reset; }
function navy(s)    { return C.navy  + s + C.reset; }
function teal(s)    { return C.teal  + s + C.reset; }
function green(s)   { return C.green + s + C.reset; }
function purple(s)  { return C.purple+ s + C.reset; }
function yellow(s)  { return C.yellow+ s + C.reset; }
function grey(s)    { return C.grey  + s + C.reset; }
function white(s)   { return C.white + s + C.reset; }

// ── Data ──────────────────────────────────────────────────────
// Each section: { title, tags, color, rows: [[cmd, alias, description], ...] }
var SECTIONS = [
  {
    title: 'Local_Build_And_Deployment  —  Payor',
    tags:  ['payor', 'build', 'deploy', 'regression', 'setuplbdtool', 'getpayorrb', 'setpbranch', 'getpbranch', 'branch'],
    color: 'navy',
    docs:  'DeployPayorModules.docx, RefreshPayorReadme.docx, RegressionReadme.docx',
    cmd_w: 34,
    alias_w: 13,
    groups: [
      {
        name: 'Setup',
        rows: [
          ['setuplocalbuildanddeploymenttool', 'setuplbdtool', 'Set up the Local Build and Deployment Tool: verify Node.js, create config.xlsx, and create CMD wrappers for all Payor build/deploy/regression commands.'],
        ],
      },
      {
        name: 'Payor Branch',
        rows: [
          ['getpayorreleasebranches', 'getpayorrb',  'List all Payor release branches from the local clone. Flags: -v <prefix> filter by version prefix (e.g. -v 26.1), --json'],
          ['setpayorbranch',          'setpbranch',   'Set the active Payor branch: writes ~/.default-branch, sets SRCDIR/ANT_HOME/JAVA_HOME/WL_DOMAIN and related user env vars. Usage: setpayorbranch <version>  e.g. setpayorbranch 26.1.1.1'],
          ['getcurrentpayorbranch',  'getpbranch',   'Show the currently active Payor branch, release version, environment type (Tomcat/WebLogic), and clone path status.'],
        ],
      },
      {
        name: 'Module Management',
        rows: [
          ['listpayormodules',   'lpm',  'List all Payor Maven modules — shows ready vs needs-build'],
          ['buildpayormodule',   'bpm',  'Build a module (+ dependents). Auto-detect stale via git when no name given'],
          ['deploypayormodule',  'dpm',  'Stop payor server, copy built jar into container, restart'],
        ],
      },
      {
        name: 'Full Refresh',
        rows: [
          ['refresh-payor', '', 'Full build + deploy cycle. Flags: -os -sdu -st and more'],
        ],
      },
      {
        name: 'Regression Testing',
        rows: [
          ['localpayorregression', 'lprt', 'Run Payor tests locally. Jenkins URL -> report; class/method -> live Maven output'],
        ],
      },
    ],
  },
  {
    title: 'Local_Build_And_Deployment  —  Classic',
    tags:  ['classic', 'c3', 'setc3branch', 'toc3src', 'branch', 'c3srcdir', 'refresh'],
    color: 'navy',
    docs:  'Local_Build_And_Deployment/Applications/Classic/',
    cmd_w: 34,
    alias_w: 13,
    groups: [
      {
        name: 'Classic Branch',
        rows: [
          ['setc3branch', '', 'Set the active Classic branch: writes ~/.default-c3-branch, sets C3SRCDIR user env var. Usage: setc3branch <version>  e.g. setc3branch master'],
        ],
      },
      {
        name: 'Navigation',
        rows: [
          ['toc3src', '', 'Navigate to the active Classic source directory ($env:C3SRCDIR). Run setc3branch first.'],
        ],
      },
      {
        name: 'Full Refresh',
        rows: [
          ['refresh-classic', '', 'Full build + deploy cycle for Classic. Flags: -ncs -ncb -st -nbld -nd -rf <mod>'],
        ],
      },
    ],
  },
  {
    title: 'Local_Build_And_Deployment  —  Connector',
    tags:  ['connector', 'c4', 'setc4branch', 'toc4src', 'branch', 'c4srcdir', 'refresh'],
    color: 'navy',
    docs:  'Local_Build_And_Deployment/Applications/Connector/',
    cmd_w: 34,
    alias_w: 13,
    groups: [
      {
        name: 'Connector Branch',
        rows: [
          ['setc4branch', '', 'Set the active Connector branch: writes ~/.default-c4-branch, sets C4SRCDIR user env var. Usage: setc4branch <version>  e.g. setc4branch master'],
        ],
      },
      {
        name: 'Navigation',
        rows: [
          ['toc4src', '', 'Navigate to the active Connector source directory ($env:C4SRCDIR). Run setc4branch first.'],
        ],
      },
      {
        name: 'Full Refresh',
        rows: [
          ['refresh-connector', '', 'Full build + deploy cycle for Connector. Flags: -ncs -ncb -st -nbld -nd -rf <mod>'],
        ],
      },
    ],
  },
  {
    title: 'Local_Build_And_Deployment  —  Enrollment',
    tags:  ['enrollment', 'c4e', 'setc4ebranch', 'toc4esrc', 'branch', 'c4esrcdir', 'refresh'],
    color: 'navy',
    docs:  'Local_Build_And_Deployment/Applications/Enrollment/',
    cmd_w: 34,
    alias_w: 13,
    groups: [
      {
        name: 'Enrollment Branch',
        rows: [
          ['setc4ebranch', '', 'Set the active Enrollment branch: writes ~/.default-c4e-branch, sets C4ESRCDIR user env var. Usage: setc4ebranch <version>  e.g. setc4ebranch master'],
        ],
      },
      {
        name: 'Navigation',
        rows: [
          ['toc4esrc', '', 'Navigate to the active Enrollment source directory ($env:C4ESRCDIR). Run setc4ebranch first.'],
        ],
      },
      {
        name: 'Full Refresh',
        rows: [
          ['refresh-enrollment', '', 'Full build + deploy cycle for Enrollment. Flags: -ncs -ncb -st -nbld -nd -rf <mod>'],
        ],
      },
    ],
  },
  {
    title: 'Local_Build_And_Deployment  —  PIK',
    tags:  ['pik', 'portal', 'integration', 'kit', 'lsetpikbranch', 'branch', 'piksrcdir', 'pikenv', 'topiksrc', 'refresh'],
    color: 'navy',
    docs:  'Local_Build_And_Deployment/Applications/PIK/',
    cmd_w: 34,
    alias_w: 13,
    groups: [
      {
        name: 'PIK Branch',
        rows: [
          ['lsetpikbranch', '', 'Set the active PIK (Portal Integration Kit) branch: writes ~/.default-pik-branch, sets PIKSRCDIR/PIKENV user env vars, creates environments dir. Usage: lsetpikbranch <version>  e.g. lsetpikbranch 26.1.1.1  or  lsetpikbranch master'],
        ],
      },
      {
        name: 'Navigation',
        rows: [
          ['topiksrc', '', 'Navigate to the active PIK source directory ($env:PIKSRCDIR). Run lsetpikbranch first to set PIKSRCDIR. PowerShell alias defined in Healthedge.Powershell_functions.ps1.'],
        ],
      },
      {
        name: 'Full Refresh',
        rows: [
          ['refresh-pik', '', 'Full build + deploy cycle for PIK. Flags: -ncs -ncb -st -nbld -nd -rf <mod>'],
        ],
      },
    ],
  },
  {
    title: 'Local_Docker_Setup',
    tags:  ['docker', 'server', 'container', 'state', 'setupldtool', 'setuplocaldockersetuptool'],
    color: 'teal',
    docs:  'DockerReadme.docx',
    cmd_w: 26,
    groups: [
      {
        name: 'Setup',
        rows: [
          ['setuplocaldockersetuptool', 'setupldtool', 'Set up the Local Docker Setup Tool: verify PowerShell and Docker, and create CMD wrappers for all docker commands.'],
        ],
      },
      {
        name: 'Docker Desktop',
        rows: [
          ['startdocker', '', 'Restart vmcompute + launch Docker Desktop + wait until daemon ready'],
        ],
      },
      {
        name: 'Container Lifecycle',
        rows: [
          ['setupservers',   '', 'docker compose up  — create + start full stack'],
          ['startservers',   '', 'docker compose start  — start stopped containers (auto-setup if needed)'],
          ['stopservers',    '', 'docker compose stop  — stop running containers'],
          ['deleteservers',  '', 'docker compose stop + down  — stop + remove containers'],
          ['restartservers', '', 'docker compose stop + down + up -d  — full cycle'],
        ],
      },
      {
        name: 'State Snapshot & Restore',
        rows: [
          ['savedockerstate',  'saveds',  'Commit container filesystems + volumes to docker_state/.  Usage: saveds <name>'],
          ['loaddockerstate',  'loadds',  'Restore a saved snapshot (warns if containers running).  Usage: loadds <name>'],
          ['removedockerstate','removeds', 'Delete a saved state folder from docker_state/.  Usage: removeds <name>'],
          ['listdockerstate',  'listds',  'List all saved states with name, date, size, containers'],
        ],
      },
    ],
  },
  {
    title: 'GP_Build Tool',
    tags:  ['gp', 'build', 'jenkins', 'gprun', 'schedule', 'pipeline'],
    color: 'teal',
    docs:  'GP_Build/ReadMe.docx',
    groups: [
      {
        name: '',
        rows: [
          ['setupgptool', '', 'Set up the GP Build Tool skeleton (config.xlsx, projects.xlsx, gp_params.xlsx, tickets/).  Run  setupgptool -fetchparams  after filling in config.xlsx to fetch Jenkins build parameters and test groups.  Run  setupgptool --help  for full workflow.'],
          ['gpstatus', '', 'Show GP Build project run history from projects.xlsx. Lists latest 10 projects (newest first) with project ID, ticket, branch, dest, build status and PR status. Navigate with  n  (next 10),  p  (previous 10),  q  (quit).  gpstatus -rf  refreshes Jenkins + GitHub PR status for active projects (skips Passed/Failed/Cancelled).  gpstatus -s <status>  filters by status (e.g. running, passed, failed).'],
          ['gpdelete', '', 'Delete a project entry from projects.xlsx by project ID. Also removes the per-ticket config file.  gpdelete -pid <project_id>'],
          ['gprun', '', 'Trigger a GP Jenkins build for a ticket. Resolves PR from Atlassian (ticket ID auto-extracted from branch name when -fb is used). Triggers Jenkins pipeline, captures job ID, and records status in projects.xlsx.  gprun -t PAYOR-208267 -db main  or  gprun -fb feature-PAYOR-208267-fix -db main.  -db is required; -am optional (default: no). If multiple PRs exist for the same branch+dest, prompts for selection.'],
        ],
      },
    ],
  },
  {
    title: 'Local Clone Tool',
    tags:  ['clone', 'jira', 'branch', 'lclone', 'ticket', 'lclonestatus', 'setuplclonetool'],
    color: 'yellow',
    docs:  'Local_Clone_Tool/ReadMe.docx',
    groups: [
      {
        name: '',
        rows: [
          ['setuplclonetool', '', 'Set up the Local Clone Tool: create config.xlsx, project_types/project_types.xlsx, project_config/<type>_config.xlsx, projects/<type>_projects.xlsx (two-sheet format). Migrates old CloneLog format automatically.'],
          ['lclone',          '', 'Create local fix branches from a JIRA clone ticket. Resolves release branch from fix version, sets up master + release branch, finds all merged PRs on the original ticket, cherry-picks each, prompts push + PR creation.  lclone -ticket PAYOR-208264'],
          ['lclonestatus',    '', 'List clone projects with status (In Progress / Complete). Newest 10 first.  -p <n> for pages, -r for oldest-first.  lclonestatus -pid <id> shows detail and lets you interactively update individual PR statuses.'],
          ['lclonedelete',    '', 'Delete a clone project entry by project ID. Removes per-project xlsx and clears rows from the shared index.  lclonedelete -pid <project_id>'],
        ],
      },
    ],
  },
  {
    title: 'Jenkins IT Regression Tool  —  Payor',
    tags:  ['jenkins', 'regression', 'jreg', 'payor', 'sustaining', 'mr', 'jregstatus'],
    color: 'green',
    docs:  'Jenkins_IT_Regression/',
    groups: [
      {
        name: '',
        rows: [
          ['setupjenkinsregtool', '',      'Set up the Jenkins IT Regression Tool: create reg_job_config.xlsx, projects.xlsx, git_config.xlsx, jenkins_params/ skeleton, and projects/ folder. Run with -fetchparams to fetch build parameters from Jenkins.'],
          ['jenkinsregression',   'jreg',  'Trigger all 6 MR Payor regression Jenkins jobs. -payor <release_version> required (e.g. 26.1.1.1). Fetches pom.xml from GitHub to resolve PAYOR_VERSION_PREFIX, BLUECARD_CONFIG_VERSION_PREFIX, DATAUNIVERSE_VERSION_PREFIX. Saves run details to projects/<run_id>_payor_<version>.xlsx.'],
          ['jregstatus',          '',      'Show recent projects from projects.xlsx. jregstatus -pid <id> fetches live Jenkins status for that specific project run (resolves queue items, polls build URLs, writes back to per-run xlsx).'],
          ['jregdelete',          '',      'Delete a project entry from projects.xlsx and its per-run xlsx file.  jregdelete -pid <project_id>'],
        ],
      },
    ],
  },
  {
    title: 'Jenkins IT BaseLine Tool  —  Payor',
    tags:  ['jenkins', 'baseline', 'jbaseline', 'payor', 'certification'],
    color: 'green',
    docs:  'Jenkins_BaseLine/ReadMe.docx',
    groups: [
      {
        name: '',
        rows: [
          ['setupjbaselinetool', '',  'Set up the Jenkins IT BaseLine Tool: create baseline_job_config.xlsx, projects.xlsx, jenkins_params/, git_config.xlsx. Run with -fetchparams to fetch build parameters from Jenkins regression jobs.'],
          ['jbaseline',         '',  'Run the full payor baseline workflow. Phase 1: enable + trigger payor-core-commit, wait for success. Phase 2: trigger payor-utils-certification + all 6 regression jobs. -payor <version> required.  --phase2-only skips Phase 1.'],
          ['jbaselinestatus',   '',  'Show run history from projects.xlsx grouped by phase (Pre-Build / Certification / Regression). Supports pagination (-p <n>), reverse order (-r), and live Jenkins status per run (-pid <id>).'],
          ['jbaselinedelete',   '',  'Delete a run entry from projects.xlsx and its per-run xlsx file.  jbaselinedelete -pid <project_id>'],
        ],
      },
    ],
  },
  {
    title: 'Remote_Setup',
    tags:  ['remote', 'vm', 'server', 'jenkins', 'setup', 'remotevmsetup', 'rvmsetup', 'rvmsetupstatus', 'rvmconfig', 'remotevmstatus', 'rvmstatus', 'vmsearch'],
    color: 'teal',
    docs:  'Remote_Setup/',
    cmd_w: 24,
    alias_w: 13,
    groups: [
      {
        name: 'Setup',
        rows: [
          ['setupremotevmsetuptool', '', 'Set up the Remote VM Setup Tool: create config.xlsx (Jenkins URL), katalon_params.xlsx (build parameters), vms.xlsx (VM list), configured_servers/ folder. Run with -fetchparams to fetch Jenkins job parameter definitions (keys, choices, defaults).'],
        ],
      },
      {
        name: 'VM Setup',
        rows: [
          ['remotevmsetup',   'rvmsetup',  'Select a VM and trigger remote server setup via Jenkins. Auto-fills VM IP, password, and GH_PASS. Prompts for remaining parameters with choices from katalon_params.xlsx. Creates a project entry in projects.xlsx (pid) and saves full parameter run history to configured_servers/server_<ip>_conf.xlsx.'],
          ['rvmsetupstatus',  '',          'Show all projects from projects.xlsx with cached ETA for running setups. -refresh fetches live Jenkins status for all Triggered/Running/Queued projects and updates ETA. -pid <id> shows full detail for one project with live ETA. -ip <ip> shows full run history for a specific server.'],
          ['remotevmconfig',  'rvmconfig', 'Show latest parameter configuration for each configured server from configured_servers/. Lists all servers with last-run summary (no args). rvmconfig -ip <ip> shows the full parameter set used in the most recent run for that server.'],
          ['rvmdelete',       '',          'Delete a project entry from projects.xlsx by project ID. Also removes the matching run record from the server config file in configured_servers/. Deletes the config file entirely if no other runs remain.  rvmdelete -pid <project_id>'],
        ],
      },
      {
        name: 'VM Status',
        rows: [
          ['remotevmstatus', 'rvmstatus', 'List all VMs from vms.xlsx (no args). rvmstatus -vmid <vm_name> SSHes to the VM as weblogic and runs the branch command, showing branch, source dirs, Java home, domain, DB platform and other environment details.'],
          ['vmsearch',       '',          'Search VMs by filter criteria. -prb <branch> (--payor-release-branch) SSHes to all VMs concurrently and returns VMs whose Current branch matches. Usage: vmsearch -prb master  or  vmsearch -prb 26.2.2.0.1'],
        ],
      },
    ],
  },
  {
    title: 'Remote Regression  —  Payor',
    tags:  ['payor', 'regression', 'remote', 'baseline', 'rprt', 'rpb', 'gpr', 'remoteregression', 'remotereg'],
    color: 'green',
    cmd_w: 26,
    alias_w: 24,
    docs:  'WORKFLOW.md  (Remote_Regression_Jenkins_IT_Failure/Payor/), ReadMe.docx',
    groups: [
      {
        name: 'Setup',
        rows: [
          ['setupremoteregressiontool', 'setupremoteregtool', 'Set up the Remote Regression Test tool: create config.xlsx (Baseline/RemoteServer/GPServer tabs), projects.xlsx, and CMD wrappers. Run once before first use.'],
        ],
      },
      {
        name: 'Project Management',
        rows: [
          ['remoteregression', 'remotereg', 'Guided orchestrator: creates a project entry, populates Baseline Jenkins URLs in config.xlsx, then runs rpb -> rprt -> gpr in sequence. Usage: remoteregression -payor 26.1.1.1'],
          ['remoteregdelete',  '',                     'Delete a Remote Regression Test project entry from projects.xlsx.  remoteregdelete -pid <project_id>'],
        ],
      },
      {
        name: 'Individual Steps',
        rows: [
          ['remotepayorregression',       'rprt', 'Full 4-step Payor regression report: fetch Jenkins IT failures -> run on remote server -> update Excel -> generate email draft. See WORKFLOW.md in Remote_Regression_Jenkins_IT_Failure/Payor/'],
          ['remotepopulatepayorbaseline', 'rpb',  'Fetch IT failures from baseline Jenkins builds and write baseline/Baseline_Jenkins_Payor_IT_Status_<baselineVersion>.xlsx. Set Local Failure=Yes for all entries; mark Known Failure=Yes manually for pre-classified issues. Configure URLs in config.xlsx -> Baseline tab.'],
          ['gpregressionresult',          'gpr',  'Fetch GP Jenkins test results and mark GP Failure = Yes in the output Excel. Reflects in Summary; treated as Local Failure in email draft. Configure GP Jenkins build URL in config.xlsx -> GPServer tab. Optional: --url <url> to override for one run. Run  gpr --help  for all options.'],
        ],
      },
    ],
  },
  {
    title: 'Payor Utils Certification',
    tags:  ['payor', 'utils', 'certification', 'jenkins', 'puc', 'payorutilscertification'],
    color: 'green',
    docs:  'Jenkins_Payor_Utils_Certification/',
    cmd_w: 34,
    alias_w: 13,
    groups: [
      {
        name: '',
        rows: [
          ['setuppayorutilscertificationtool', 'setuppuctool', 'Set up the Payor Utils Certification Tool: create puc_config.xlsx (job URL with {version} template), projects.xlsx, and CMD wrappers.'],
          ['payorutilscertification', 'puc', 'Trigger the payor-utils-certification Jenkins job for a given release version. Usage: puc -payor 26.1.1.1. Waits for result and records run in projects.xlsx.'],
          ['pucstatus', '', 'List Payor Utils Certification projects (latest 10, newest first). Supports pagination (-p <n>) and reverse (-r). pucstatus -pid <id> shows live Jenkins status with clickable build URL.'],
          ['pucdelete', '', 'Delete a Payor Utils Certification project entry from projects.xlsx.  pucdelete -pid <project_id>'],
        ],
      },
    ],
  },
  {
    title: 'Melissa Data Update License',
    tags:  ['melissa', 'data', 'license', 'vm', 'payor', 'classic', 'updatemdl', 'updatemelissadatalicense'],
    color: 'yellow',
    docs:  'Remote_Melissa_Data_Update_License/',
    cmd_w: 34,
    alias_w: 13,
    groups: [
      {
        name: '',
        rows: [
          ['setupupdatemelissadatalicensetool', 'setupmdltool', 'Set up the Melissa Data License Update Tool: create projects.xlsx and CMD wrappers.'],
          ['updatemelissadatalicense', 'updatemdl', 'SSH into a selected VM and update Melissa Data License for Payor and Classic repos. Verifies hrp.eng.utilities is present, pulls latest scripts, runs update_melissadata.sh and reports changes. Records run in projects.xlsx with pid, status, and changed files.'],
          ['mdlstatus',          '',         'List Melissa Data License update projects (latest 10, newest first). Supports pagination (n/p/q). mdlstatus -pid <id> shows full detail for one project including changed files.'],
          ['mdldelete',          '',         'Delete a Melissa Data License update project entry from projects.xlsx.  mdldelete -pid <project_id>'],
        ],
      },
    ],
  },
  {
    title: 'Clone Workflow',
    tags:  ['clone', 'workflow', 'clonewf', 'cloneworkflow', 'baseline', 'regression', 'melissa', 'jreg', 'rpb'],
    color: 'purple',
    docs:  'Clone_WorkFlow/',
    alias_w: 17,
    groups: [
      {
        name: 'Setup',
        rows: [
          ['setupcloneworkflowtool', 'setupclonewftool', 'Set up the Clone Workflow Tool: create project_status/ folder and CMD wrappers for clonewf/clonewfstatus/clonewfdelete.'],
        ],
      },
      {
        name: 'Workflow',
        rows: [
          ['cloneworkflow', 'clonewf', 'Start a guided clone/release workflow. Shows all 9 stages upfront, then asks for ticket and opts in/out of: 1. Baseline Creation, 2. Remote VM Setup, 3a. Melissa Data License Update, 3b. GP - Melissa Data PR (Payor), 3c. GP - Melissa Data PR (Classic), 4a. Clone, 4b. GP – Clone PR, 5. Jenkins Regression, 6. Remote Regression Baseline. Executes each stage and records tool project IDs.'],
          ['clonewfstatus', '', 'List clone workflow projects. clonewfstatus -pid <id> shows all stages with tool PIDs and status. clonewfstatus -pid <id> -stage <n> shows detail for one stage. -p <n> for pagination, -r for oldest-first.'],
          ['clonewfdelete', '', 'Delete a clone workflow project from projects.xlsx and remove its stages status file.  clonewfdelete -pid <project_id>'],
        ],
      },
    ],
  },
  {
    title: 'Internal Developer Platform',
    tags:  ['idp', 'ui', 'react', 'startidp', 'stopidp', 'setupidptool', 'setupidp'],
    color: 'purple',
    docs:  'Internal_Developer_Tool/',
    groups: [
      {
        name: 'Setup',
        rows: [
          ['setupidptool', 'setupidp', 'Set up the Internal Developer Platform: install Flask, run npm install + npm build for the React UI, and create startidp/stopidp CMD wrappers.'],
        ],
      },
      {
        name: 'Server',
        rows: [
          ['startidp', '', 'Start the Internal Developer Platform (React UI) as a background server on port 5556 and open it in the browser. Run  setupidptool  first to build the UI.'],
          ['stopidp',  '', 'Stop the background Internal Developer Platform server.'],
        ],
      },
    ],
  },
  {
    title: 'AI Agent',
    tags:  ['ai', 'agent', 'lai', 'claude', 'aws', 'sso', 'login'],
    color: 'purple',
    docs:  'Tools/AIAgent/AI_Agent.xlsx  |  Tools/Sonar_Report_Generator/',
    groups: [
      {
        name: '',
        rows: [
          ['lai', '', 'Launch AI Agent (PowerShell function): reads AI_Agent.xlsx for Workspace / Login command / Command, runs the login (e.g. aws sso login --profile claude), then on confirmation cds to Workspace and runs the configured command (e.g. claudep). Terminal stays in Workspace after launch.'],
        ],
      },
    ],
  },
  {
    title: 'Workflow Utilities',
    tags:  ['util', 'help', 'wfc', 'setupalltools'],
    color: 'purple',
    docs:  'WorkFlowCommands.docx',
    groups: [
      {
        name: '',
        rows: [
          ['setupalltools', '', 'Run the setup script for every tool in the workspace in sequence (LBD, Docker, Clone Tool, Remote Setup, IDP, and more).'],
          ['listwfc',       '', 'Print this command list.  listwfc <section>  to filter (docker, payor, regression ...)'],
        ],
      },
    ],
  },
];

// ── Layout ────────────────────────────────────────────────────
var CMD_W   = 22;   // command column width
var ALIAS_W = 9;    // alias column width
var DESC_W  = 58;   // description column width
var LINE_W  = CMD_W + ALIAS_W + DESC_W + 6;

function pad(s, w) {
  s = String(s);
  while (s.length < w) s = s + ' ';
  return s.slice(0, w);
}

function ruler(ch, w) {
  var s = '';
  for (var i = 0; i < w; i++) s += ch;
  return s;
}

function wrapDesc(text, maxW) {
  var words = text.split(' ');
  var lines = [];
  var cur   = '';
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (!cur) { cur = w; continue; }
    if (cur.length + 1 + w.length <= maxW) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function colorFn(color) {
  if (color === 'navy')   return navy;
  if (color === 'teal')   return teal;
  if (color === 'green')  return green;
  if (color === 'purple') return purple;
  if (color === 'yellow') return yellow;
  return white;
}

function printSection(sec) {
  var fn     = colorFn(sec.color);
  var cmdW   = sec.cmd_w   || CMD_W;
  var aliasW = sec.alias_w || ALIAS_W;
  var lineW  = cmdW + aliasW + DESC_W + 6;

  // Section header
  console.log('');
  console.log(fn(bold('  ' + sec.title)));
  console.log(fn(dim('  ' + ruler('-', lineW - 4))));
  if (sec.docs) {
    console.log(grey('  Docs: ' + sec.docs));
  }

  sec.groups.forEach(function(group) {
    if (group.name) {
      console.log('');
      console.log(bold('  ' + group.name));
      console.log(dim('  ' + ruler('.', cmdW + aliasW + 3)));
    }

    // Column headers (only for first group or named groups)
    if (group.name || sec.groups.length > 1) {
      var hdr = '  ' +
        dim(pad('COMMAND', cmdW)) + '  ' +
        dim(pad('ALIAS', aliasW)) + '  ' +
        dim('DESCRIPTION');
      console.log(hdr);
    }

    group.rows.forEach(function(r) {
      var cmd   = r[0];
      var alias = r[1];
      var desc  = r[2];

      var descLines = wrapDesc(desc, DESC_W);

      var cmdStr   = fn(bold(pad(cmd,   cmdW)));
      var aliasStr = alias
        ? purple(bold(pad(alias, aliasW)))
        : grey(pad('-', aliasW));

      // First line
      console.log('  ' + cmdStr + '  ' + aliasStr + '  ' + descLines[0]);

      // Continuation lines (wrapped description)
      var indent = '  ' + pad('', cmdW) + '  ' + pad('', aliasW) + '  ';
      for (var i = 1; i < descLines.length; i++) {
        console.log(indent + grey(descLines[i]));
      }
    });
  });
}

// ── Main ──────────────────────────────────────────────────────

console.log('');
console.log(bold(white('  ==  Workflow Commands  ==')));
console.log(grey('  All commands are CMD wrappers in ' + require('os').homedir() + '\\.local\\bin'));
if (filter) {
  console.log(yellow('  Filter: "' + filter + '"'));
}

var shown = 0;
SECTIONS.forEach(function(sec) {
  // Filter: match title or any tag
  if (filter) {
    var haystack = (sec.title + ' ' + sec.tags.join(' ')).toLowerCase();
    if (haystack.indexOf(filter) === -1) {
      // also check row commands/aliases
      var rowMatch = false;
      sec.groups.forEach(function(g) {
        g.rows.forEach(function(r) {
          if (r[0].toLowerCase().indexOf(filter) !== -1 ||
              (r[1] && r[1].toLowerCase().indexOf(filter) !== -1)) {
            rowMatch = true;
          }
        });
      });
      if (!rowMatch) return;
    }
  }
  shown++;
  printSection(sec);
});

if (shown === 0) {
  console.log(yellow('\n  No sections matched "' + filter + '". Try: docker  payor  regression  state'));
}

console.log('');
console.log(grey('  listwfc <section>  to filter  |  WorkFlowCommands.docx for full docs'));
console.log('');
