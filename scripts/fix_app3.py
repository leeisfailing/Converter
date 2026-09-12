f = open('C:/Users/Lee/Desktop/Converter/rust/src/App.tsx', 'r')
c = f.read()
f.close()

repls = [
    ('key="download" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}',
     'key="download" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}'),
    ('key="convert" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}',
     'key="convert" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}'),
    ('key="blur" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}',
     'key="blur" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}'),
]

for old, new in repls:
    if old in c:
        c = c.replace(old, new)
        print(f'Replaced: {old[:40]}')
    else:
        print(f'NOT found: {old[:40]}')

f = open('C:/Users/Lee/Desktop/Converter/rust/src/App.tsx', 'w')
f.write(c)
f.close()
print('Done!')
