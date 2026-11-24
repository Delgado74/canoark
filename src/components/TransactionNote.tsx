import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Paragraph,
} from './ui';
import { colors, spacing } from '../constants/theme';
import {
  deleteTransactionNote,
  findTransactionNote,
  saveTransactionNote,
  type NoteDirection,
  type TransactionNote as StoredNote,
} from '../lib/storage/appData';
import { errorMessage } from '../lib/format';

type Props = {
  /** Identificadores de la transacción: arkTxid, boardingTxid, commitmentTxid. */
  keys: string[];
  direction: NoteDirection;
  amount: number;
  /** Momento del movimiento en ms; sirve para asociar notas de facturas. */
  createdAt: number;
};

/**
 * Nota local de un movimiento. No viaja con la transacción: se guarda en este
 * dispositivo para recordar para qué fue el pago o la factura.
 */
export function TransactionNote({ keys, direction, amount, createdAt }: Props) {
  const [stored, setStored] = useState<StoredNote | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = keys.find(Boolean) ?? `local:${direction}:${amount}:${createdAt}`;
  const keySignature = keys.filter(Boolean).join('|');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await findTransactionNote({
          keys: keys.filter(Boolean),
          direction,
          amount,
          createdAt,
        });
        if (cancelled) return;
        setStored(found);
        setDraft(found?.note ?? '');
      } catch {
        // Sin nota guardada: la tarjeta se muestra vacía.
      }
    })();
    return () => {
      cancelled = true;
    };
    // `keySignature` resume los identificadores; compararlos evita releer en
    // cada render cuando el array es nuevo pero igual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySignature, direction, amount, createdAt]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const targetKey = stored?.key ?? key;
      await saveTransactionNote({
        key: targetKey,
        note: draft,
        direction,
        amount,
        createdAt: createdAt || Date.now(),
      });
      setStored(
        draft.trim()
          ? {
              key: targetKey,
              note: draft.trim(),
              direction,
              amount: Math.abs(Math.round(amount)),
              createdAt: createdAt || Date.now(),
              updatedAt: Date.now(),
            }
          : null
      );
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [key, stored, draft, direction, amount, createdAt]);

  const remove = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteTransactionNote(stored?.key ?? key);
      setStored(null);
      setDraft('');
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [key, stored]);

  return (
    <Card title="Nota" subtitle="Solo se guarda en este dispositivo.">
      {error ? <ErrorBanner message={error} /> : null}

      {editing ? (
        <>
          <Field
            label="Nota del movimiento"
            value={draft}
            onChangeText={setDraft}
            placeholder="Ej.: cena, alquiler, factura de julio…"
            multiline
            numberOfLines={3}
            autoCorrect
          />
          <View style={styles.buttons}>
            <View style={styles.button}>
              <Button title="Guardar" onPress={save} loading={busy} />
            </View>
            <View style={styles.button}>
              <Button
                title="Cancelar"
                variant="secondary"
                onPress={() => {
                  setDraft(stored?.note ?? '');
                  setEditing(false);
                  setError(null);
                }}
                disabled={busy}
              />
            </View>
          </View>
        </>
      ) : stored ? (
        <>
          <Text style={styles.note}>{stored.note}</Text>
          <View style={styles.buttons}>
            <View style={styles.button}>
              <Button
                title="Editar"
                variant="secondary"
                onPress={() => {
                  setDraft(stored.note);
                  setEditing(true);
                }}
              />
            </View>
            <View style={styles.button}>
              <Button
                title="Borrar"
                variant="danger"
                onPress={remove}
                loading={busy}
              />
            </View>
          </View>
        </>
      ) : (
        <>
          <Paragraph muted>
            Añade una nota para recordar para qué fue este movimiento.
          </Paragraph>
          <Button
            title="Añadir nota"
            variant="secondary"
            onPress={() => setEditing(true)}
          />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  note: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  button: {
    flex: 1,
  },
});
