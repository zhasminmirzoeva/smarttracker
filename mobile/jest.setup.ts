import '@testing-library/jest-native/extend-expect';

// Если у тебя есть reanimated — раскомментируй (иначе оставь как есть):
// jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// Частые expo-моки (добивай по мере надобности)
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
