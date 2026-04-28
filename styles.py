"""
Apple Liquid Glass inspired stylesheet for the Converter app.
Translucent, rounded, soft gradients with frosted glass aesthetic.
"""

LIQUID_GLASS_STYLE = """

/* ── Global ── */
* {
    font-family: "Segoe UI", "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
    font-size: 13px;
    color: #e8eaed;
}

QWidget#mainWindow {
    background: transparent;
}

/* ── Group Boxes (Glass Panels) ── */
QGroupBox {
    background-color: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    margin-top: 14px;
    padding: 18px 12px 12px 12px;
    font-weight: 600;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.55);
}

QGroupBox::title {
    subcontrol-origin: margin;
    subcontrol-position: top left;
    left: 16px;
    top: 2px;
    padding: 0 6px;
    color: rgba(255, 255, 255, 0.55);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
}

/* ── Radio Buttons ── */
QRadioButton {
    spacing: 8px;
    color: rgba(255, 255, 255, 0.85);
    font-size: 13px;
    padding: 4px 8px;
}

QRadioButton::indicator {
    width: 18px;
    height: 18px;
    border-radius: 9px;
    border: 2px solid rgba(255, 255, 255, 0.25);
    background-color: rgba(255, 255, 255, 0.05);
}

QRadioButton::indicator:hover {
    border: 2px solid rgba(100, 180, 255, 0.5);
    background-color: rgba(100, 180, 255, 0.08);
}

QRadioButton::indicator:checked {
    border: 2px solid #5dadec;
    background-color: qradialgradient(
        cx:0.5, cy:0.5, radius:0.5,
        fx:0.5, fy:0.5,
        stop:0 #7ec8e3,
        stop:0.55 #5dadec,
        stop:1.0 #3a86c8
    );
}

QRadioButton:disabled {
    color: rgba(255, 255, 255, 0.3);
}

/* ── Combo Boxes (Glass Dropdowns) ── */
QComboBox {
    background-color: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 10px;
    padding: 6px 12px;
    color: rgba(255, 255, 255, 0.88);
    min-height: 22px;
}

QComboBox:hover {
    background-color: rgba(255, 255, 255, 0.10);
    border: 1px solid rgba(100, 180, 255, 0.3);
}

QComboBox:disabled {
    color: rgba(255, 255, 255, 0.3);
    background-color: rgba(255, 255, 255, 0.03);
}

QComboBox::drop-down {
    subcontrol-origin: padding;
    subcontrol-position: top right;
    width: 28px;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    border-top-right-radius: 10px;
    border-bottom-right-radius: 10px;
}

QComboBox::down-arrow {
    image: none;
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 5px solid rgba(255, 255, 255, 0.45);
}

QComboBox QAbstractItemView {
    background-color: #1e2a3a;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 10px;
    selection-background-color: rgba(93, 173, 236, 0.3);
    selection-color: #ffffff;
    padding: 4px;
    outline: none;
}

QComboBox QAbstractItemView::item {
    padding: 6px 12px;
    border-radius: 6px;
    min-height: 22px;
}

QComboBox QAbstractItemView::item:hover {
    background-color: rgba(93, 173, 236, 0.2);
}

/* ── Line Edits (Glass Input Fields) ── */
QLineEdit {
    background-color: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 7px 12px;
    color: rgba(255, 255, 255, 0.9);
    selection-background-color: rgba(93, 173, 236, 0.4);
}

QLineEdit:focus {
    border: 1px solid rgba(93, 173, 236, 0.55);
    background-color: rgba(255, 255, 255, 0.08);
}

QLineEdit:read-only {
    background-color: rgba(255, 255, 255, 0.03);
    color: rgba(255, 255, 255, 0.6);
}

QLineEdit:disabled {
    color: rgba(255, 255, 255, 0.25);
    background-color: rgba(255, 255, 255, 0.02);
}

/* ── Push Buttons (Glass Buttons) ── */
QPushButton {
    background-color: rgba(93, 173, 236, 0.2);
    border: 1px solid rgba(93, 173, 236, 0.3);
    border-radius: 10px;
    padding: 8px 20px;
    color: #b0d4f1;
    font-weight: 600;
    font-size: 13px;
    min-height: 18px;
}

QPushButton:hover {
    background-color: rgba(93, 173, 236, 0.32);
    border: 1px solid rgba(93, 173, 236, 0.45);
    color: #dceefb;
}

QPushButton:pressed {
    background-color: rgba(93, 173, 236, 0.15);
    border: 1px solid rgba(93, 173, 236, 0.2);
}

QPushButton:disabled {
    background-color: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.2);
}

/* ── Progress Bar (Glass Fill) ── */
QProgressBar {
    background-color: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    text-align: center;
    color: rgba(255, 255, 255, 0.7);
    font-size: 11px;
    min-height: 16px;
    max-height: 16px;
}

QProgressBar::chunk {
    background: qlineargradient(
        x1:0, y1:0, x2:1, y2:0,
        stop:0 rgba(93, 173, 236, 0.7),
        stop:0.5 rgba(126, 200, 227, 0.8),
        stop:1.0 rgba(93, 173, 236, 0.7)
    );
    border-radius: 7px;
}

/* ── Labels ── */
QLabel {
    color: rgba(255, 255, 255, 0.72);
    font-size: 12px;
    background: transparent;
    border: none;
}

/* ── Drop Area (Special Glass Panel) ── */
QLabel#dropArea {
    background-color: rgba(255, 255, 255, 0.04);
    border: 2px dashed rgba(255, 255, 255, 0.15);
    border-radius: 14px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 13px;
    min-height: 55px;
}

QLabel#dropArea:hover {
    background-color: rgba(93, 173, 236, 0.06);
    border: 2px dashed rgba(93, 173, 236, 0.35);
    color: rgba(93, 173, 236, 0.7);
}

QLabel#dropArea:disabled {
    color: rgba(255, 255, 255, 0.15);
    border: 2px dashed rgba(255, 255, 255, 0.06);
}

/* ── Scrollbars ── */
QScrollBar:vertical {
    background: transparent;
    width: 6px;
    margin: 0;
}

QScrollBar::handle:vertical {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    min-height: 20px;
}

QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
    height: 0;
}

/* ── Message Boxes ── */
QMessageBox {
    background-color: #1a1a2e;
}

QMessageBox QLabel {
    color: rgba(255, 255, 255, 0.85);
}

QMessageBox QPushButton {
    min-width: 80px;
}

/* ── Tooltips ── */
QToolTip {
    background-color: #1e2a3a;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.85);
    padding: 6px 10px;
    font-size: 12px;
}

"""
