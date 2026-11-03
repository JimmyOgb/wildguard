/**
 * WildGuard - Atomic Redis-Backed Budget Manager
 * Connects to Upstash Redis REST API using native fetch (zero dependencies).
 * Enforces per-run ($1.50) and global spending ceilings atomically.
 */

export interface BudgetConfig {
  redisUrl?: string;
  redisToken?: string;
  perRunCapUsd: number;
  globalCeilingUsd: number;
  timeoutMs?: number;
}

export interface ReservationResult {
  allowed: boolean;
  reservationId?: string;
  reason?: string;
  runSpentUsd: number;
  globalSpentUsd: number;
  isIdempotent?: boolean;
}

export interface SettlementResult {
  settled: boolean;
  status: 'settled' | 'uncertain' | 'released';
  actualUsd: number;
  runSpentUsd: number;
  globalSpentUsd: number;
  error?: string;
}

export interface RedisBudgetStatus {
  healthy: boolean;
  globalSpentUsd: number;
  globalReservedUsd: number;
  globalCeilingUsd: number;
  perRunCapUsd: number;
  remainingGlobalUsd: number;
  configured: boolean;
  error?: string;
}

export type FetchFunction = typeof fetch;

export class RedisBudgetManager {
  private readonly redisUrl?: string;
  private readonly redisToken?: string;
  private readonly perRunCapUsd: number;
  private readonly globalCeilingUsd: number;
  private readonly timeoutMs: number;
  private readonly customFetch?: FetchFunction;

  constructor(config: BudgetConfig, customFetch?: FetchFunction) {
    const clean = (val?: string): string | undefined => {
      if (!val) return undefined;
      let s = val.trim();
      const eqIdx = s.indexOf('=');
      if (eqIdx !== -1 && !s.startsWith('http://') && !s.startsWith('https://')) {
        s = s.slice(eqIdx + 1).trim();
      }
      s = s.replace(/^[\\"'`]+|[\\"'`]+$/g, '').trim();
      if (s.startsWith('Bearer ')) s = s.slice(7).trim();
      return s || undefined;
    };
    const cleanUrl = clean(config.redisUrl);
    const cleanToken = clean(config.redisToken);
    this.redisUrl = cleanUrl ? cleanUrl.replace(/\/+$/, '') : undefined;
    this.redisToken = cleanToken;
    this.perRunCapUsd = Number(config.perRunCapUsd) || 1.50;
    this.globalCeilingUsd = Number(config.globalCeilingUsd) || 10.00;
    this.timeoutMs = config.timeoutMs || 4000;
    this.customFetch = customFetch;
  }

  public isConfigured(): boolean {
    return Boolean(this.redisUrl && this.redisToken);
  }

  /**
   * Helper: Execute Upstash Redis REST command
   */
  public async executeCommand(command: (string | number)[]): Promise<any> {
    if (!this.isConfigured()) {
      throw new Error('Upstash Redis is not configured (missing URL or token).');
    }

    const fetchImpl = this.customFetch || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('Native fetch is not available in current runtime environment.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetchImpl(this.redisUrl!, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.redisToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Upstash Redis HTTP error ${response.status}: ${text}`);
      }

      const json = await response.json() as { result?: any; error?: string };
      if (json.error) {
        throw new Error(`Upstash Redis command error: ${json.error}`);
      }
      return json.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Health ping to Redis
   */
  public async ping(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const res = await this.executeCommand(['PING']);
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Atomic Reservation Script
   * Enforces that (runSpent + runReserved + reserveAmt) <= perRunCap
   * and (globalSpent + globalReserved + reserveAmt) <= globalCeiling.
   * Returns:
   * [1, reservationId, runSpent, globalSpent] on success
   * [0, reasonCode, runSpent, globalSpent] on failure
   * [2, reservationId, runSpent, globalSpent] if already reserved (idempotent)
   */
  private static readonly LUA_RESERVE = `
    local key_global_spent = KEYS[1]
    local key_global_res = KEYS[2]
    local key_run_spent = KEYS[3]
    local key_run_res = KEYS[4]
    local key_reservation = KEYS[5]
    local key_idempotency = KEYS[6]

    local reserve_amt = tonumber(ARGV[1])
    local run_cap = tonumber(ARGV[2])
    local global_cap = tonumber(ARGV[3])
    local reservation_id = ARGV[4]
    local idempotency_key = ARGV[5]
    local ttl_seconds = tonumber(ARGV[6])

    -- Check idempotency
    if idempotency_key and idempotency_key ~= "" then
      local existing_res_id = redis.call("GET", key_idempotency)
      if existing_res_id then
        local g_spent = tonumber(redis.call("GET", key_global_spent) or "0")
        local r_spent = tonumber(redis.call("GET", key_run_spent) or "0")
        return {2, existing_res_id, tostring(r_spent), tostring(g_spent)}
      end
    end

    local g_spent = tonumber(redis.call("GET", key_global_spent) or "0")
    local g_res = tonumber(redis.call("GET", key_global_res) or "0")
    local r_spent = tonumber(redis.call("GET", key_run_spent) or "0")
    local r_res = tonumber(redis.call("GET", key_run_res) or "0")

    if (r_spent + r_res + reserve_amt) > run_cap then
      return {0, "PER_RUN_CAP_EXCEEDED", tostring(r_spent), tostring(g_spent)}
    end

    if (g_spent + g_res + reserve_amt) > global_cap then
      return {0, "GLOBAL_CEILING_EXCEEDED", tostring(r_spent), tostring(g_spent)}
    end

    -- Reserve atomically
    redis.call("INCRBYFLOAT", key_global_res, reserve_amt)
    redis.call("INCRBYFLOAT", key_run_res, reserve_amt)

    -- Refresh 24h TTL on per-run keys (CRIT-4)
    redis.call("EXPIRE", key_run_spent, 86400)
    redis.call("EXPIRE", key_run_res, 86400)

    -- Save reservation metadata
    local metadata = cjson.encode({
      id = reservation_id,
      amount = reserve_amt,
      status = "reserved",
      created = ARGV[7]
    })
    redis.call("SET", key_reservation, metadata, "EX", ttl_seconds)

    if idempotency_key and idempotency_key ~= "" then
      redis.call("SET", key_idempotency, reservation_id, "EX", ttl_seconds)
    end

    return {1, reservation_id, tostring(r_spent), tostring(g_spent)}
  `;

  /**
   * Atomic Settlement Script
   * Releases reserved amount and settles actual spent amount.
   * If status == 'settled':
   *   global_res -= reserved, run_res -= reserved
   *   global_spent += actual, run_spent += actual
   * If status == 'uncertain':
   *   (Gateway timed out or connection severed: do not refund)
   *   global_res -= reserved, run_res -= reserved
   *   global_spent += reserved, run_spent += reserved
   * If status == 'released':
   *   (Request failed before reaching gateway: refund full reservation)
   *   global_res -= reserved, run_res -= reserved
   */
  private static readonly LUA_SETTLE = `
    local key_global_spent = KEYS[1]
    local key_global_res = KEYS[2]
    local key_run_spent = KEYS[3]
    local key_run_res = KEYS[4]
    local key_reservation = KEYS[5]

    local reservation_id = ARGV[1]
    local actual_usd = tonumber(ARGV[2])
    local status = ARGV[3]

    local raw_res = redis.call("GET", key_reservation)
    if not raw_res then
      return {0, "RESERVATION_NOT_FOUND", "0", "0"}
    end

    local meta = cjson.decode(raw_res)
    if meta.status ~= "reserved" then
      -- Already settled/released
      local g_spent = tonumber(redis.call("GET", key_global_spent) or "0")
      local r_spent = tonumber(redis.call("GET", key_run_spent) or "0")
      return {1, "ALREADY_SETTLED", tostring(r_spent), tostring(g_spent)}
    end

    local reserved_amt = tonumber(meta.amount) or 0

    -- Decrement reservations
    redis.call("INCRBYFLOAT", key_global_res, -reserved_amt)
    redis.call("INCRBYFLOAT", key_run_res, -reserved_amt)

    local charge = 0
    if status == "settled" then
      charge = actual_usd
    elseif status == "uncertain" then
      charge = reserved_amt
    elseif status == "released" then
      charge = 0
    end

    if charge > 0 then
      redis.call("INCRBYFLOAT", key_global_spent, charge)
      redis.call("INCRBYFLOAT", key_run_spent, charge)
    end

    -- Refresh 24h TTL on per-run keys (CRIT-4)
    redis.call("EXPIRE", key_run_spent, 86400)
    redis.call("EXPIRE", key_run_res, 86400)

    meta.status = status
    meta.actualUsd = charge
    redis.call("SET", key_reservation, cjson.encode(meta), "EX", 86400)

    local g_spent = tonumber(redis.call("GET", key_global_spent) or "0")
    local r_spent = tonumber(redis.call("GET", key_run_spent) or "0")
    return {1, status, tostring(r_spent), tostring(g_spent)}
  `;

  /**
   * Atomically reserve budget before making an Otari request.
   */
  public async reserveBudget(params: {
    runId: string;
    idempotencyKey?: string;
    reserveAmountUsd?: number;
    ttlSeconds?: number;
  }): Promise<ReservationResult> {
    if (!this.isConfigured()) {
      // Fail closed in live mode
      return {
        allowed: false,
        reason: 'Upstash Redis budget service is unconfigured. Live inference fails closed for financial safety.',
        runSpentUsd: 0,
        globalSpentUsd: 0,
      };
    }

    const runId = params.runId;
    const idempotencyKey = params.idempotencyKey || '';

    // Monetary Input Validation (HIGH-3)
    let reserveAmt = 0.05;
    if (params.reserveAmountUsd !== undefined) {
      const amt = Number(params.reserveAmountUsd);
      if (isNaN(amt) || !isFinite(amt) || amt <= 0 || amt > 100) {
        return {
          allowed: false,
          reason: `Invalid reservation amount: "${params.reserveAmountUsd}" must be a positive finite number.`,
          runSpentUsd: 0,
          globalSpentUsd: 0,
        };
      }
      reserveAmt = Math.round(amt * 1e6) / 1e6;
    }

    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const ttlSeconds = params.ttlSeconds || 300; // 5 minutes TTL

    const keys = [
      'wildguard:budget:global:spent',
      'wildguard:budget:global:reserved',
      `wildguard:budget:run:${runId}:spent`,
      `wildguard:budget:run:${runId}:reserved`,
      `wildguard:reservation:${reservationId}`,
      idempotencyKey ? `wildguard:idempotency:${idempotencyKey}` : 'wildguard:idempotency:none',
    ];

    const args = [
      reserveAmt.toFixed(6),
      this.perRunCapUsd.toFixed(6),
      this.globalCeilingUsd.toFixed(6),
      reservationId,
      idempotencyKey,
      ttlSeconds.toString(),
      new Date().toISOString(),
    ];

    try {
      const res = await this.executeCommand([
        'EVAL',
        RedisBudgetManager.LUA_RESERVE,
        keys.length,
        ...keys,
        ...args,
      ]);

      const [code, info, rSpentStr, gSpentStr] = res as [number, string, string, string];
      const runSpentUsd = parseFloat(rSpentStr || '0');
      const globalSpentUsd = parseFloat(gSpentStr || '0');

      if (code === 1) {
        return {
          allowed: true,
          reservationId: info,
          runSpentUsd,
          globalSpentUsd,
          isIdempotent: false,
        };
      } else if (code === 2) {
        // Idempotent duplicate
        return {
          allowed: true,
          reservationId: info,
          runSpentUsd,
          globalSpentUsd,
          isIdempotent: true,
        };
      } else {
        const reason = info === 'PER_RUN_CAP_EXCEEDED'
          ? `Per-run spending cap ($${this.perRunCapUsd.toFixed(2)}) reached for run "${runId}".`
          : `Global budget ceiling ($${this.globalCeilingUsd.toFixed(2)}) reached.`;
        return {
          allowed: false,
          reason,
          runSpentUsd,
          globalSpentUsd,
        };
      }
    } catch (err) {
      // Fail closed on Redis error
      return {
        allowed: false,
        reason: `Redis budget reservation failed: ${(err as Error).message}. Failing closed.`,
        runSpentUsd: 0,
        globalSpentUsd: 0,
      };
    }
  }

  /**
   * Atomically settle budget after request finishes (or fails).
   */
  public async settleBudget(params: {
    runId: string;
    reservationId: string;
    actualUsd: number;
    status: 'settled' | 'uncertain' | 'released';
  }): Promise<SettlementResult> {
    if (!this.isConfigured()) {
      return {
        settled: false,
        status: params.status,
        actualUsd: params.actualUsd,
        runSpentUsd: 0,
        globalSpentUsd: 0,
        error: 'Redis unconfigured',
      };
    }

    // Monetary Input Validation (HIGH-3)
    const actual = Number(params.actualUsd);
    if (isNaN(actual) || !isFinite(actual) || actual < 0 || actual > 100) {
      return {
        settled: false,
        status: params.status,
        actualUsd: 0,
        runSpentUsd: 0,
        globalSpentUsd: 0,
        error: `Invalid actualUsd: "${params.actualUsd}" must be a non-negative finite number.`,
      };
    }
    const cleanActualUsd = Math.round(actual * 1e6) / 1e6;

    const keys = [
      'wildguard:budget:global:spent',
      'wildguard:budget:global:reserved',
      `wildguard:budget:run:${params.runId}:spent`,
      `wildguard:budget:run:${params.runId}:reserved`,
      `wildguard:reservation:${params.reservationId}`,
    ];

    const args = [
      params.reservationId,
      cleanActualUsd.toFixed(6),
      params.status,
    ];

    try {
      const res = await this.executeCommand([
        'EVAL',
        RedisBudgetManager.LUA_SETTLE,
        keys.length,
        ...keys,
        ...args,
      ]);

      const [code, info, rSpentStr, gSpentStr] = res as [number, string, string, string];
      return {
        settled: code === 1,
        status: params.status,
        actualUsd: params.actualUsd,
        runSpentUsd: parseFloat(rSpentStr || '0'),
        globalSpentUsd: parseFloat(gSpentStr || '0'),
      };
    } catch (err) {
      return {
        settled: false,
        status: params.status,
        actualUsd: params.actualUsd,
        runSpentUsd: 0,
        globalSpentUsd: 0,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Read overall budget status
   */
  public async getBudgetStatus(runId?: string): Promise<RedisBudgetStatus> {
    if (!this.isConfigured()) {
      return {
        healthy: false,
        configured: false,
        globalSpentUsd: 0,
        globalReservedUsd: 0,
        globalCeilingUsd: this.globalCeilingUsd,
        perRunCapUsd: this.perRunCapUsd,
        remainingGlobalUsd: this.globalCeilingUsd,
        error: 'Redis not configured',
      };
    }

    try {
      const [gSpent, gRes] = await Promise.all([
        this.executeCommand(['GET', 'wildguard:budget:global:spent']),
        this.executeCommand(['GET', 'wildguard:budget:global:reserved']),
      ]);

      const spent = parseFloat(gSpent || '0');
      const reserved = parseFloat(gRes || '0');
      const remaining = Math.max(0, this.globalCeilingUsd - (spent + reserved));

      return {
        healthy: true,
        configured: true,
        globalSpentUsd: Number(spent.toFixed(6)),
        globalReservedUsd: Number(reserved.toFixed(6)),
        globalCeilingUsd: this.globalCeilingUsd,
        perRunCapUsd: this.perRunCapUsd,
        remainingGlobalUsd: Number(remaining.toFixed(6)),
      };
    } catch (err) {
      return {
        healthy: false,
        configured: true,
        globalSpentUsd: 0,
        globalReservedUsd: 0,
        globalCeilingUsd: this.globalCeilingUsd,
        perRunCapUsd: this.perRunCapUsd,
        remainingGlobalUsd: this.globalCeilingUsd,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Generic key-value helpers for serverless state persistence & security stores
   */
  public async get(key: string): Promise<string | null> {
    if (!this.isConfigured()) return null;
    const res = await this.executeCommand(['GET', key]);
    return res !== null && res !== undefined ? String(res) : null;
  }

  public async set(key: string, value: string, exSeconds?: number): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const cmd: (string | number)[] = ['SET', key, value];
    if (exSeconds && exSeconds > 0) {
      cmd.push('EX', exSeconds);
    }
    const res = await this.executeCommand(cmd);
    return res === 'OK' || res === true;
  }

  public async del(key: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const res = await this.executeCommand(['DEL', key]);
    return Boolean(res);
  }

  public async incrWithExpiry(key: string, exSeconds: number): Promise<number> {
    if (!this.isConfigured()) throw new Error('Redis unconfigured');
    const count = await this.executeCommand(['INCR', key]);
    await this.executeCommand(['EXPIRE', key, exSeconds]);
    return Number(count);
  }
}
