import re

with open('C:/Users/Lee/Desktop/Converter/rust/src/App.tsx', 'r') as f:
    content = f.read()

# Fix mode divs with different indentation patterns
patterns = [
    (r'<motion\.div key="download" initial=\{\{ opacity: 0, y: 8 \}\} animate=\{\{ opacity: 1, y: 0 \}\} exit=\{\{ opacity: 0, y: -8 \}\} transition=\{\{ duration: 0\.15 \}\}>',
     '<motion.div key="download" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}>'),
    (r'<motion\.div key="convert" initial=\{\{ opacity: 0, y: 8 \}\} animate=\{\{ opacity: 1, y: 0 \}\} exit=\{\{ opacity: 0, y: -8 \}\} transition=\{\{ duration: 0\.15 \}\}>',
     '<motion.div key="convert" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}>'),
    (r'<motion\.div key="blur" initial=\{\{ opacity: 0, y: 8 \}\} animate=\{\{ opacity: 1, y: 0 \}\} exit=\{\{ opacity: 0, y: -8 \}\} transition=\{\{ duration: 0\.15 \}\}>',
     '<motion.div key="blur" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}>'),
]

for old, new in patterns:
    if old in content:
        content = content.replace(old, new)
        print(f'Replaced: {old[:50]}...')
    else:
        print(f'NOT found: {old[:50]}...')

# Fix cancel button
old_cancel = '''                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCancel}'''
new_cancel = '''                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  whileTap={{ scale: 0.98 }}
                  whileHover={{ scale: 1.01 }}
                  onClick={handleCancel}'''
if old_cancel in content:
    content = content.replace(old_cancel, new_cancel)
    print('Cancel button replaced')
else:
    print('Cancel button NOT found')

# Also fix the old cancel button (if it has the old format)
old_cancel2 = '''<motion.button
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCancel}'''
new_cancel2 = '''<motion.button
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  whileTap={{ scale: 0.98 }} whileHover={{ scale: 1.01 }}
                  onClick={handleCancel}'''
if old_cancel2 in content:
    content = content.replace(old_cancel2, new_cancel2)
    print('Cancel button v2 replaced')
else:
    print('Cancel button v2 NOT found')

with open('C:/Users/Lee/Desktop/Converter/rust/src/App.tsx', 'w') as f:
    f.write(content)

print('\nDone!')
