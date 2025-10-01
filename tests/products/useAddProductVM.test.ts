import { renderHook, act, waitFor } from '@testing-library/react';

// === Моки внешних зависимостей ===

// API продуктов
const list = jest.fn();
const lookup = jest.fn();
const createFromOFF = jest.fn();
const createManual = jest.fn();
const patchQuantity = jest.fn();
const update = jest.fn();

jest.mock('../src/Model/products.api', () => ({
  productsApi: { list, lookup, createFromOFF, createManual, patchQuantity, update },
}));

// Локальные уведомления
const clearAllExpiryNotifications = jest.fn();
const scheduleExpiryNotifications = jest.fn();
jest.mock('../src/notifications/local', () => ({
  clearAllExpiryNotifications,
  scheduleExpiryNotifications,
}));

// Настройки уведомлений
const getLocalNotifSettings = jest.fn();
jest.mock('../src/storage/localNotifications', () => ({
  getLocalNotifSettings,
}));

// Провайдер уведомлений (разрешения)
const ensurePermissions = jest.fn();
jest.mock('../src/providers/NotificationsProvider', () => ({
  useNotifications: () => ({ ensurePermissions }),
}));

// Загрузка фото
const uploadImage = jest.fn();
jest.mock('../src/shared/api/uploads', () => ({
  uploadImage: (...args: any[]) => (uploadImage as any)(...args),
}));

// После всех моков импортируем хук
import { useAddProductVM } from '../src/viewmodels/useAddProductVM';

// Вспомогательная фабрика продукта
const mkProduct = (over: Partial<any> = {}) => ({
  id: over.id ?? 1,
  name: over.name ?? 'Milk',
  category: over.category ?? 'Dairy',
  quantity: over.quantity ?? 1,
  barcode: over.barcode ?? '4601234567890',
  expiry_date: over.expiry_date ?? '2025-12-31',
  photo_url: over.photo_url ?? undefined,
});

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  ensurePermissions.mockResolvedValue(true);
  getLocalNotifSettings.mockResolvedValue({ daysBefore: 2 });
  list.mockResolvedValue([]); // по умолчанию список пуст
});

describe('useAddProductVM — обработка сканирования', () => {
  test('игнорирует некорректный штрих-код', async () => {
    const { result } = renderHook(() => useAddProductVM());

    await act(async () => {
      await result.current.handleBarcodeScanned({ data: '123' }); // не EAN-13
    });

    expect(result.current.barcode).toBeNull();
    expect(result.current.mode).toBe('scan');
  });

  test('анти-дубли: повторное сканирование в течение 2с игнорируется', async () => {
    jest.useFakeTimers({ now: Date.now() });
    lookup.mockResolvedValueOnce({ name: 'Juice', category: 'Beverage', quantity: 1 });
    list.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useAddProductVM());

    await act(async () => {
      await result.current.handleBarcodeScanned({ data: '4601234567890' });
    });

    const modeAfterFirst = result.current.mode;

    await act(async () => {
      await result.current.handleBarcodeScanned({ data: '4601234567890' }); // тот же код сразу
    });

    expect(result.current.mode).toBe(modeAfterFirst); // состояние не изменилось
    expect(lookup).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2100); // прошло >2с
    await act(async () => {
      await result.current.handleBarcodeScanned({ data: '4601234567890' });
    });

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test('lookup 404 → режим manual + notice', async () => {
    const err404: any = new Error('Not found');
    err404.status = 404;
    lookup.mockRejectedValueOnce(err404);

    const { result } = renderHook(() => useAddProductVM());
    await act(async () => {
      await result.current.handleBarcodeScanned({ data: '4601234567890' });
    });

    expect(result.current.mode).toBe('manual');
    expect(result.current.notice).toMatch(/не найден/i);
  });

  test('preview найден, но продукт уже у пользователя → режим existing', async () => {
    lookup.mockResolvedValueOnce({ name: 'Milk', category: 'Dairy', quantity: 2 });
    list.mockResolvedValueOnce([mkProduct({ id: 7, quantity: 3, barcode: '4601234567890' })]);

    const { result } = renderHook(() => useAddProductVM());
    await act(async () => {
      await result.current.handleBarcodeScanned({ data: '4601234567890' });
    });

    expect(result.current.mode).toBe('existing');
    expect(result.current.existingId).toBe(7);
    expect(result.current.quantity).toBe('3');
  });

  test('preview найден, продукта нет → режим prefilled и предзаполнение', async () => {
    lookup.mockResolvedValueOnce({ name: 'Juice', category: 'Beverage', quantity: 2, photo_url: 'p.jpg' });
    list.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useAddProductVM());
    await act(async () => {
      await result.current.handleBarcodeScanned({ data: '4601234567890' });
    });

    expect(result.current.mode).toBe('prefilled');
    expect(result.current.name).toBe('Juice');
    expect(result.current.category).toBe('Beverage');
    expect(result.current.photoUrl).toBe('p.jpg');
  });
});

describe('useAddProductVM — сохранение', () => {
  test('валидация количества: обязательно и > 0', async () => {
    const { result } = renderHook(() => useAddProductVM());
    await act(async () => {
      result.current.setMode('manual');
      result.current.setExpiryDate(new Date('2025-12-31'));
      result.current.setQuantity('');
      result.current.setQuantityTouched(true);
    });

    await expect(result.current.save()).rejects.toThrow(/Количество обязательно/i);

    await act(async () => {
      result.current.setQuantity('0');
    });
    await expect(result.current.save()).rejects.toThrow(/больше 0/i);
  });

  test('existing → patchQuantity и планирование уведомлений', async () => {
    list.mockResolvedValueOnce([mkProduct({ id: 5, barcode: '4601234567890', quantity: 1 })]);
    lookup.mockResolvedValueOnce({}); // чтобы handleBarcodeScanned не упал

    const { result } = renderHook(() => useAddProductVM());
    await act(async () => {
      await result.current.handleBarcodeScanned({ data: '4601234567890' });
    });
    expect(result.current.mode).toBe('existing');

    await act(async () => {
      result.current.setQuantity('4');
      result.current.setQuantityTouched(true);
    });

    list.mockResolvedValueOnce([]); // для планирования уведомлений
    await act(async () => {
      const id = await result.current.save();
      expect(id).toBe(5);
    });

    expect(patchQuantity).toHaveBeenCalledWith(5, 4);
    expect(clearAllExpiryNotifications).toHaveBeenCalled();
    expect(scheduleExpiryNotifications).toHaveBeenCalled();
  });

  test('prefilled → createFromOFF', async () => {
    lookup.mockResolvedValueOnce({ name: 'Juice', category: 'Beverage', quantity: 2 });
    list.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useAddProductVM());
    await act(async () => {
      await result.current.handleBarcodeScanned({ data: '4601234567890' });
    });

    await expect(result.current.save()).rejects.toThrow(/Заполните информацию/i);

    await act(async () => {
      result.current.setExpiryDate(new Date('2025-01-15'));
    });

    createFromOFF.mockResolvedValueOnce({ id: 42 });
    list.mockResolvedValueOnce([]);

    await act(async () => {
      const id = await result.current.save();
      expect(id).toBe(42);
    });
  });

  test('manual → createManual', async () => {
    const { result } = renderHook(() => useAddProductVM());
    await act(async () => {
      result.current.setMode('manual');
      result.current.setName('Apples');
      result.current.setCategory('Fruits');
      result.current.setExpiryDate(new Date('2025-03-01'));
      result.current.setQuantity('3');
      result.current.setQuantityTouched(true);
    });

    createManual.mockResolvedValueOnce({ id: 77 });
    list.mockResolvedValueOnce([]);

    await act(async () => {
      const id = await result.current.save();
      expect(id).toBe(77);
    });
  });

  test('с загрузкой фото → uploadImage и update', async () => {
    const { result } = renderHook(() => useAddProductVM());
    await act(async () => {
      result.current.setMode('manual');
      result.current.setName('Yogurt');
      result.current.setExpiryDate(new Date('2025-02-10'));
      result.current.setQuantity('1');
      result.current.setQuantityTouched(true);
      result.current.setPickedImage({ uri: 'file:///tmp/pic.jpg', name: 'pic.jpg', type: 'image/jpeg' });
    });

    createManual.mockResolvedValueOnce({ id: 11 });
    uploadImage.mockResolvedValueOnce({ url: 'https://cdn/app/pic.jpg' });
    list.mockResolvedValueOnce([]);

    await act(async () => {
      const id = await result.current.save();
      expect(id).toBe(11);
    });

    expect(uploadImage).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(11, { photo_url: 'https://cdn/app/pic.jpg' });
  });
});
