import { useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { ArkNote } from '@arkade-os/sdk';
import {
  Button,
  ErrorBanner,
  Field,
  Notice,
  Paragraph,
  Row,
  SectionLabel,
} from '../../components/ui';
import { SettingsScreen } from '../../components/SettingsScreen';
import { useWallet } from '../../hooks/useWallet';
import { errorMessage, formatSats } from '../../lib/format';
import { router } from 'expo-router';

type ParsedNote = { value: number; error: string | null };

function parseNote(raw: string): ParsedNote | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const notes = trimmed.split(/\s+/).filter(Boolean);
    const value = notes.reduce(
      (total, note) => total + ArkNote.fromString(note).value,
      0
    );
    return { value, error: null };
  } catch (err) {
    return { value: 0, error: errorMessage(err) };
  }
}

export default function NotesSettingsScreen() {
  const { redeemNotes } = useWallet();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseNote(note), [note]);

  const redeem = async () => {
    if (!note.trim()) {
      setError('Introduce una nota Ark.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await redeemNotes(note);
      Alert.alert(
        'Nota canjeada',
        'El importe se añadió a tu saldo Arkade.'
      );
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsScreen title="Notas">
      <SectionLabel>Canjear nota Ark</SectionLabel>
      <Field
        label="Nota (arknote...)"
        value={note}
        onChangeText={value => {
          setNote(value);
          setError(null);
        }}
        placeholder="arknote1..."
        multiline
        autoCapitalize="none"
        autoCorrect={false}
      />
      {parsed && !parsed.error ? (
        <Row label="Importe" value={`${formatSats(parsed.value)} sats`} />
      ) : null}
      {parsed?.error && note.trim() ? (
        <ErrorBanner message={parsed.error} />
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      <Button
        title="Canjear nota"
        onPress={redeem}
        loading={busy}
        disabled={Boolean(parsed?.error) || !note.trim()}
      />
      <Notice tone="info">
        Las notas Ark son pagos bearer: quien tenga la nota puede canjearla.
        Se pueden pegar varias separadas por espacios.
      </Notice>
      <Paragraph muted>
        Al canjear, la nota entra en tu saldo virtual y se liquida en el
        siguiente batch del operador.
      </Paragraph>
    </SettingsScreen>
  );
}
