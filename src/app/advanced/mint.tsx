import { useState } from 'react';
import {
  Button,
  Card,
  CopyField,
  ErrorBanner,
  Field,
  Notice,
  Paragraph,
  Row,
  SectionLabel,
} from '../../components/ui';
import { SettingsScreen } from '../../components/SettingsScreen';
import { useWallet } from '../../hooks/useWallet';
import { getArkadeSession } from '../../lib/arkade/client';
import { errorMessage } from '../../lib/format';

type IssuanceResultView = {
  arkTxId: string;
  assetId: string;
};

export default function ArkadeMintScreen() {
  const { network, balance } = useWallet();
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [decimals, setDecimals] = useState('0');
  const [amount, setAmount] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [controlAssetId, setControlAssetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IssuanceResultView | null>(null);

  const issue = async () => {
    setError(null);
    setResult(null);

    const trimmedAmount = amount.trim();
    if (!/^\d+$/.test(trimmedAmount) || trimmedAmount === '0') {
      setError('Indica una cantidad entera mayor que 0 (en unidades base).');
      return;
    }

    const trimmedDecimals = decimals.trim() || '0';
    if (!/^\d+$/.test(trimmedDecimals)) {
      setError('Los decimales deben ser un número entero (0 o mayor).');
      return;
    }
    const decimalsValue = Number(trimmedDecimals);
    if (!Number.isInteger(decimalsValue) || decimalsValue < 0 || decimalsValue > 18) {
      setError('Los decimales deben estar entre 0 y 18.');
      return;
    }

    let amountValue: bigint;
    try {
      amountValue = BigInt(trimmedAmount);
    } catch {
      setError('La cantidad no es válida.');
      return;
    }
    if (amountValue <= 0n) {
      setError('La cantidad debe ser mayor que 0.');
      return;
    }

    const metadata: {
      name?: string;
      ticker?: string;
      decimals?: number;
      icon?: string;
    } = { decimals: decimalsValue };
    if (name.trim()) metadata.name = name.trim();
    if (ticker.trim()) metadata.ticker = ticker.trim().toUpperCase();
    if (iconUrl.trim()) metadata.icon = iconUrl.trim();

    setBusy(true);
    try {
      const { wallet } = getArkadeSession();
      const issued = await wallet.assetManager.issue({
        amount: amountValue,
        metadata,
        ...(controlAssetId.trim()
          ? { controlAssetId: controlAssetId.trim() }
          : {}),
      });
      setResult({
        arkTxId: issued.arkTxId,
        assetId: issued.assetId,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsScreen title="Arkade Assets">
      <SectionLabel>Estado</SectionLabel>
      <Row label="Red" value={network.swapNetwork} />
      <Row label="Disponible" value={network.isMainnet ? 'Sí' : 'En pruebas'} />
      <Row
        label="Saldo Arkade"
        value={balance ? `${balance.available} sats` : '—'}
      />

      <SectionLabel>Emitir activo</SectionLabel>
      <Card>
        <Field
          label="Nombre"
          value={name}
          onChangeText={setName}
          placeholder="Mi activo"
          autoCapitalize="words"
        />
        <Field
          label="Ticker"
          value={ticker}
          onChangeText={setTicker}
          placeholder="TKN"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Field
          label="Decimales"
          value={decimals}
          onChangeText={setDecimals}
          placeholder="0"
          keyboardType="number-pad"
          hint="Número de decimales del activo (0 a 18)."
        />
        <Field
          label="Cantidad (unidades base)"
          value={amount}
          onChangeText={setAmount}
          placeholder="1000"
          keyboardType="number-pad"
          hint="Cantidad inicial a emitir en unidades enteras base."
        />
        <Field
          label="Icono (URL, opcional)"
          value={iconUrl}
          onChangeText={setIconUrl}
          placeholder="https://…"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Field
          label="Activo de control (opcional)"
          value={controlAssetId}
          onChangeText={setControlAssetId}
          placeholder="asset id"
          autoCapitalize="none"
          autoCorrect={false}
          hint="Solo si quieres permitir reemisiones futuras con un activo de control."
        />

        {error ? <ErrorBanner message={error} /> : null}

        <Button
          title="Emitir activo"
          onPress={() => void issue()}
          loading={busy}
          disabled={busy}
        />
      </Card>

      {result ? (
        <Card title="Activo emitido">
          <CopyField label="ID del activo" value={result.assetId} />
          <CopyField label="Arkade TXID" value={result.arkTxId} />
          <Notice tone="info">
            La emisión se completó. El activo aparecerá en tus salidas virtuales
            cuando el saldo se actualice.
          </Notice>
        </Card>
      ) : null}

      <Notice tone="info">
        Arkade Assets permite emitir activos dentro de Arkade. Revisa nombre,
        ticker y decimales antes de emitir: los metadatos son inmutables.
      </Notice>
      <Paragraph muted>
        La cantidad se expresa en unidades base (sin aplicar decimales). Por
        ejemplo, con 2 decimales, 100 unidades base equivalen a 1,00.
      </Paragraph>
    </SettingsScreen>
  );
}
