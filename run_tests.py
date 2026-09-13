import unittest
import sys

loader = unittest.TestLoader()
suite = loader.discover('Engine/tests', top_level_dir='.')
result = unittest.TextTestRunner(verbosity=0).run(suite)

print()
print('='*70)
print(f'Ran {result.testsRun} tests')
print(f'Failures: {len(result.failures)}')
print(f'Errors: {len(result.errors)}')
if result.wasSuccessful():
    print('Result: PASS')
else:
    print('Result: FAIL')

for t in result.errors:
    print(f'ERROR: {t[0]}')
    print(t[1])
    print('-'*40)

for t in result.failures:
    print(f'FAIL: {t[0]}')
    print(t[1])
    print('-'*40)

sys.exit(0 if result.wasSuccessful() else 1)
