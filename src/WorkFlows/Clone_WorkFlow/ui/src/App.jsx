import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'
import ProjectList  from './pages/ProjectList'
import ProjectDetail from './pages/ProjectDetail'
import NewWorkflow  from './pages/NewWorkflow'

export default function App() {
  return (
    <Router>
      <div className="app">
        <header className="header">
          <Link to="/" className="logo">⚡ Clone Workflow</Link>
        </header>
        <main className="main">
          <Routes>
            <Route path="/"               element={<ProjectList />} />
            <Route path="/projects/:pid"  element={<ProjectDetail />} />
            <Route path="/new"            element={<NewWorkflow />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}
