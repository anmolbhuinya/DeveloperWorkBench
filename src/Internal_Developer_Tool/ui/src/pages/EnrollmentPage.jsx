import GenericLocalAppPage from './GenericLocalAppPage'

export default function EnrollmentPage() {
  return (
    <GenericLocalAppPage
      appName="enrollment"
      displayName="Enrollment"
      icon="📋"
      description="The Enrollment application manages member enrollment workflows, eligibility processing, and group/individual plan subscriptions. It integrates with the core adjudication engine and provides real-time eligibility APIs."
    />
  )
}
