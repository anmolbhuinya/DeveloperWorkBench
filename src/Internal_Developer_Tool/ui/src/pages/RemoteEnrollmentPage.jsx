import GenericRemoteAppPage from './GenericRemoteAppPage'

export default function RemoteEnrollmentPage() {
  return (
    <GenericRemoteAppPage
      appName="enrollment"
      displayName="Enrollment"
      icon="📋"
      defaultVm="10.192.251.19"
      backPath="/remote-app"
      backLabel="Remote App Development"
      serverTabVariant="rich"
      defaultServerType="tomcat"
    />
  )
}
