import { renderHook, act } from '@testing-library/react';

// === Моки внешних зависимостей (ровно по тем путям, что использует хук) ===

// productsApi
const patchQuantity = jest.fn();
const list = jest.fn();
jest.mock('../src/Model/products.api', () => ({
  productsApi: { patchQuantity, list },
}));

// уведомления (разрешения)
const ensurePermissions = jest.fn();
jest.mock('../src/providers/NotificationsProvider', () => ({
  useNotifications: () => ({ ensurePermissions }),
}));

// настройки уведомлений
const getLocalNotifSettings = jest.fn();
jest.mock('../src/storage/localNotifications', () => ({
  getLocalNotifSettings,
}));

// локальные уведомления (перепланирование)
const clearAllExpiryNotifications = jest.fn();
const scheduleExpiryNotifications = jest.fn();
jest.mock('../src/notifications/local', () => ({
  clearAllExpiryNotifications,
  scheduleExpiryNotifications,
}));

// После моков импортируем хук
import { useAdjustQuantityVM } from '../src/viewmodels/useAdjustQuantityVM';

// удобный помощник
const mount = (over: Partial<{ id: number | string; name: string; currentQuantity: number }> = {}) =>
  renderHook(() =>
    useAdjustQuantityVM({
      id: over.id ?? 10,
      name: over.name ?? 'Milk',
      currentQuantity: over.currentQuantity ?? 5,
    })
  );

beforeEach(() => {
  jest.clearAllMocks();
  ensurePermissions.mockResolvedValue(true);
  getLocalNotifSettings.mockResolvedValue({ daysBefore: 2 });
  list.mockResolvedValue([]); // пустой список для перепланирования
});

describe('useAdjustQuantityVM — вычисления', () => {
  test('computedNew использует exactStr с приоритетом', async () => {
    const { result } = mount({ currentQuantity: 5 });

    // задаём delta, а потом exact — exact должен победить
    await act(async () => {
      result.current.setDeltaStr('3');
      result.current.setExactStr('12');
    });

    expect(result.current.computedNew).toBe(12);
  });

  test('computedNew использует deltaStr, если exactStr пуст/невалиден', async () => {
    const { result } = mount({ currentQuantity: 5 });

    await act(async () => {
      result.current.setExactStr('');   // пусто → невалидно
      result.current.setDeltaStr('-2'); // 5 + (-2) = 3, но с нижней границей 0 при сохранении
    });

    expect(result.current.computedNew).toBe(3);
  });

  test('computedNew по умолчанию равен текущему количеству, если нет валидных значений', async () => {
    const { result } = mount({ currentQuantity: 7 });

    await act(async () => {
      result.current.setExactStr('   '); // невалидно
      result.current.setDeltaStr('   '); // невалидно
    });

    expect(result.current.computedNew).toBe(7);
  });

  test('onApplyPreset корректно накапливает значение deltaStr', async () => {
    const { result } = mount();

    await act(async () => {
      result.current.onApplyPreset(2); // было "0" → станет "2"
      result.current.onApplyPreset(3); // "2" + 3 → "5"
    });

    expect(result.current.deltaStr).toBe('5');
  });

  test('setZero выставляет точное значение в 0', async () => {
    const { result } = mount({ currentQuantity: 5 });

    await act(async () => {
      result.current.setZero();
    });

    expect(result.current.exactStr).toBe('0');
    expect(result.current.computedNew).toBe(0);
  });
});

describe('useAdjustQuantityVM — сохранение', () => {
  test('save с exactStr: вызывает patchQuantity с точным значением', async () => {
    const { result } = mount({ id: 99, currentQuantity: 5 });

    await act(async () => {
      result.current.setExactStr('8'); // точное новое значение
    });

    await act(async () => {
      await result.current.save();
    });

    expect(patchQuantity).toHaveBeenCalledWith(99, 8);
  });

  test('save с deltaStr: вычисляет новое = current + delta', async () => {
    const { result } = mount({ id: 'P1', currentQuantity: 10 });

    await act(async () => {
      result.current.setDeltaStr('-4'); // 10 + (-4) = 6
    });

    await act(async () => {
      await result.current.save();
    });

    expect(patchQuantity).toHaveBeenCalledWith('P1', 6);
  });

  test('save: итог всегда >= 0 (отрицательное приводится к нулю)', async () => {
    const { result } = mount({ id: 7, currentQuantity: 2 });

    await act(async () => {
      result.current.setDeltaStr('-100'); // 2 + (-100) → -98 → clamp к 0
    });

    await act(async () => {
      await result.current.save();
    });

    expect(patchQuantity).toHaveBeenCalledWith(7, 0);
  });

  test('save: если нет exact и delta — кидает валидационную ошибку', async () => {
    const { result } = mount();

    await act(async () => {
      result.current.setExactStr('  ');
      result.current.setDeltaStr('  ');
    });

    await expect(result.current.save()).rejects.toThrow(/Укажите Δ|точное новое количество/i);
    expect(patchQuantity).not.toHaveBeenCalled();
  });

  test('save: флаг saving корректно включается/выключается', async () => {
    const { result } = mount({ id: 1, currentQuantity: 5 });

    await act(async () => {
      result.current.setExactStr('6');
    });

    const p = result.current.save();
    expect(result.current.saving).toBe(true);
    await act(async () => {
      await p;
    });
    expect(result.current.saving).toBe(false);
  });
});

describe('useAdjustQuantityVM — перепланирование уведомлений', () => {
  test('при разрешениях: очищает и планирует уведомления', async () => {
    const { result } = mount({ id: 3, currentQuantity: 1 });
    await act(async () => {
      result.current.setExactStr('2');
    });

    list.mockResolvedValueOnce([]); // для schedule
    await act(async () => {
      await result.current.save();
    });

    expect(clearAllExpiryNotifications).toHaveBeenCalledTimes(1);
    expect(scheduleExpiryNotifications).toHaveBeenCalledTimes(1);
    expect(getLocalNotifSettings).toHaveBeenCalled();
  });

  test('без разрешений: уведомления не трогаются', async () => {
    ensurePermissions.mockResolvedValueOnce(false);

    const { result } = mount({ id: 4, currentQuantity: 3 });
    await act(async () => {
      result.current.setExactStr('5');
    });

    await act(async () => {
      await result.current.save();
    });

    expect(clearAllExpiryNotifications).not.toHaveBeenCalled();
    expect(scheduleExpiryNotifications).not.toHaveBeenCalled();
  });
});
