import { renderHook, act, waitFor } from '@testing-library/react';

// === Моки внешних зависимостей (точно по путям из хука) ===

// productsApi.list — загрузка продуктов в useEffect
const list = jest.fn();
jest.mock('../src/products/Model/products.api', () => ({
  productsApi: { list },
}));

// recipesApi.generate — генерация рецепта
const generateApi = jest.fn();
jest.mock('../src/recipes/Model/recipes.api', () => ({
  recipesApi: { generate: (...args: any[]) => (generateApi as any)(...args) },
}));

// Alert — перехватываем всплывающие сообщения
const alertSpy = jest.fn();
jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  Alert: { alert: (...args: any[]) => alertSpy(...args) },
}));

// После моков — сам хук
import { useGenerateRecipeVM } from '../src/recipes/viewmodels/useGenerateRecipeVM';

// Вспомогалки
const p = (over: Partial<any> = {}) => ({
  id: over.id ?? 1,
  name: over.name ?? 'Milk',
  expiry_date: over.expiry_date ?? '2025-12-31',
  quantity: over.quantity ?? 1,
  category: over.category ?? 'Dairy',
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useGenerateRecipeVM — загрузка списка продуктов', () => {
  test('успешная первичная загрузка: продукты установлены, loadingList=false', async () => {
    list.mockResolvedValueOnce([p({ id: 1 }), p({ id: 2 })]);

    const { result } = renderHook(() => useGenerateRecipeVM());

    // сразу после монтирования должен быть loadingList=true
    expect(result.current.loadingList).toBe(true);

    await waitFor(() => expect(result.current.loadingList).toBe(false));
    expect(result.current.products.length).toBe(2);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('ошибка при загрузке: показывается Alert, loadingList=false', async () => {
    list.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useGenerateRecipeVM());

    await waitFor(() => expect(result.current.loadingList).toBe(false));
    expect(result.current.products.length).toBe(0);
    expect(alertSpy).toHaveBeenCalled(); // Alert.alert("Ошибка", ...)
  });
});

describe('useGenerateRecipeVM — выбор и массовый выбор', () => {
  test('toggle переключает выбранность конкретного продукта', async () => {
    list.mockResolvedValueOnce([p({ id: 5 })]);
    const { result } = renderHook(() => useGenerateRecipeVM());
    await waitFor(() => expect(result.current.loadingList).toBe(false));

    // по умолчанию не выбран
    expect(result.current.selected['5']).toBeUndefined();

    await act(async () => {
      result.current.toggle(5);
    });
    expect(result.current.selected['5']).toBe(true);

    await act(async () => {
      result.current.toggle(5);
    });
    expect(result.current.selected['5']).toBe(false);
  });

  test('toggleAll(true) выбирает все, toggleAll(false) очищает выбор', async () => {
    list.mockResolvedValueOnce([p({ id: 1 }), p({ id: 2 }), p({ id: 3 })]);
    const { result } = renderHook(() => useGenerateRecipeVM());
    await waitFor(() => expect(result.current.loadingList).toBe(false));

    await act(async () => {
      result.current.toggleAll(true);
    });
    expect(Object.values(result.current.selected)).toEqual([true, true, true]);

    await act(async () => {
      result.current.toggleAll(false);
    });
    expect(Object.keys(result.current.selected)).toHaveLength(0);
  });
});

describe('useGenerateRecipeVM — формирование тела и генерация', () => {
  test('generate передаёт корректное тело: парсинг numbers, trim notes, id как number', async () => {
    list.mockResolvedValueOnce([p({ id: 10 }), p({ id: 20 })]);
    generateApi.mockResolvedValueOnce({ ok: true, id: 'recipe1' });

    const { result } = renderHook(() => useGenerateRecipeVM());
    await waitFor(() => expect(result.current.loadingList).toBe(false));

    // подготавливаем ввод
    await act(async () => {
      result.current.setServings(' 4 ');
      result.current.setNotes('  с мятой  ');
      result.current.setPreferExpiringFirst(false);
      result.current.setExpiringWithinDays(' 5 ');
      result.current.toggle(10);
      result.current.toggle(20);
    });

    // вызываем generate
    const promise = act(async () => {
      const r = await result.current.generate();
      expect(r).toEqual({ ok: true, id: 'recipe1' });
    });

    // Проверяем, что recipesApi.generate получил ожидаемое тело
    expect(generateApi).toHaveBeenCalledTimes(1);
    const body = generateApi.mock.calls[0][0];
    expect(body).toMatchObject({
      servings: 4,
      notes: 'с мятой',
      prefer_expiring_first: false,
      expiring_within_days: 5,
      product_ids: [10, 20],
    });

    await promise;
  });

  test('servings по умолчанию (пусто/некорректно) → 2; expiringWithinDays пусто → undefined; notes пусто → undefined', async () => {
    list.mockResolvedValueOnce([p({ id: 'X' })]); // строковый id — должен остаться строкой, см. реализацию
    generateApi.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useGenerateRecipeVM());
    await waitFor(() => expect(result.current.loadingList).toBe(false));

    await act(async () => {
      result.current.setServings('');                // станет 2
      result.current.setNotes('   ');                // станет undefined
      result.current.setExpiringWithinDays('');      // станет undefined
      result.current.toggle('X');                    // строковый id сохранится как строка (см. хук)
    });

    await act(async () => {
      await result.current.generate();
    });

    const body = generateApi.mock.calls[0][0];
    expect(body.servings).toBe(2);
    expect(body.notes).toBeUndefined();
    expect(body.expiring_within_days).toBeUndefined();
    expect(body.product_ids).toEqual(['X']); // строка остаётся строкой
  });

  test('ошибка генерации: показывает Alert и возвращает null, loading сбрасывается', async () => {
    list.mockResolvedValueOnce([]);
    generateApi.mockRejectedValueOnce(new Error('fail'));

    const { result } = renderHook(() => useGenerateRecipeVM());
    await waitFor(() => expect(result.current.loadingList).toBe(false));

    // До вызова
    expect(result.current.loading).toBe(false);

    const resPromise = act(async () => {
      const res = await result.current.generate();
      expect(res).toBeNull();
    });

    // В момент запроса loading=true
    expect(result.current.loading).toBe(true);

    await resPromise;

    // После — loading=false, Alert показан
    expect(result.current.loading).toBe(false);
    expect(alertSpy).toHaveBeenCalled();
  });
});
