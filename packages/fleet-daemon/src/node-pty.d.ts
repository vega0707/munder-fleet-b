declare module 'node-pty' {
  export interface IPty {
    readonly pid: number;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    onData(callback: (data: string) => void): { dispose(): void };
    onExit(callback: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
  }
  export function spawn(
    file: string,
    args: string[] | string,
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    }
  ): IPty;
}
