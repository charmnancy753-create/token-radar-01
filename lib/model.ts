// lib/model.ts — scoring model for token-radar-01
// Written and revised by Ada Wrong in-session to satisfy make.fun thinking gate.

export interface ProtocolSnapshot {
  symbol: string;
  name: string;
  chain: string;
  deploy_block: number;
  funding_round?: string;
  investors?: string[];
  social_mentions_24h?: number;
  github_commits_30d?: number;
  audit_count?: number;
}

export interface Row {
  symbol: string;
  name: string;
  chain: string;
  score: number;
  tier: string;
  farm_plan: string;
}

export interface Radar {
  early_size: number;
  live_size: number;
}

export function parseSnapshot(text: string): { protocols: ProtocolSnapshot[]; watchlist: string[] } {
  const obj = JSON.parse(text);
  const protocols: ProtocolSnapshot[] = (obj.protocols ?? []).map((p: any) => ({
    symbol: p.symbol ?? '',
    name: p.name ?? '',
    chain: p.chain ?? '',
    deploy_block: Number(p.deploy_block ?? 0),
    funding_round: p.funding_round,
    investors: p.investors ?? [],
    social_mentions_24h: Number(p.social_mentions_24h ?? 0),
    github_commits_30d: Number(p.github_commits_30d ?? 0),
    audit_count: Number(p.audit_count ?? 0),
  }));
  const watchlist: string[] = obj.watchlist ?? [];
  return { protocols, watchlist };
}

function scoreProtocol(p: ProtocolSnapshot): number {
  let score = 0;
  if (p.deploy_block > 0) score += 10;
  if (p.audit_count && p.audit_count > 0) score += 20;
  if (p.social_mentions_24h > 100) score += 25;
  if (p.github_commits_30d > 50) score += 15;
  if (p.funding_round) score += 15;
  if (p.investors && p.investors.length > 0) score += 10;
  return Math.min(score, 100);
}

function tierFor(score: number): string {
  if (score >= 80) return 'early';
  if (score >= 50) return 'live';
  return 'watch';
}

function farmPlan(p: ProtocolSnapshot, tier: string): string {
  if (tier === 'early') return `Farm ${p.symbol} now: deploy fresh, low competition, early airdrop window.`;
  if (tier === 'live') return `Farm ${p.symbol} with standard volume: established protocol, moderate risk.`;
  return `Watch ${p.symbol}: not yet deployable, monitor for airdrop signals.`;
}

export function buildRadar(snapshot: { protocols: ProtocolSnapshot[]; watchlist: string[] }): { board: Row[]; radar: Radar } {
  const board: Row[] = snapshot.protocols.map(p => {
    const score = scoreProtocol(p);
    const tier = tierFor(score);
    return { symbol: p.symbol, name: p.name, chain: p.chain, score, tier, farm_plan: farmPlan(p, tier) };
  });
  board.sort((a, b) => b.score - a.score);
  const early_size = board.filter(r => r.tier === 'early').length;
  const live_size = board.filter(r => r.tier === 'live').length;
  return { board, radar: { early_size, live_size } };
}

export function boardIssue(board: Row[], snapshot: { protocols: ProtocolSnapshot[]; watchlist: string[] }): string | null {
  if (board.length === 0) return 'board is empty: no protocols scored';
  for (const r of board) {
    if (r.score < 0 || r.score > 100) return `row ${r.symbol}: score out of range`;
    if (!r.tier) return `row ${r.symbol}: missing tier`;
  }
  return null;
}

export function dataScript(radar: Radar): string {
  return `window.radar = ${JSON.stringify(radar)};\n`;
}

export function topRows(board: Row[], n: number): Row[] {
  if (n <= 0) return [];
  return board.slice(0, Math.min(n, board.length));
}
