import { lazy, Suspense, useState, useEffect, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import UserMenu from './components/UserMenu'
import ConfirmDialog from './components/ConfirmDialog'

const Welcome              = lazy(() => import('./pages/Welcome'))
const ComingSoon           = lazy(() => import('./pages/ComingSoon'))
const DockerPage           = lazy(() => import('./pages/DockerPage'))
const AccountPage          = lazy(() => import('./pages/AccountPage'))
const VMsPage              = lazy(() => import('./pages/VMsPage'))
const SecretsPage          = lazy(() => import('./pages/SecretsPage'))
const ProjectList          = lazy(() => import('./pages/ProjectList'))
const ProjectDetail        = lazy(() => import('./pages/ProjectDetail'))
const NewWorkflow          = lazy(() => import('./pages/NewWorkflow'))
const BaselinePage         = lazy(() => import('./pages/BaselinePage'))
const RemoteSetupPage      = lazy(() => import('./pages/RemoteSetupPage'))
const MelissaPage          = lazy(() => import('./pages/MelissaPage'))
const ClonePage            = lazy(() => import('./pages/ClonePage'))
const JregPage             = lazy(() => import('./pages/JregPage'))
const JcjPage              = lazy(() => import('./pages/JcjPage'))
const RpbPage              = lazy(() => import('./pages/RpbPage'))
const PucPage              = lazy(() => import('./pages/PucPage'))
const WorkflowProjectsPage = lazy(() => import('./pages/WorkflowProjectsPage'))
const ManageDevVMsPage     = lazy(() => import('./pages/ManageDevVMsPage'))
const DevVMsPage           = lazy(() => import('./pages/DevVMsPage'))
const VMAppsPage           = lazy(() => import('./pages/VMAppsPage'))
const GpRunPage            = lazy(() => import('./pages/GpRunPage'))
const SearchVMsPage        = lazy(() => import('./pages/SearchVMsPage'))
const LocalAppPage         = lazy(() => import('./pages/LocalAppPage'))
const PayorPage            = lazy(() => import('./pages/PayorPage'))
const ClassicPage          = lazy(() => import('./pages/ClassicPage'))
const ConnectorPage        = lazy(() => import('./pages/ConnectorPage'))
const EnrollmentPage       = lazy(() => import('./pages/EnrollmentPage'))
const PIKPage              = lazy(() => import('./pages/PIKPage'))
const RemoteAppPage        = lazy(() => import('./pages/RemoteAppPage'))
const RemoteAppDevPage     = lazy(() => import('./pages/RemoteAppDevPage'))
const RemotePayorPage      = lazy(() => import('./pages/RemotePayorPage'))
const RemoteClassicPage    = lazy(() => import('./pages/RemoteClassicPage'))
const RemoteConnectorPage  = lazy(() => import('./pages/RemoteConnectorPage'))
const RemoteEnrollmentPage = lazy(() => import('./pages/RemoteEnrollmentPage'))
const RemotePIKPage        = lazy(() => import('./pages/RemotePIKPage'))
const ProjectManagementPage = lazy(() => import('./pages/TeamManagementPage'))
const EngineeringIntelligencePage = lazy(() => import('./pages/EngineeringIntelligencePage'))
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'))
const SprintPage           = lazy(() => import('./pages/SprintPage'))
const ResourceSkillPage    = lazy(() => import('./pages/ResourceSkillPage'))
const ToolsPage            = lazy(() => import('./pages/ToolsPage'))
const SonarReportPage      = lazy(() => import('./pages/SonarReportPage'))
const RegressionParityPage = lazy(() => import('./pages/RegressionParityPage'))
const AIAnalyzerPage      = lazy(() => import('./pages/AIAnalyzerPage'))
const CoPilotReviewPage    = lazy(() => import('./pages/CoPilotReviewPage'))
const M2RepoCleanerPage    = lazy(() => import('./pages/M2RepoCleanerPage'))
const DwbCleanerPage       = lazy(() => import('./pages/DwbCleanerPage'))
const ProjectCleanerPage   = lazy(() => import('./pages/ProjectCleanerPage'))
const SetupPage            = lazy(() => import('./pages/SetupPage'))
const HelpPage             = lazy(() => import('./pages/HelpPage'))
const HelpIndexPage        = lazy(() => import('./pages/HelpIndexPage'))
const CareerPlanningPage   = lazy(() => import('./pages/CareerPlanningPage'))
const SetupDevToolsPage    = lazy(() => import('./pages/SetupDevToolsPage'))
const SetupDevSoftwaresPage = lazy(() => import('./pages/SetupDevSoftwaresPage'))
const JqassistantPage = lazy(() => import('./pages/JqassistantPage'))
const SetupVersionManagersPage = lazy(() => import('./pages/SetupVersionManagersPage'))

function useNewBuildDetector() {
  const [newBuild, setNewBuild] = useState(false)
  const initialBuild = useRef(null)
  useEffect(() => {
    function check() {
      fetch('/build-info.json?_=' + Date.now(), { cache: 'no-store' })
        .then(r => r.json())
        .then(d => {
          if (initialBuild.current === null) { initialBuild.current = d.built; return }
          if (d.built !== initialBuild.current) setNewBuild(true)
        })
        .catch(() => {})
    }
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [])
  return newBuild
}

export default function App() {
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const restartWorkbench = () => {
    setRestarting(true)
    const t0 = Date.now()
    let oldPid = null
    fetch('/api/system/resources', { cache: 'no-store' }).then(r => r.json()).then(d => { oldPid = d.pid }).catch(() => {})
      .finally(() => fetch('/api/system/restart', { method: 'POST' }).catch(() => {}))
    const iv = setInterval(() => {
      if (Date.now() - t0 < 1000) return
      fetch('/api/system/resources', { cache: 'no-store' }).then(r => r.json())
        .then(d => { if (d.pid && d.pid !== oldPid) { clearInterval(iv); window.location.reload() } }).catch(() => {})
      if (Date.now() - t0 > 90000) { clearInterval(iv); setRestarting(false) }
    }, 500)
  }
  const newBuild = useNewBuildDetector()
  return (
    <Router>
      <div className="app">
        {newBuild && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: '#1976d2', color: '#fff', textAlign: 'center',
            padding: '8px 16px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          }}>
            <span>A new version is available.</span>
            <button onClick={() => window.location.reload()}
              style={{ background: '#fff', color: '#1976d2', border: 'none', borderRadius: 4, padding: '3px 12px', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
              Reload now
            </button>
          </div>
        )}
        <header className="header" style={newBuild ? { marginTop: 36 } : undefined}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link to="/" className="logo">⚡ Developer WorkBench</Link>
            <a href="/" target="_blank" rel="noreferrer"
              title="Open Developer WorkBench in a new browser tab"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none',
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid var(--border)',
                transition: 'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--primary)'; e.currentTarget.style.borderColor = 'var(--primary)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              ↗ New Tab
            </a>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <UserMenu name="Anmol" />
            <button onClick={() => setConfirmRestart(true)} title="Restart Developer WorkBench" aria-label="Restart Developer WorkBench"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%',
                background: 'rgba(76,175,80,0.10)', border: '1px solid #4caf50', color: '#4caf50', cursor: 'pointer', padding: 0,
                transition: 'background 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(76,175,80,0.25)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(76,175,80,0.10)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
              </svg>
            </button>
            <button onClick={() => setConfirmStop(true)} title="Stop Developer WorkBench" aria-label="Stop Developer WorkBench"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%',
                background: 'rgba(244,67,54,0.10)', border: '1px solid #f44336', color: '#f44336', cursor: 'pointer', padding: 0,
                transition: 'background 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(244,67,54,0.25)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(244,67,54,0.10)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v9" /><path d="M6.3 6.6a8 8 0 1 0 11.4 0" />
              </svg>
            </button>
          </div>
        </header>
        {confirmRestart && (
          <ConfirmDialog title="Restart Developer WorkBench" variant="warning" confirmLabel="Restart"
            message="This restarts the Developer WorkBench server and reloads this page. Builds, deploys and other background jobs keep running."
            onCancel={() => setConfirmRestart(false)}
            onConfirm={() => { setConfirmRestart(false); restartWorkbench() }} />
        )}
        {restarting && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'var(--bg, #0d1117)', color: 'var(--text)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
            <span className="spinner" style={{ width: 28, height: 28 }} />
            <div style={{ fontSize: 18, fontWeight: 700 }}>Restarting Developer WorkBench…</div>
          </div>
        )}
        {confirmStop && (
          <ConfirmDialog title="Stop Developer WorkBench" variant="warning" confirmLabel="Stop"
            message="This stops the Developer WorkBench server. Builds and tasks started from it may be interrupted; background jobs such as AI agents, merges and GP runs keep running. Start it again from the Developer WorkBench shortcut."
            onCancel={() => setConfirmStop(false)}
            onConfirm={() => { setConfirmStop(false); fetch('/api/system/stop', { method: 'POST' }).catch(() => {}); setStopped(true) }} />
        )}
        {stopped && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'var(--bg, #0d1117)', color: 'var(--text)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', padding: 24 }}>
            <div style={{ fontSize: 44 }}>⏻</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Developer WorkBench has been stopped</div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 440 }}>You can close this tab. To use it again, start it from the Developer WorkBench shortcut (Desktop / Start Menu).</div>
          </div>
        )}
        <div className="app-body">
          <Sidebar />
          <main className="main">
            <Suspense fallback={<div style={{ padding: 32, color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>}>
            <Routes>
              <Route path="/"                    element={<Welcome />} />
              <Route path="/docker"              element={<DockerPage />} />
              <Route path="/local-app"            element={<LocalAppPage />} />
              <Route path="/local-app/payor"      element={<PayorPage />} />
              <Route path="/local-app/classic"    element={<ClassicPage />} />
              <Route path="/local-app/connector"  element={<ConnectorPage />} />
              <Route path="/local-app/enrollment" element={<EnrollmentPage />} />
              <Route path="/local-app/pik"        element={<PIKPage />} />
              <Route path="/remote-app"                element={<RemoteAppPage />} />
              <Route path="/remote-app/payor"        element={<RemotePayorPage />} />
              <Route path="/remote-app/classic"      element={<RemoteClassicPage />} />
              <Route path="/remote-app/connector"    element={<RemoteConnectorPage />} />
              <Route path="/remote-app/enrollment"   element={<RemoteEnrollmentPage />} />
              <Route path="/remote-app/pik"          element={<RemotePIKPage />} />
              <Route path="/remote-app/:appName"     element={<RemoteAppDevPage />} />
              <Route path="/account"             element={<AccountPage />} />
              <Route path="/vms"                 element={<VMsPage />} />
              <Route path="/secrets"             element={<SecretsPage />} />
              <Route path="/manage-dev-vms"        element={<ManageDevVMsPage />} />
              <Route path="/dev-vms"              element={<DevVMsPage />} />
              <Route path="/dev-vms/:vmName/apps" element={<VMAppsPage />} />
              <Route path="/search-vms"           element={<SearchVMsPage />} />
              <Route path="/workflow-projects"    element={<WorkflowProjectsPage />} />
              <Route path="/clone-projects"      element={<ProjectList />} />
              <Route path="/clone-projects/new"  element={<NewWorkflow />} />
              <Route path="/projects/:pid"       element={<ProjectDetail />} />
              <Route path="/tools/baseline"      element={<BaselinePage />} />
              <Route path="/tools/remote-setup"  element={<RemoteSetupPage />} />
              <Route path="/tools/melissa"       element={<MelissaPage />} />
              <Route path="/tools/clone"         element={<ClonePage />} />
              <Route path="/tools/gp-run"        element={<GpRunPage />} />
              <Route path="/tools/puc"           element={<PucPage />} />
              <Route path="/tools/jreg"          element={<JregPage />} />
              <Route path="/tools/jcj"           element={<JcjPage />} />
              <Route path="/tools/rpb"           element={<RpbPage />} />
              <Route path="/project-management"               element={<ProjectManagementPage />} />
              <Route path="/project-management/sprint"       element={<SprintPage />} />
              <Route path="/project-management/resource-skill" element={<ResourceSkillPage />} />
              <Route path="/project-management/engineering-intelligence/*" element={<EngineeringIntelligencePage />} />
              <Route path="/project-management/portfolio/*" element={<PortfolioPage />} />
              <Route path="/developer-tools"                    element={<ToolsPage />} />
              <Route path="/developer-tools/sonar-report"     element={<SonarReportPage />} />
              <Route path="/developer-tools/regression-parity" element={<RegressionParityPage />} />
              <Route path="/developer-tools/ai-analyzer"      element={<AIAnalyzerPage />} />
              <Route path="/developer-tools/copilot-review"   element={<CoPilotReviewPage />} />
              <Route path="/developer-tools/m2-repo-cleaner"    element={<M2RepoCleanerPage />} />
              <Route path="/developer-tools/dwb-cleaner"        element={<DwbCleanerPage />} />
              <Route path="/developer-tools/project-cleaner"    element={<ProjectCleanerPage />} />
              <Route path="/setup"                             element={<SetupPage />} />
              <Route path="/help"                              element={<HelpIndexPage />} />
              <Route path="/help/erd"                          element={<HelpPage />} />
              <Route path="/help/career-planning"              element={<CareerPlanningPage />} />
              <Route path="/setup/dev-tools"                  element={<SetupDevToolsPage />} />
              <Route path="/setup/dev-softwares"              element={<SetupDevSoftwaresPage />} />
              <Route path="/setup/dev-softwares/jqassistant"  element={<JqassistantPage />} />
              <Route path="/setup/version-managers"           element={<SetupVersionManagersPage />} />
            </Routes>
            </Suspense>
          </main>
        </div>
      </div>
    </Router>
  )
}
