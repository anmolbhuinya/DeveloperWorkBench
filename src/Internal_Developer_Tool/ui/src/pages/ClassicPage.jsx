import GenericLocalAppPage from './GenericLocalAppPage'

export default function ClassicPage() {
  return (
    <GenericLocalAppPage
      appName="classic"
      displayName="Classic"
      icon="📚"
      description="HealthEdge Classic (HealthRules Classic) is the legacy adjudication platform. It runs on a dedicated Tomcat container and provides claims processing, benefit plan management, and reporting capabilities."
    />
  )
}
