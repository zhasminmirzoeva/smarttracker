import { renderHook, act, waitFor } from '@testing-library/react';

// === Моки внешних зависимостей по путям из хука ===

// recipes API
const getRecipe = jest.fn();
const removeRecipe = jest.fn();
jest.mock('../src/recipes/Model/recipes.api', () => ({
  recipesApi: { get: (...a: any[]) => (getRecipe as any)(...a), remove: (...a: any[]) => (removeRecipe as any)(...a) },
}));

// products API
const listProducts = jest.fn();
jest.mock('../src/products/Model/products.api', () => ({
  productsApi: { list: (...a: any[]) => (listProducts as any)(...a) },
}));

// parseRecipeContent — подменим реализацию, оставив остальной модуль как есть
const parseSpy = jest.fn();
jest.mock('../src/recipes/Model/recipes.types', () => {
  const actual = jest.requireActual('../src/recipes/Model/recipes.types');
  return { ...actual, parseRecipeContent: (...a: any[]) => (parseSpy as any)(...a) };
});

// React Native Alert/Share
const alertSpy = jest.fn();
const shareSpy = jest.fn();
jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  Alert: { alert: (...args: any[]) => alertSpy(...args) },
  Share: { share: (...args: any[]) => shareSpy(...args) },
}));

// После моков — сам хук
import { useRecipeDetailsVM } from '../src/recipes/viewmodels/useRecipeDetailsVM';

// Удобные фабрики
const recipe = (over: Partial<any> = {}) => ({
  id: over.id ?? 1,
  title: over.title ?? 'Суп дня',
  content: over.content ?? 'RAW',
});

const product = (over: Partial<any> = {}) => ({
  id: over.id ?? 10,
  name: over.name ?? 'Картофель',
  quantity: over.quantity ?? 3,
});

beforeEach(() => {
  jest.clearAllMocks();
  // По умолчанию парсер вернёт пустые поля — UI возьмёт title из recipe
  parseSpy.mockImplementation(() => ({
    title: '',
    servings: undefined,
    steps: [],
    ingredients: [],
    estimated_time_min: undefined,
    notes: undefined,
  }));
});

describe('useRecipeDetailsVM — загрузка', () => {
  test('успешная первичная загрузка рецепта + индекса продуктов', async () => {
    getRecipe.mockResolvedValueOnce(recipe({ id: 7, title: 'Плов' }));
    listProducts.mockResolvedValueOnce([product({ id: 101, name: 'Рис', quantity: 2 })]);

    const { result } = renderHook(() => useRecipeDetailsVM(7));

    // стартуем в loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    // рецепт установлен
    expect(result.current.recipe?.id).toBe(7);
    // индекс продуктов построен
    expect(result.current.productsIndex['101']).toEqual({ id: 101, name: 'Рис', quantity: 2 });

    // UI-данные (парсер пустой → title из recipe)
    expect(result.current.data.title).toBe('Плов');
    expect(result.current.data.steps).toEqual([]);
  });

  test('ошибка загрузки рецепта: Alert и loading=false', async () => {
    getRecipe.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useRecipeDetailsVM(123));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(alertSpy).toHaveBeenCalled(); // показали ошибку
    expect(result.current.recipe).toBeNull();
  });

  test('ошибка загрузки списка продуктов — тихая: рецепт всё равно загружается', async () => {
    getRecipe.mockResolvedValueOnce(recipe({ id: 1, title: 'Окрошка' }));
    listProducts.mockRejectedValueOnce(new Error('products fail'));

    const { result } = renderHook(() => useRecipeDetailsVM(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recipe?.title).toBe('Окрошка');
    expect(Object.keys(result.current.productsIndex)).toHaveLength(0);
    expect(alertSpy).not.toHaveBeenCalled(); // ошибок из products нет (тихо)
  });

  test('метод load можно вызвать повторно', async () => {
    getRecipe.mockResolvedValue(recipe({ id: 2, title: 'Борщ' }));
    listProducts.mockResolvedValue([product({ id: 5 })]);

    const { result } = renderHook(() => useRecipeDetailsVM(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Повторная загрузка
    await act(async () => {
      await result.current.load();
    });
    expect(getRecipe).toHaveBeenCalledTimes(2);
  });
});

describe('useRecipeDetailsVM — парсинг и UI модель', () => {
  test('UI берётся из parseRecipeContent при наличии полей', async () => {
    getRecipe.mockResolvedValueOnce(recipe({ id: 3, title: 'Игнорируемый тайтл', content: 'X' }));
    listProducts.mockResolvedValueOnce([]);

    parseSpy.mockReturnValueOnce({
      title: 'Омлет',
      servings: 2,
      steps: ['Взбить яйца', 'Обжарить'],
      ingredients: [{ name: 'Яйца', quantity: '3 шт' }],
      estimated_time_min: 10,
      notes: 'Без соли',
    });

    const { result } = renderHook(() => useRecipeDetailsVM(3));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual({
      title: 'Омлет',
      servings: 2,
      steps: ['Взбить яйца', 'Обжарить'],
      ingredients: [{ name: 'Яйца', quantity: '3 шт' }],
      estimated: 10,
      notes: 'Без соли',
    });
    // проверяем, что парсер вызван с исходным контентом
    expect(parseSpy).toHaveBeenCalledWith('X');
  });
});

describe('useRecipeDetailsVM — Share', () => {
  test('share формирует человекочитаемый текст и вызывает Share.share', async () => {
    getRecipe.mockResolvedValueOnce(recipe({ title: 'Пицца' }));
    listProducts.mockResolvedValueOnce([]);
    parseSpy.mockReturnValueOnce({
      title: 'Пицца 4 сыра',
      servings: 3,
      steps: ['Замесить тесто', 'Выложить сыр', 'Запечь'],
      ingredients: [{ name: 'Сыр', quantity: '200 г' }, { name: 'Тесто' }],
      estimated_time_min: 25,
      notes: 'Только не сладкая',
    });

    const { result } = renderHook(() => useRecipeDetailsVM(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.share();
    });

    expect(shareSpy).toHaveBeenCalledTimes(1);
    const message = (shareSpy.mock.calls[0][0] as any).message as string;

    // Проверяем ключевые кусочки текста
    expect(message).toMatch(/Пицца 4 сыра/);
    expect(message).toMatch(/Порции: 3/);
    expect(message).toMatch(/Время: ~25 мин/);
    expect(message).toMatch(/Ингредиенты:/);
    expect(message).toMatch(/• Сыр — 200 г/);
    expect(message).toMatch(/Шаги:/);
    expect(message).toMatch(/1\\. Замесить тесто/);
    expect(message).toMatch(/Заметки: Только не сладкая/);
  });

  test('ошибка при share: показывает Alert', async () => {
    getRecipe.mockResolvedValueOnce(recipe());
    listProducts.mockResolvedValueOnce([]);
    shareSpy.mockRejectedValueOnce(new Error('no share'));

    const { result } = renderHook(() => useRecipeDetailsVM(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.share();
    });

    expect(alertSpy).toHaveBeenCalled();
  });
});

describe('useRecipeDetailsVM — remove', () => {
  test('успешное удаление вызывает API', async () => {
    getRecipe.mockResolvedValueOnce(recipe({ id: 9 }));
    listProducts.mockResolvedValueOnce([]);
    removeRecipe.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useRecipeDetailsVM(9));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove();
    });

    expect(removeRecipe).toHaveBeenCalledWith(9);
  });

  test('ошибка удаления: Alert и ошибка пробрасывается', async () => {
    getRecipe.mockResolvedValueOnce(recipe({ id: 5 }));
    listProducts.mockResolvedValueOnce([]);
    removeRecipe.mockRejectedValueOnce(new Error('cannot'));

    const { result } = renderHook(() => useRecipeDetailsVM(5));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.remove()).rejects.toThrow('cannot');
    expect(alertSpy).toHaveBeenCalled();
  });
});

describe('useRecipeDetailsVM — onTapIngredient', () => {
  test('возвращает данные продукта, если source_product_id есть в индексе', async () => {
    getRecipe.mockResolvedValueOnce(recipe({ id: 1 }));
    listProducts.mockResolvedValueOnce([product({ id: 33, name: 'Мука', quantity: 1 })]);

    const { result } = renderHook(() => useRecipeDetailsVM(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const picked = result.current.onTapIngredient({
      name: 'Мука',
      source_product_id: 33,
    } as any);

    expect(picked).toEqual({ id: 33, name: 'Мука', currentQuantity: 1 });
  });

  test('возвращает null, если source_product_id отсутствует или продукта нет в индексе', async () => {
    getRecipe.mockResolvedValueOnce(recipe({ id: 1 }));
    listProducts.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useRecipeDetailsVM(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.onTapIngredient({ name: 'X' } as any)).toBeNull();
    expect(result.current.onTapIngredient({ name: 'X', source_product_id: 999 } as any)).toBeNull();
  });
});
