import { Notice, Paragraph, Row, SectionLabel } from '../../components/ui';
import { SettingsScreen } from '../../components/SettingsScreen';
import { useWallet } from '../../hooks/useWallet';

export default function ArkadeMintScreen() {
  const { network, balance } = useWallet();

  return (
    <SettingsScreen title="Arkade Mint">
      <SectionLabel>Estado</SectionLabel>
      <Row label="Red" value={network.swapNetwork} />
      <Row label="Disponible" value={network.isMainnet ? 'Sí' : 'En pruebas'} />
      <Row
        label="Saldo Arkade"
        value={balance ? `${balance.available} sats` : '—'}
      />
      <Notice tone="info">
        Arkade Mint permite emitir y gestionar activos sobre Arkade. La
        interfaz de emisión todavía no está habilitada en CanoArk.
      </Notice>
      <Paragraph muted>
        La wallet ya soporta recibir assets en tus VTXOs; la creación y el
        canje de activos se añadirán en una próxima versión.
      </Paragraph>
    </SettingsScreen>
  );
}
