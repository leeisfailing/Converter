import sys

from PySide6.QtWidgets import QApplication, QMessageBox
from PySide6.QtGui import QPalette, QColor
from PySide6.QtCore import Qt

from converter_window import ConverterWindow
from ffmpeg_utils import check_ffmpeg_availability


def main() -> None:
    # Check for ffmpeg/ffprobe availability before starting
    available, error_msg = check_ffmpeg_availability()
    if not available:
        # Create QApplication just for the error message
        app = QApplication(sys.argv)
        QMessageBox.critical(
            None,
            "Missing Dependency",
            f"ffmpeg is not available.\n\n{error_msg}\n\n"
            "Please install ffmpeg and ffprobe, and ensure they are in your system PATH.\n"
            "Download: https://ffmpeg.org/download.html\n\n"
            "Alternatively, place ffmpeg.exe and ffprobe.exe in the 'bin' folder next to this application."
        )
        sys.exit(1)

    app = QApplication(sys.argv)

    # Set dark theme palette
    palette = QPalette()
    palette.setColor(QPalette.Window, QColor(26, 26, 46))
    palette.setColor(QPalette.WindowText, QColor(232, 234, 237))
    palette.setColor(QPalette.Base, QColor(30, 42, 58))
    palette.setColor(QPalette.AlternateBase, QColor(26, 26, 46))
    palette.setColor(QPalette.ToolTipBase, QColor(30, 42, 58))
    palette.setColor(QPalette.ToolTipText, QColor(232, 234, 237))
    palette.setColor(QPalette.Text, QColor(232, 234, 237))
    palette.setColor(QPalette.Button, QColor(30, 42, 58))
    palette.setColor(QPalette.ButtonText, QColor(232, 234, 237))
    palette.setColor(QPalette.BrightText, Qt.red)
    palette.setColor(QPalette.Link, QColor(93, 173, 236))
    palette.setColor(QPalette.Highlight, QColor(93, 173, 236))
    palette.setColor(QPalette.HighlightedText, QColor(232, 234, 237))
    app.setPalette(palette)

    window = ConverterWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()