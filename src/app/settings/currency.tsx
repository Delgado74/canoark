import { SectionLabel } from '../../components/ui';
import {
  ChoiceRow,
  SettingsGroup,
  SettingsScreen,
} from '../../components/SettingsScreen';
import { usePreferences } from '../../hooks/usePreferences';
import { FIAT_CURRENCIES, type FiatCurrency } from '../../lib/preferences';

const LABELS: Record<FiatCurrency, { label: string; hint?: string }> = {
  BRL: { label: 'Real brasileño', hint: 'BRL' },
  BTC: { label: 'Bitcoin', hint: 'BTC' },
  CHF: { label: 'Franco suizo', hint: 'CHF' },
  CNY: { label: 'Yuan chino', hint: 'CNY' },
  EUR: { label: 'Euro', hint: '€' },
  GBP: { label: 'Libra esterlina', hint: '£' },
  JPY: { label: 'Yen japonés', hint: '¥' },
  USD: { label: 'Dólar estadounidense', hint: '$' },
};

export default function CurrencySettingsScreen() {
  const { preferences, setCurrency } = usePreferences();

  return (
    <SettingsScreen title="Moneda">
      <SectionLabel>Mostrar equivalencia en</SectionLabel>
      <SettingsGroup>
        {FIAT_CURRENCIES.map(currency => (
          <ChoiceRow
            key={currency}
            label={LABELS[currency].label}
            hint={LABELS[currency].hint}
            selected={preferences.currency === currency}
            onPress={() => setCurrency(currency)}
          />
        ))}
      </SettingsGroup>
    </SettingsScreen>
  );
}
