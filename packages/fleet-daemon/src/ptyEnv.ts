/**
 * buildPtyEnv — from munder-difflin ptyEnv.ts (pure, Electron-free).
 */
const CLAUDE_MARKER_RE = /^CLAUDE(CODE|_)/;
const CLAUDE_CONFIG_KEEP = new Set([
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX'
]);

export function buildPtyEnv(
  parentEnv: NodeJS.ProcessEnv,
  userPath: string,
  agentEnv?: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
  shellEnv?: Record<string, string>
): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    if (v === undefined) continue;
    if (CLAUDE_MARKER_RE.test(k) && !CLAUDE_CONFIG_KEEP.has(k)) continue;
    inherited[k] = v;
  }
  for (const [k, v] of Object.entries(shellEnv ?? {})) {
    if (v === undefined || k in inherited) continue;
    if (CLAUDE_MARKER_RE.test(k) && !CLAUDE_CONFIG_KEEP.has(k)) continue;
    inherited[k] = v;
  }
  return {
    ...inherited,
    PATH: userPath,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: inherited.LANG ?? 'en_US.UTF-8',
    ...(platform === 'win32' ? {} : { SHELL: inherited.SHELL ?? '/bin/bash' }),
    ...agentEnv
  };
}

/** Append hive bundled-node dir to PATH (munder withHiveRuntimeFallback). */
export function withHiveRuntimeFallback(path: string, hiveRoot?: string, delimiter = ':'): string {
  if (!hiveRoot) return path;
  const dir = `${hiveRoot.replace(/\/$/, '')}/bin/runtime`;
  const entries = path.split(delimiter).filter(Boolean);
  if (entries.includes(dir)) return path;
  return [...entries, dir].join(delimiter);
}
