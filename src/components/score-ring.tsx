export function ScoreRing({ score, status, size = 76 }: { score: number; status: 'healthy' | 'moderate' | 'critical'; size?: number }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const color = status === 'healthy' ? '#10b981' : status === 'moderate' ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={7} className="stroke-muted" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={7} stroke={color} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (score / 100) * c} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-semibold tabular-nums leading-none">{score}</span>
        <span className="mt-0.5 text-[10px] capitalize text-muted-foreground">{status}</span>
      </div>
    </div>
  );
}
