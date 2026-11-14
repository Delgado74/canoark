import { router } from 'expo-router';
import { MenuRow, Notice, SectionLabel } from '../components/ui';
import {
  SettingsGroup,
  SettingsScreen,
} from '../components/SettingsScreen';
import { useWallet } from '../hooks/useWallet';

export default function AdvancedSettingsScreen() {
  const { network, coins } = useWallet();

  return (
    <SettingsScreen
      title="Avanzado"
      badge={network.isMainnet ? 'Mainnet' : 'Mutinynet'}
    >
      <SectionLabel>Avanzado</SectionLabel>
      <SettingsGroup>
        <MenuRow
          icon="🏦"
          label="Arkade Mint"
          value="Activos"
          onPress={() => router.push('/advanced/mint')}
        />
        <MenuRow
          icon="🔐"
          label="Cambiar contraseña"
          onPress={() => router.push('/settings/password')}
        />
        <MenuRow
          icon="◫"
          label="Coin control"
          value={`${coins.length} monedas`}
          onPress={() => router.push('/advanced/vtxos')}
        />
        <MenuRow
          icon="🤝"
          label="Delegados"
          value={network.delegateUrl ? 'Delegación activa' : 'Desactivado'}
          onPress={() => router.push('/advanced/delegates')}
        />
        <MenuRow
          icon="🛰"
          label="Servidor"
          value={network.label}
          onPress={() => router.push('/advanced/server')}
        />
        <MenuRow
          icon="🔀"
          label="Solvers"
          value="Mercados de swap"
          onPress={() => router.push('/advanced/solvers')}
        />
        <MenuRow
          icon="⚡"
          label="Dirección Lightning"
          value={network.lnurlDomain}
          onPress={() => router.push('/advanced/lnurl')}
        />
      </SettingsGroup>

      <Notice tone="warning">
        Estas opciones afectan a cómo la wallet habla con el operador y los
        servicios de Arkade. No cambies endpoints sin saber lo que haces.
      </Notice>
    </SettingsScreen>
  );
}
