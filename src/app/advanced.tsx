import { router } from 'expo-router';
import { MenuRow, Notice, Paragraph, SectionLabel } from '../components/ui';
import {
  ChoiceRow,
  SettingsGroup,
  SettingsScreen,
} from '../components/SettingsScreen';
import { usePreferences } from '../hooks/usePreferences';
import { useWallet } from '../hooks/useWallet';

export default function AdvancedSettingsScreen() {
  const { network, coins } = useWallet();
  const { preferences, setOnchainSwap } = usePreferences();

  return (
    <SettingsScreen
      title="Avanzado"
      badge={network.isMainnet ? 'Mainnet' : 'Mutinynet'}
    >
      <SectionLabel>Avanzado</SectionLabel>
      <SettingsGroup>
        <MenuRow
          icon="🏦"
          label="Arkade Assets"
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
          label="Salidas virtuales"
          value={`${coins.length} salidas`}
          onPress={() => router.push('/advanced/vtxos')}
        />
        <MenuRow
          icon="🤝"
          label="Renovación delegada"
          value={network.delegateUrl ? 'Configurado' : 'Desactivado'}
          onPress={() => router.push('/advanced/delegates')}
        />
        <MenuRow
          icon="🪂"
          label="Salida unilateral"
          value="Plan de emergencia"
          onPress={() => router.push('/advanced/exit')}
        />
        <MenuRow
          icon="🛰"
          label="Operador"
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

      <SectionLabel>Envíos onchain</SectionLabel>
      <SettingsGroup>
        <ChoiceRow
          label="Permitir el swap del solver"
          hint="Ofrece la ruta más barata entre el solver y la salida del operador."
          selected={preferences.onchainSwap}
          onPress={() => setOnchainSwap(true)}
        />
        <ChoiceRow
          label="Solo la salida del operador"
          hint="Desactiva el corredor onchain del solver. Útil si prefieres no reclamar un HTLC."
          selected={!preferences.onchainSwap}
          onPress={() => setOnchainSwap(false)}
        />
      </SettingsGroup>
      <Paragraph muted>
        En ambos casos el envío sale de tus salidas virtuales. El swap necesita
        la app abierta hasta que el HTLC se reclame; la salida del operador
        espera al cierre del intercambio por lotes.
      </Paragraph>

      <Notice tone="warning">
        Estas opciones afectan a cómo la wallet habla con el operador y los
        servicios de Arkade. No cambies endpoints sin saber lo que haces.
      </Notice>
    </SettingsScreen>
  );
}
