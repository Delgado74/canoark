import { SectionLabel } from '../../components/ui';
import {
  ChoiceRow,
  SettingsGroup,
  SettingsScreen,
} from '../../components/SettingsScreen';
import { usePreferences } from '../../hooks/usePreferences';
import { BITCOIN_UNITS } from '../../lib/preferences';

const HINTS: Record<string, string | undefined> = {
  BTC: '0,00000000 BTC',
  sats: '1 000 sats',
  BIP177: '₿1.000',
};

export default function BitcoinUnitSettingsScreen() {
  const { preferences, setUnit } = usePreferences();

  return (
    <SettingsScreen title="Unidad de bitcoin">
      <SectionLabel>Mostrar importes en</SectionLabel>
      <SettingsGroup>
        {BITCOIN_UNITS.map(option => (
          <ChoiceRow
            key={option.value}
            label={option.label}
            hint={HINTS[option.value]}
            selected={preferences.unit === option.value}
            onPress={() => setUnit(option.value)}
          />
        ))}
      </SettingsGroup>
    </SettingsScreen>
  );
}
