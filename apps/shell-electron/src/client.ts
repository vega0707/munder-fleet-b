/**
 * Electron shell client — connects to the SAME fleet-gateway in Local mode.
 * No password/JWT; gateway injects system_default_user (Aion IdentityMode::Local).
 *
 * Full Munder UI still lives in refs/munder-difflin; this package is the
 * wiring contract Electron main should call after spawning daemon+gateway.
 */
import { LOCAL_DEFAULT_USER, type AuthStatus, type FleetUser } from '@munder/fleet-protocol';

export interface ElectronFleetClientOpts {
  gatewayUrl: string;
  daemonUrl?: string;
  fetchImpl?: typeof fetch;
}

export class ElectronFleetClient {
  private readonly gatewayUrl: string;
  private readonly daemonUrl: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ElectronFleetClientOpts) {
    this.gatewayUrl = opts.gatewayUrl.replace(/\/$/, '');
    this.daemonUrl = opts.daemonUrl?.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Local mode must report identityMode=local and authenticated without credentials. */
  async authStatus(): Promise<AuthStatus> {
    const res = await this.fetchImpl(`${this.gatewayUrl}/api/auth/status`);
    if (!res.ok) throw new Error(`auth status ${res.status}`);
    return (await res.json()) as AuthStatus;
  }

  async me(): Promise<FleetUser> {
    const res = await this.fetchImpl(`${this.gatewayUrl}/api/me`);
    if (!res.ok) throw new Error(`me ${res.status}`);
    const body = (await res.json()) as { user: FleetUser };
    return body.user;
  }

  /** Assert Local wiring — used by contract tests / Electron boot checks. */
  async assertLocalIdentity(): Promise<FleetUser> {
    const status = await this.authStatus();
    if (status.identityMode !== 'local') {
      throw new Error(`expected identityMode=local, got ${status.identityMode}`);
    }
    if (!status.isAuthenticated) {
      throw new Error('local mode must be authenticated without credentials');
    }
    const user = await this.me();
    if (user.id !== LOCAL_DEFAULT_USER.id) {
      throw new Error(`expected ${LOCAL_DEFAULT_USER.id}, got ${user.id}`);
    }
    return user;
  }

  async daemonHealth(): Promise<unknown> {
    const url = this.daemonUrl
      ? `${this.daemonUrl}/health`
      : `${this.gatewayUrl}/api/daemon/health`;
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`daemon health ${res.status}`);
    return res.json();
  }
}
