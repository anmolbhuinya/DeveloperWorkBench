import GenericRemoteAppPage from './GenericRemoteAppPage'

export default function RemotePayorPage() {
  return (
    <GenericRemoteAppPage
      appName="payor"
      displayName="Payor"
      icon="⚙️"
      defaultVm="10.192.251.19"
      serverTabVariant="rich"
      defaultServerType="tomcat"
    />
  )
}
