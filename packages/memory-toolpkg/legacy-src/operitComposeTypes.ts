export type ComposeNode = unknown;

export interface WebViewController {
  addJavascriptInterface(name: string, bridge: Record<string, (...args: unknown[]) => unknown>): void;
  evaluateJavascript(script: string): Promise<unknown> | unknown;
  loadHtml(html: string, options?: { baseUrl?: string }): void;
}

export interface ComposeDslContext {
  useMemo<T>(key: string, factory: () => T, dependencies: unknown[]): T;
  useRef<T>(key: string, initialValue: T): { current: T };
  createWebViewController(key: string): WebViewController;
  showToast(message: string): Promise<unknown> | unknown;
  UI: {
    WebView(properties: Record<string, unknown>): ComposeNode;
  };
}
