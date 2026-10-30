import GenericRemoteAppPage from './GenericRemoteAppPage'

export default function RemotePIKPage() {
  return (
    <GenericRemoteAppPage
      appName="pik"
      displayName="PIK"
      icon="💡"
      defaultVm="10.192.251.19"
      backPath="/remote-app"
      backLabel="Remote App Development"
      serverTabVariant="rich"
      defaultServerType="tomcat"
    />
  )
}
