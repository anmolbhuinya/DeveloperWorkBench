import GenericRemoteAppPage from './GenericRemoteAppPage'

export default function RemoteConnectorPage() {
  return (
    <GenericRemoteAppPage
      appName="connector"
      displayName="Connector"
      icon="🔌"
      defaultVm="10.192.251.19"
      backPath="/remote-app"
      backLabel="Remote App Development"
      serverTabVariant="rich"
      defaultServerType="karaf"
    />
  )
}
