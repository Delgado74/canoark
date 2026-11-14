import { useEffect, useState } from 'react';
import { RestDelegateProvider } from '@arkade-os/sdk';
import {
  Button,
  ErrorBanner,
  Notice,
  Paragraph,
  Row,
  SectionLabel,
} from '../../components/ui';
import { SettingsScreen } from '../../components/SettingsScreen';
import { useWallet } from '../../hooks/useWallet';
import { errorMessage } from '../../lib/format';

export default function DelegatesScreen() {
  const { network } = useWallet();
  const [info, setInfo] = useState<{
    pubkey: string;
    fee: string;
    delegateAddress: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const probe = async () => {
    if (!network.delegateUrl) return;
    setLoading(true);
    setError(null);
    try {
      const provider = new RestDelegateProvider(network.delegateUrl);
      setInfo(await provider.getDelegateInfo());
    } catch (err) {
      setError(errorMessage(err));
      setInfo(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!network.delegateUrl) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const provider = new RestDelegateProvider(network.delegateUrl as string);
        const next = await provider.getDelegateInfo();
        if (!cancelled) setInfo(next);
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err));
          setInfo(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [network.delegateUrl]);

  return (
    <SettingsScreen title="Delegados">
      <SectionLabel>Delegador configurado</SectionLabel>
      <Row label="URL" value={network.delegateUrl ?? 'Desactivado'} mono />
      <Row label="Renovación" value="Automática" />
      <Row label="Comisión" value={info ? info.fee : 'Consultando…'} />
      {info ? (
        <>
          <Row label="Pubkey" value={info.pubkey} mono />
          <Row label="Dirección" value={info.delegateAddress} mono />
        </>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      <Button
        title="Comprobar delegador"
        variant="secondary"
        onPress={probe}
        loading={loading}
        disabled={!network.delegateUrl}
      />
      <Notice tone="info">
        Mismo delegador que Arkade Wallet. La wallet delega la firma de las
        renovaciones para que los VTXOs se renueven aunque la app esté cerrada.
      </Notice>
      <Paragraph muted>
        Si el delegador no responde, la wallet sigue renovando por su cuenta
        mientras está abierta.
      </Paragraph>
    </SettingsScreen>
  );
}
