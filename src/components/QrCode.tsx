import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import qrcode from 'qrcode-generator';
import { colors, radius } from '../constants/theme';

const QUIET_ZONE = 4;

/**
 * QR generado en JS puro (sin dependencias nativas). Se dibuja como una matriz
 * de Views para que funcione igual en Android e iOS.
 */
export function QrCode({
  value,
  size = 240,
}: {
  value: string;
  size?: number;
}) {
  const matrix = useMemo(() => {
    if (!value) return null;
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const total = count + QUIET_ZONE * 2;
    const rows: boolean[][] = [];
    for (let y = 0; y < total; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < total; x++) {
        const qrX = x - QUIET_ZONE;
        const qrY = y - QUIET_ZONE;
        const inside =
          qrX >= 0 && qrY >= 0 && qrX < count && qrY < count;
        row.push(inside ? qr.isDark(qrY, qrX) : false);
      }
      rows.push(row);
    }
    return { rows, total };
  }, [value]);

  if (!matrix) return null;

  const cell = Math.max(1, Math.floor(size / matrix.total));
  const pixelSize = cell * matrix.total;

  return (
    <View style={styles.frame}>
      <View style={{ width: pixelSize, height: pixelSize }}>
        {matrix.rows.map((row, y) => (
          <View key={`r${y}`} style={styles.row}>
            {row.map((dark, x) => (
              <View
                key={`c${x}`}
                style={{
                  width: cell,
                  height: cell,
                  backgroundColor: dark ? '#000000' : '#FFFFFF',
                }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
  },
});
