import GenericLocalAppPage from './GenericLocalAppPage'

export default function ConnectorPage() {
  return (
    <GenericLocalAppPage
      appName="connector"
      displayName="Connector"
      icon="🔌"
      description="The Integration Platform Connector provides bidirectional data exchange between HealthEdge and external systems (EDI, FHIR, HL7). It handles inbound/outbound file processing, transformation pipelines, and partner connectivity."
    />
  )
}
