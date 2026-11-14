import { router } from 'expo-router';
import {
  MenuRow,
  Notice,
  Paragraph,
  SectionLabel,
} from '../../components/ui';
import {
  SettingsGroup,
  SettingsScreen,
} from '../../components/SettingsScreen';
import { usePreferences } from '../../hooks/usePreferences';

export default function DisplaySettingsScreen() {
  const { preferences, toggleHaptics } = usePreferences();

  return (
    <SettingsScreen title="Pantalla">
      <SectionLabel>Preferencias</SectionLabel>
      <SettingsGroup>
        <MenuRow
          label="Unidad de bitcoin"
          value={
            preferences.unit === 'BIP177' ? '₿ (BIP177)' : preferences.unit
          }
          onPress={() => router.push('/settings/bitcoin-unit')}
        />
        <MenuRow
          label="Vibración"
          value={preferences.haptics ? 'Activada' : 'Desactivada'}
          onPress={toggleHaptics}
        />
        <MenuRow label="Tema" value="Oscuro" onPress={() => undefined} />
      </SettingsGroup>
      <Notice tone="info">
        CanoArk usa el tema oscuro de forma fija para mantener la legibilidad
        en exteriores y reducir el consumo de batería.
      </Notice>
      <Paragraph muted>
        La unidad se aplica al saldo, al historial y a los formularios de envío
        y recepción.
      </Paragraph>
    </SettingsScreen>
  );
}
