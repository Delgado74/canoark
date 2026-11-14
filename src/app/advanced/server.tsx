import { Notice, Paragraph, Row, SectionLabel } from '../../components/ui';
import { SettingsScreen } from '../../components/SettingsScreen';
import { useWallet } from '../../hooks/useWallet';

export default function ServerScreen() {
  const { network } = useWallet();

  return (
    <SettingsScreen title="Servidor">
      <SectionLabel>Arkade</SectionLabel>
      <Row label="Red" value={network.label} />
      <Row label="Operator" value={network.operatorUrl} mono />
      <Row label="Indexer" value={network.indexerUrl} mono />
      <Row label="Esplora" value={network.esploraUrl} mono />
      <SectionLabel>Servicios</SectionLabel>
      <Row label="Delegador" value={network.delegateUrl ?? 'Desactivado'} mono />
      <Row label="Solvers" value={network.solverRegistryUrl} mono />
      <Row label="LNURL" value={network.lnurlServer} mono />
      <Row label="Dominio Lightning" value={network.lnurlDomain} mono />
      <Notice tone="warning">
        Los endpoints se fijan al compilar. Cambiar de red requiere una nueva
        compilación con EXPO_PUBLIC_ARKADE_NETWORK.
      </Notice>
      <Paragraph muted>
        Los valores por defecto replican la configuración de Arkade Wallet:
        delegator, registro de solvers y servidor LNURL de la red activa.
      </Paragraph>
    </SettingsScreen>
  );
}
