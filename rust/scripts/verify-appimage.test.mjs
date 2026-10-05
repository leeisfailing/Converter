import { test } from './test-runner.mjs';
import assert from 'node:assert/strict';
import { appImageLayout } from './verify-appimage.mjs';

test('resources use productName independently of Cargo executable name', () => {
  assert.deepEqual(appImageLayout({ productName: 'Converter' }, {}, 'converter'), { binaryName: 'converter', resourceName: 'Converter' });
});
test('respects platform product and main binary overrides independently', () => {
  assert.deepEqual(appImageLayout({ productName: 'Converter' }, { productName: 'LinuxConverter', mainBinaryName: 'converter-linux' }, 'converter'), { binaryName: 'converter-linux', resourceName: 'LinuxConverter' });
});
