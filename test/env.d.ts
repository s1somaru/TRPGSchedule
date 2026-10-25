// テストだけで使う環境変数の型
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}

// テストで読むファイルを文字のまま取り込むための型(Vite の ?raw と import.meta.glob)
declare module "*?raw" {
  const text: string;
  export default text;
}

interface ImportMeta {
  glob<T = unknown>(pattern: string | string[], options: { query?: string; import?: string; eager: true }): Record<string, T>;
}
