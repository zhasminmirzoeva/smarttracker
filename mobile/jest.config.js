/** @type {import('jest').Config} */
module.exports = {
    // Два независимых конфига: VM (node) и RN (jest-expo)
    projects: [
      // === Тесты ViewModel (без RN) ===
      {
        displayName: 'vm',
        testEnvironment: 'node',
        preset: 'ts-jest',
        rootDir: '.',
        testMatch: ['<rootDir>/src/**/__tests__/**/*.(spec|test).ts'],
        transform: {
          '^.+\\.(ts|tsx)$': [
            'ts-jest',
            { tsconfig: 'tsconfig.json', isolatedModules: false },
          ],
        },
        moduleNameMapper: {
          '^@/(.*)$': '<rootDir>/src/$1',
        },
      },
  
      // === Тесты RN/компонентов (если нужны) ===
      {
        displayName: 'app',
        preset: 'jest-expo',
        testEnvironment: 'jsdom',
        rootDir: '.',
        setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
        // важно для RN/Expo пакетов
        transformIgnorePatterns: [
          'node_modules/(?!(' +
            [
              '@react-native',
              'react-native',
              'react-native-.*',
              '@react-navigation/.*',
              'expo(nent)?',
              '@expo(nent)?/.*',
              'expo-.*',
              '@expo/.*',
              '@unimodules/.*',
            ].join('|') +
            ')/)',
        ],
        moduleNameMapper: {
          '^@/(.*)$': '<rootDir>/src/$1',
        },
      },
    ],
  };
  