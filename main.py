"""
Lancer1911 ASR Offline v0.7a — 主入口
"""
import sys, threading, time, urllib.request, queue, os

PORT = 17434

# ── 文件对话框队列（pywebview js_api → 主线程执行）─────────────
_dialog_request_q: queue.Queue = queue.Queue()


def _dialog_kind(webview_module, name: str):
    """兼容 pywebview 新旧版本的文件对话框常量。

    新版 pywebview 推荐使用 webview.FileDialog.OPEN / SAVE；
    旧版仍然只提供 webview.OPEN_DIALOG / SAVE_DIALOG。
    """
    file_dialog = getattr(webview_module, "FileDialog", None)
    if file_dialog is not None and hasattr(file_dialog, name):
        return getattr(file_dialog, name)
    legacy_name = f"{name}_DIALOG"
    return getattr(webview_module, legacy_name)

def _cleanup():
    import subprocess
    my = os.getpid()
    try:
        r = subprocess.run(["lsof","-ti",f":{PORT}"],
                           capture_output=True, text=True)
        for p in r.stdout.strip().split():
            pid = int(p)
            if pid != my:
                subprocess.run(["kill","-9",str(pid)], check=False)
        time.sleep(0.3)
    except Exception:
        pass

def _start_server(dialog_q):
    import uvicorn
    from server import create_app
    import server as _srv
    _srv._DIALOG_Q = dialog_q
    uvicorn.run(create_app(), host="127.0.0.1", port=PORT, log_level="warning")


class FileDialogAPI:
    """
    pywebview js_api 类：暴露给前端 JS 的 Python 方法。
    pywebview 在主线程调用这些方法，因此可以安全地弹原生对话框。
    """
    def __init__(self, window_ref):
        self._win = window_ref  # 通过 set_window() 延迟设置

    def set_window(self, win):
        self._win = win

    def save_file(self, suggested: str, content: str) -> dict:
        """弹出系统保存对话框，用户选路径后写文件。返回 {ok, path} 或 {ok, cancelled}。"""
        try:
            import webview
            win = self._win
            if win is None:
                return {"ok": False, "error": "no window"}
            # 推断文件类型过滤
            ext = os.path.splitext(suggested)[1].lower()
            file_types = {
                ".srt":  "SRT 字幕文件 (*.srt)",
                ".txt":  "文本文件 (*.txt)",
                ".md":   "Markdown 文件 (*.md)",
                ".json": "JSON 文件 (*.json)",
                ".aso":  "ASO 会话文件 (*.aso)",
            }
            ft = file_types.get(ext, f"文件 (*{ext})")
            result = win.create_file_dialog(
                _dialog_kind(webview, "SAVE"),
                save_filename=suggested,
                file_types=(ft, "所有文件 (*.*)"),
            )
            if not result:
                return {"ok": False, "cancelled": True}
            path = result[0] if isinstance(result, (list, tuple)) else result
            if not path:
                return {"ok": False, "cancelled": True}
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return {"ok": True, "path": path}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def open_file(self) -> dict:
        """弹出系统打开对话框，返回 {ok, path, content}。"""
        try:
            import webview
            win = self._win
            if win is None:
                return {"ok": False, "error": "no window"}
            result = win.create_file_dialog(
                _dialog_kind(webview, "OPEN"),
                file_types=("ASO 会话文件 (*.aso)", "JSON 文件 (*.json)", "所有文件 (*.*)"),
                allow_multiple=False,
            )
            if not result:
                return {"ok": False, "cancelled": True}
            path = result[0] if isinstance(result, (list, tuple)) else result
            if not path:
                return {"ok": False, "cancelled": True}
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            return {"ok": True, "path": path, "content": content}
        except Exception as e:
            return {"ok": False, "error": str(e)}


def main():
    _cleanup()

    threading.Thread(target=_start_server, args=(_dialog_request_q,), daemon=True).start()
    for _ in range(40):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/ping", timeout=1)
            break
        except Exception:
            time.sleep(0.15)

    if "--browser" in sys.argv:
        import webbrowser
        webbrowser.open(f"http://127.0.0.1:{PORT}")
        try:
            while True: time.sleep(1)
        except KeyboardInterrupt:
            pass
    else:
        import webview

        api = FileDialogAPI(None)

        win = webview.create_window(
            title="Lancer1911 ASR Offline",
            url=f"http://127.0.0.1:{PORT}",
            width=1260, height=840, min_size=(920,620),
            background_color="#0d0f14", text_select=True,
            js_api=api,
        )
        api.set_window(win)

        webview.start(debug="--debug" in sys.argv, private_mode=False)


if __name__ == "__main__":
    main()
