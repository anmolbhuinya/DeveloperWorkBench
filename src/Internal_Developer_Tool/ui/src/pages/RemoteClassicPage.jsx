import GenericRemoteAppPage from './GenericRemoteAppPage'

export default function RemoteClassicPage() {
  return (
    <GenericRemoteAppPage
      appName="classic"
      displayName="Classic"
      icon="📚"
      defaultVm="10.192.251.19"
      backPath="/remote-app"
      backLabel="Remote App Development"
      serverTabVariant="simple"
    />
  )
}
