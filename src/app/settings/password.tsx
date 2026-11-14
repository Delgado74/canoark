import { useState } from 'react';
import { Alert } from 'react-native';
import {
  Button,
  ErrorBanner,
  Field,
  Notice,
  Paragraph,
  SectionLabel,
} from '../../components/ui';
import {
  ChoiceRow,
  SettingsGroup,
  SettingsScreen,
} from '../../components/SettingsScreen';
import { useWallet } from '../../hooks/useWallet';
import { errorMessage } from '../../lib/format';
import { MIN_PASSPHRASE_LENGTH } from '../../lib/arkade/identity';
import { router } from 'expo-router';

export default function ChangePasswordScreen() {
  const {
    changePassphrase,
    biometricAvailable,
    biometricEnabled,
  } = useWallet();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [useBiometrics, setUseBiometrics] = useState(biometricEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (next.length < MIN_PASSPHRASE_LENGTH) {
      setError(
        `La nueva passphrase debe tener al menos ${MIN_PASSPHRASE_LENGTH} caracteres.`
      );
      return;
    }
    if (next !== confirmation) {
      setError('La confirmación no coincide con la nueva passphrase.');
      return;
    }
    setBusy(true);
    try {
      const result = await changePassphrase(current, next, useBiometrics);
      Alert.alert(
        'Passphrase actualizada',
        result.biometricEnabled
          ? 'La semilla se volvió a cifrar y el desbloqueo biométrico sigue activo.'
          : 'La semilla se volvió a cifrar con la nueva passphrase.'
      );
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsScreen title="Cambiar contraseña">
      <SectionLabel>Passphrase actual</SectionLabel>
      <Field
        label="Passphrase actual"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <SectionLabel>Nueva passphrase</SectionLabel>
      <Field
        label="Nueva passphrase"
        value={next}
        onChangeText={setNext}
        secureTextEntry
        hint={`Mínimo ${MIN_PASSPHRASE_LENGTH} caracteres.`}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label="Repite la nueva passphrase"
        value={confirmation}
        onChangeText={setConfirmation}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      {biometricAvailable ? (
        <SettingsGroup>
          <ChoiceRow
            label="Desbloqueo biométrico"
            hint={
              useBiometrics
                ? 'Se guardará la nueva passphrase tras la biometría.'
                : 'Solo passphrase.'
            }
            selected={useBiometrics}
            onPress={() => setUseBiometrics(value => !value)}
          />
        </SettingsGroup>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      <Button
        title="Guardar passphrase"
        onPress={save}
        loading={busy}
        disabled={!current || !next || !confirmation}
      />
      <Notice tone="warning">
        No cambia la semilla ni la frase de recuperación. Si olvidas la nueva
        passphrase, deberás restaurar con las 12 palabras.
      </Notice>
      <Paragraph muted>
        La semilla sigue cifrada en este dispositivo con SecureStore, tal como
        se creó.
      </Paragraph>
    </SettingsScreen>
  );
}
