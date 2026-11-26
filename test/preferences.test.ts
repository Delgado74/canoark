import {
  DEFAULT_AUTO_LOCK_MINUTES,
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from '../src/lib/preferences';

describe('preferencias de bloqueo automático', () => {
  it('usa 5 minutos por defecto y persiste la elección', async () => {
    expect(DEFAULT_AUTO_LOCK_MINUTES).toBe(5);

    const initial = await loadPreferences();
    expect(initial.autoLockMinutes).toBe(5);

    await savePreferences({ ...DEFAULT_PREFERENCES, autoLockMinutes: 10 });
    expect((await loadPreferences()).autoLockMinutes).toBe(10);

    await savePreferences({ ...DEFAULT_PREFERENCES, autoLockMinutes: 2 });
    expect((await loadPreferences()).autoLockMinutes).toBe(2);
  });
});
