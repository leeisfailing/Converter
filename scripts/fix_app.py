import re

with open('C:/Users/Lee/Desktop/Converter/rust/src/App.tsx', 'r') as f:
    content = f.read()

# Replace the radio-group section
old_radio = '''              {!showSettings && (
                <div className="radio-group">
                  {MODE_CONFIG.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => !isProcessing && setMode(id)}
                      className={`radio-pill ${mode === id ? "active" : ""}`}
                      disabled={isProcessing}
                    >
                      <Icon size={15} />
                      {label}
                    </button>
                  ))}
                </div>
              )}'''

new_radio = '''              {!showSettings && (
                <motion.div
                  className="radio-group"
                  initial="hidden"
                  animate="visible"
                  variants={staggerContainer}
                >
                  {MODE_CONFIG.map(({ id, label, icon: Icon }) => (
                    <motion.button
                      key={id}
                      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      onClick={() => !isProcessing && setMode(id)}
                      className={`radio-pill ${mode === id ? "active" : ""}`}
                      disabled={isProcessing}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      <Icon size={15} />
                      {label}
                    </motion.button>
                  ))}
                </motion.div>
              )}'''

if old_radio in content:
    content = content.replace(old_radio, new_radio)
    print('Radio group replaced')
else:
    print('Radio group NOT found')

# Replace settings modal
old_settings = '''                  <motion.div key="settings" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>'''
new_settings = '''                  <motion.div
                    key="settings"
                    initial={{ opacity: 0, y: 12, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                  >'''
if old_settings in content:
    content = content.replace(old_settings, new_settings)
    print('Settings modal replaced')
else:
    print('Settings modal NOT found')

# Replace each mode div
for mode in ['download', 'convert', 'blur']:
    old_mode = f'                      <motion.div key="{mode}" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>'
    new_mode = f'                      <motion.div key="{mode}" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}>'
    if old_mode in content:
        content = content.replace(old_mode, new_mode)
        print(f'{mode} mode replaced')
    else:
        print(f'{mode} mode NOT found')

# Replace cancel button
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

# Replace DebugConsole in AnimatePresence
old_console = '''              <AnimatePresence>
                {showConsole && (
                  <DebugConsole'''
new_console = '''              <AnimatePresence>
                {showConsole && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                  >
                    <DebugConsole'''
if old_console in content:
    content = content.replace(old_console, new_console)
    print('Console replaced')
else:
    print('Console NOT found')

# Close the motion.div for console
old_console_close = '''                  />
                )}
              </AnimatePresence>'''
new_console_close = '''                  />
                  </motion.div>
                )}
              </AnimatePresence>'''
if old_console_close in content:
    content = content.replace(old_console_close, new_console_close)
    print('Console close replaced')
else:
    print('Console close NOT found')

with open('C:/Users/Lee/Desktop/Converter/rust/src/App.tsx', 'w') as f:
    f.write(content)

print('\nAll App.tsx replacements done!')
